import { Router, Response } from 'express';
import { z } from 'zod';
import { HistoryCategory } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';

const router = Router();
router.use(requireAuth);

const entrySchema = z.object({
  category: z.nativeEnum(HistoryCategory),
  name: z.string().min(1),
  details: z.string().optional(),
  relative: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sourceRecordId: z.string().optional(),
});

// All fields optional for PATCH; nullable fields can be set to null to clear them
const updateSchema = z.object({
  category: z.nativeEnum(HistoryCategory).optional(),
  name: z.string().min(1).optional(),
  details: z.string().nullable().optional(),
  relative: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  sourceRecordId: z.string().optional(),
});

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const entries = await prisma.medicalHistoryEntry.findMany({
    where: { userId: req.userId! },
    orderBy: [{ category: 'asc' }, { startDate: 'desc' }],
  });
  res.json({ entries });
});

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = entrySchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const entry = await prisma.medicalHistoryEntry.create({
    data: {
      userId: req.userId!,
      ...result.data,
      startDate: result.data.startDate ? new Date(result.data.startDate) : undefined,
      endDate: result.data.endDate ? new Date(result.data.endDate) : undefined,
      isManual: true,
    },
  });

  res.status(201).json({ entry });
});

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = updateSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const existing = await prisma.medicalHistoryEntry.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  // If an auto-extracted entry is being edited by the user, take two actions:
  // 1. Add the OLD name to the ignore list so sync never re-creates the original extraction
  // 2. Mark it as manual so the user owns it going forward
  const nameChanging = result.data.name && result.data.name.toLowerCase().trim() !== existing.name.toLowerCase().trim();
  if (!existing.isManual && (nameChanging || result.data.details !== undefined)) {
    await prisma.syncIgnoreItem.upsert({
      where: {
        userId_itemType_itemKey: {
          userId: req.userId!,
          itemType: existing.category,
          itemKey: existing.name.toLowerCase().trim(),
        },
      },
      create: {
        userId: req.userId!,
        itemType: existing.category,
        itemKey: existing.name.toLowerCase().trim(),
      },
      update: {},
    });
  }

  const updated = await prisma.medicalHistoryEntry.update({
    where: { id: req.params.id },
    data: {
      ...result.data,
      // null clears the field; string converts to Date; undefined leaves unchanged
      startDate: result.data.startDate === null ? null : result.data.startDate ? new Date(result.data.startDate) : undefined,
      endDate: result.data.endDate === null ? null : result.data.endDate ? new Date(result.data.endDate) : undefined,
      // Preserve isManual — badge reflects how the entry was created, not whether it was edited
    },
  });

  res.json({ entry: updated });
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.medicalHistoryEntry.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Entry not found' });
    return;
  }

  await prisma.medicalHistoryEntry.delete({ where: { id: req.params.id } });

  // If this was an auto-extracted entry, record it so sync won't re-create it
  if (!existing.isManual) {
    await prisma.syncIgnoreItem.upsert({
      where: {
        userId_itemType_itemKey: {
          userId: req.userId!,
          itemType: existing.category,
          itemKey: existing.name.toLowerCase().trim(),
        },
      },
      create: {
        userId: req.userId!,
        itemType: existing.category,
        itemKey: existing.name.toLowerCase().trim(),
      },
      update: {},
    });
  }

  res.json({ message: 'Entry deleted' });
});

// ── Extract medication suggestions from uploaded records ─────────────────────
router.get('/extract-medications', async (req: AuthRequest, res: Response): Promise<void> => {
  const records = await prisma.medicalRecord.findMany({
    where: { userId: req.userId!, extractedText: { not: null } },
    select: { id: true, fileName: true, extractedText: true, providerName: true, recordDate: true },
    orderBy: { recordDate: 'desc' },
  });

  const existing = await prisma.medicalHistoryEntry.findMany({
    where: { userId: req.userId!, category: 'MEDICATION' },
    select: { name: true },
  });
  const existingNames = new Set(existing.map(e => e.name.toLowerCase()));

  const suggestions: { name: string; details: string; sourceRecordId: string; sourceFileName: string }[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const text = record.extractedText ?? '';
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let inMedSection = false;
    for (const line of lines) {
      const lower = line.toLowerCase();

      // Detect medication section headers
      if (/medications?|prescriptions?|current\s+meds?|active\s+meds?/i.test(lower) && line.length < 60) {
        inMedSection = true;
        continue;
      }
      // Exit section on other headers
      if (inMedSection && /^(allergies|diagnos|problem|assessment|plan|lab|vital|history|physical|review)/i.test(lower) && line.length < 60) {
        inMedSection = false;
      }

      const hasDosage = /\b\d+\s*(mg|mcg|ml|g|iu|units?|tablet|capsule|tab|cap|patch|spray|drop|puff)\b/i.test(line);
      const hasMedKeyword = inMedSection && line.length > 3 && line.length < 120;

      if (hasDosage || hasMedKeyword) {
        // Clean up bullet/list characters
        const cleaned = line.replace(/^[-•*·\d.)\s]+/, '').trim();
        if (cleaned.length < 4) continue;

        // Split name from instructions if present (e.g. "Metformin 500mg - take twice daily")
        const match = cleaned.match(/^([^–—\-:,]+(?:\s+\d+\s*(?:mg|mcg|ml|g|iu|units?|tablet|capsule|tab|cap)[^\s,]*)?)\s*[–—\-:]?\s*(.*)$/i);
        const name = match ? match[1].trim() : cleaned;
        const details = match && match[2] ? match[2].trim() : '';

        const key = name.toLowerCase();
        if (seen.has(key) || existingNames.has(key) || name.length < 3) continue;
        seen.add(key);

        suggestions.push({ name, details, sourceRecordId: record.id, sourceFileName: record.fileName });
      }
    }
  }

  res.json({ suggestions, recordCount: records.length });
});

export default router;

