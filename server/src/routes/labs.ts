import { Router, Response } from 'express';
import { z } from 'zod';
import { VitalType, ImagingStudyType } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { canonicalizeLabTestName } from '../services/recordExtractor.js';

const router = Router();
router.use(requireAuth);

const labSchema = z.object({
  testName: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1),
  referenceMin: z.number().optional(),
  referenceMax: z.number().optional(),
  recordedAt: z.string(),
  sourceRecordId: z.string().optional(),
  providerName: z.string().optional(),
  notes: z.string().optional(),
});

const vitalSchema = z.object({
  type: z.nativeEnum(VitalType),
  value: z.number(),
  value2: z.number().optional(),
  unit: z.string().min(1),
  recordedAt: z.string(),
  notes: z.string().optional(),
  source: z.string().optional(),
});

const appleHealthSchema = z.object({
  data: z.array(
    z.object({
      type: z.string(),
      value: z.number(),
      unit: z.string(),
      startDate: z.string(),
    })
  ),
});

router.get('/results', async (req: AuthRequest, res: Response): Promise<void> => {
  const results = await prisma.labResult.findMany({
    where: { userId: req.userId! },
    orderBy: { recordedAt: 'desc' },
  });
  res.json({ results: results.map(r => ({ ...r, testName: canonicalizeLabTestName(r.testName) })) });
});

router.post('/results', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = labSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const { referenceMin, referenceMax, value } = result.data;
  const isFlagged =
    (referenceMin !== undefined && value < referenceMin) ||
    (referenceMax !== undefined && value > referenceMax);

  const lab = await prisma.labResult.create({
    data: {
      userId: req.userId!,
      ...result.data,
      recordedAt: new Date(result.data.recordedAt),
      isFlagged,
    },
  });

  res.status(201).json({ result: lab });
});

router.put('/results/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.labResult.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Lab result not found' });
    return;
  }

  const result = labSchema.omit({ sourceRecordId: true }).safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const { referenceMin, referenceMax, value } = result.data;
  const isFlagged =
    (referenceMin !== undefined && value < referenceMin) ||
    (referenceMax !== undefined && value > referenceMax);

  const updated = await prisma.labResult.update({
    where: { id: req.params.id },
    data: { ...result.data, recordedAt: new Date(result.data.recordedAt), isFlagged },
  });
  res.json({ result: updated });
});

router.delete('/results/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.labResult.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Lab result not found' });
    return;
  }
  await prisma.labResult.delete({ where: { id: req.params.id } });

  // If this was auto-extracted, record it so sync won't re-create it
  if (existing.sourceRecordId) {
    await prisma.syncIgnoreItem.upsert({
      where: {
        userId_itemType_itemKey: {
          userId: req.userId!,
          itemType: 'LAB',
          itemKey: existing.testName.toLowerCase().trim(),
        },
      },
      create: {
        userId: req.userId!,
        itemType: 'LAB',
        itemKey: existing.testName.toLowerCase().trim(),
      },
      update: {},
    });
  }

  res.json({ message: 'Deleted' });
});

router.get('/vitals', async (req: AuthRequest, res: Response): Promise<void> => {
  const vitals = await prisma.vital.findMany({
    where: { userId: req.userId! },
    orderBy: { recordedAt: 'desc' },
  });
  res.json({ vitals });
});

router.post('/vitals', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = vitalSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const vital = await prisma.vital.create({
    data: {
      userId: req.userId!,
      ...result.data,
      recordedAt: new Date(result.data.recordedAt),
    },
  });

  res.status(201).json({ vital });
});

router.put('/vitals/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.vital.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Vital not found' });
    return;
  }

  const result = vitalSchema.omit({ source: true }).safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const updated = await prisma.vital.update({
    where: { id: req.params.id },
    data: { ...result.data, recordedAt: new Date(result.data.recordedAt) },
  });
  res.json({ vital: updated });
});

router.delete('/vitals/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.vital.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Vital not found' });
    return;
  }
  await prisma.vital.delete({ where: { id: req.params.id } });
  res.json({ message: 'Deleted' });
});

router.post('/apple-health', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = appleHealthSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid Apple Health data format' });
    return;
  }

  const vitalTypeMap: Record<string, VitalType> = {
    'HKQuantityTypeIdentifierBodyMass': 'WEIGHT',
    'HKQuantityTypeIdentifierHeartRate': 'HEART_RATE',
    'HKQuantityTypeIdentifierStepCount': 'STEPS',
    'HKQuantityTypeIdentifierBloodGlucose': 'BLOOD_GLUCOSE',
    'HKQuantityTypeIdentifierOxygenSaturation': 'OXYGEN_SATURATION',
    'HKCategoryTypeIdentifierSleepAnalysis': 'SLEEP_HOURS',
    weight: 'WEIGHT',
    heart_rate: 'HEART_RATE',
    steps: 'STEPS',
    blood_glucose: 'BLOOD_GLUCOSE',
    oxygen_saturation: 'OXYGEN_SATURATION',
    sleep: 'SLEEP_HOURS',
  };

  let imported = 0;

  for (const item of result.data.data) {
    const vitalType = vitalTypeMap[item.type];
    if (!vitalType) continue;

    await prisma.vital.create({
      data: {
        userId: req.userId!,
        type: vitalType,
        value: item.value,
        unit: item.unit,
        recordedAt: new Date(item.startDate),
        source: 'apple_health',
      },
    });
    imported++;
  }

  res.json({ message: `Imported ${imported} data points from Apple Health`, imported });
});

const imagingSchema = z.object({
  studyType: z.nativeEnum(ImagingStudyType),
  bodyPart: z.string().min(1),
  description: z.string().optional(),
  studyDate: z.string(),
  facility: z.string().optional(),
  radiologist: z.string().optional(),
  providerName: z.string().optional(),
  summary: z.string().min(1),
  notes: z.string().optional(),
});

router.get('/imaging', async (req: AuthRequest, res: Response): Promise<void> => {
  const studies = await prisma.imagingStudy.findMany({
    where: { userId: req.userId! },
    orderBy: { studyDate: 'desc' },
  });
  res.json({ studies });
});

router.post('/imaging', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = imagingSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }
  const study = await prisma.imagingStudy.create({
    data: {
      userId: req.userId!,
      ...result.data,
      studyDate: new Date(result.data.studyDate),
    },
  });
  res.status(201).json({ study });
});

router.put('/imaging/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.imagingStudy.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Imaging study not found' });
    return;
  }

  const result = imagingSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const updated = await prisma.imagingStudy.update({
    where: { id: req.params.id },
    data: { ...result.data, studyDate: new Date(result.data.studyDate) },
  });
  res.json({ study: updated });
});

router.delete('/imaging/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.imagingStudy.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Imaging study not found' });
    return;
  }
  await prisma.imagingStudy.delete({ where: { id: req.params.id } });

  // Record so sync won't re-create it (key = studyType:bodyPart normalized)
  const ignoreKey = `${existing.studyType}:${existing.bodyPart.toLowerCase().trim()}`;
  await prisma.syncIgnoreItem.upsert({
    where: {
      userId_itemType_itemKey: {
        userId: req.userId!,
        itemType: 'IMAGING',
        itemKey: ignoreKey,
      },
    },
    create: { userId: req.userId!, itemType: 'IMAGING', itemKey: ignoreKey },
    update: {},
  });

  res.json({ message: 'Deleted' });
});

export default router;
