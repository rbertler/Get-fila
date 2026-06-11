import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';

const router = Router();

/**
 * Returns a normalized lowercase key for deduplication.
 * Strips honorifics (Dr., Dr) and trailing credentials (MD, DO, etc.)
 * so "Dr. Amanda Vance, MD" and "Amanda Vance, MD" resolve to "amanda vance".
 */
export function normalizeProviderKey(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .replace(/\s*,?\s*(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP|MPH|MBA|MS|BS)\.?(\s*,\s*(?:MD|DO|NP|PA|RN|PhD|FACOG|FACP|FACS|FAAFP|MPH|MBA|MS|BS)\.?)*$/gi, '')
    .toLowerCase()
    .trim();
}
router.use(requireAuth);

const providerSchema = z.object({
  name: z.string().min(1, 'Provider name is required'),
  providerType: z.string().optional(),
  specialty: z.string().optional(),
  affiliation: z.string().optional(),
  phone: z.string().optional(),
  fax: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  website: z.string().optional(),
  notes: z.string().optional(),
});

const updateSchema = providerSchema.partial().extend({ isArchived: z.boolean().optional() });

// ── List ────────────────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const providers = await prisma.provider.findMany({
    where: { userId: req.userId! },
    orderBy: { name: 'asc' },
  });
  res.json({ providers });
});

// ── Create (manual) ─────────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = providerSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  // Deduplicate by name (case-insensitive) for this user
  const existing = await prisma.provider.findFirst({
    where: { userId: req.userId!, name: { equals: result.data.name, mode: 'insensitive' } },
  });
  if (existing) {
    res.status(409).json({ error: 'A provider with this name already exists', existing });
    return;
  }

  const provider = await prisma.provider.create({
    data: { userId: req.userId!, ...result.data, isManual: true },
  });
  res.status(201).json({ provider });
});

// ── Update ───────────────────────────────────────────────────────────────────
router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = updateSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const existing = await prisma.provider.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }

  const updated = await prisma.provider.update({
    where: { id: req.params.id },
    data: result.data,
  });

  // If the name changed, cascade to all related records across the app.
  // Labs/imaging store the ordering-provider string parsed from the document,
  // which can differ from the directory name (e.g. "Austin, C" vs
  // "Austin, C, MD"), so match on normalized key rather than exact name.
  if (result.data.name && result.data.name !== existing.name) {
    const oldKey = normalizeProviderKey(existing.name);
    const newName = result.data.name;
    const userId = req.userId!;

    const tables = [
      prisma.medicalRecord,
      prisma.labResult,
      prisma.imagingStudy,
      prisma.appointment,
    ];
    await Promise.all(tables.map(async (table) => {
      const rows: { providerName: string | null }[] = await (table as any).findMany({
        where: { userId },
        select: { providerName: true },
        distinct: ['providerName'],
      });
      const matching = rows
        .map(r => r.providerName)
        .filter((n): n is string => !!n && normalizeProviderKey(n) === oldKey);
      if (matching.length) {
        await (table as any).updateMany({
          where: { userId, providerName: { in: matching } },
          data: { providerName: newName },
        });
      }
    }));
  }

  res.json({ provider: updated });
});

// ── Delete ───────────────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.provider.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Provider not found' });
    return;
  }
  await prisma.provider.delete({ where: { id: req.params.id } });

  // If this was auto-extracted, record it so sync won't re-create it
  if (!existing.isManual) {
    const ignoreKey = normalizeProviderKey(existing.name);
    await prisma.syncIgnoreItem.upsert({
      where: {
        userId_itemType_itemKey: {
          userId: req.userId!,
          itemType: 'PROVIDER',
          itemKey: ignoreKey,
        },
      },
      create: { userId: req.userId!, itemType: 'PROVIDER', itemKey: ignoreKey },
      update: {},
    });
  }

  res.json({ message: 'Provider deleted' });
});

// ── Sync: build directory from existing records + appointments ───────────────
router.post('/sync', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;

  // Collect provider names from records
  const records = await prisma.medicalRecord.findMany({
    where: { userId, providerName: { not: null } },
    select: { id: true, providerName: true, recordType: true },
  });

  // Collect provider names + specialties from appointments
  const appointments = await prisma.appointment.findMany({
    where: { userId },
    select: { providerName: true, specialty: true },
  });

  // Build a de-duplicated map: normalizedKey → { name, specialty, recordIds }
  // Use normalized key (strips Dr./credentials) to prevent duplicates when names have been renamed
  const map = new Map<string, { name: string; specialty?: string; recordIds: string[] }>();

  for (const r of records) {
    if (!r.providerName) continue;
    const key = normalizeProviderKey(r.providerName);
    const entry = map.get(key) ?? { name: r.providerName.trim(), recordIds: [] };
    entry.recordIds.push(r.id);
    map.set(key, entry);
  }

  for (const a of appointments) {
    if (!a.providerName) continue;
    const key = normalizeProviderKey(a.providerName);
    const entry = map.get(key) ?? { name: a.providerName.trim(), recordIds: [] };
    if (a.specialty && !entry.specialty) entry.specialty = a.specialty;
    map.set(key, entry);
  }

  // Load ignore list — don't re-create providers the user has deliberately deleted
  const ignored = await prisma.syncIgnoreItem.findMany({
    where: { userId, itemType: 'PROVIDER' },
    select: { itemKey: true },
  });
  const ignoredKeys = new Set(ignored.map(i => i.itemKey));

  // Load existing providers indexed by normalized key for fast lookup
  const allExisting = await prisma.provider.findMany({ where: { userId } });
  const existingByKey = new Map<string, typeof allExisting[number]>();
  for (const p of allExisting) {
    existingByKey.set(normalizeProviderKey(p.name), p);
  }

  let created = 0;
  let updated = 0;

  for (const [normalizedKey, data] of map) {
    // Skip if user has explicitly deleted this provider
    if (ignoredKeys.has(normalizedKey)) continue;

    const existing = existingByKey.get(normalizedKey);

    if (!existing) {
      await prisma.provider.create({
        data: {
          userId,
          name: data.name,
          specialty: data.specialty,
          sourceRecordIds: data.recordIds,
          isManual: false,
        },
      });
      created++;
    } else {
      // Merge any new record IDs
      const newIds = Array.from(
        new Set([...existing.sourceRecordIds, ...data.recordIds])
      );
      const changed =
        newIds.length !== existing.sourceRecordIds.length ||
        (!existing.specialty && data.specialty);
      if (changed) {
        await prisma.provider.update({
          where: { id: existing.id },
          data: {
            sourceRecordIds: newIds,
            specialty: existing.specialty ?? data.specialty,
          },
        });
        updated++;
      }
    }
  }

  res.json({ message: `Sync complete: ${created} added, ${updated} updated`, created, updated });
});

export default router;
