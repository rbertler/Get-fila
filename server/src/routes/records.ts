import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { RecordType } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { saveFile, deleteFile, readFile } from '../services/storage.js';
import { extractTextFromPdf } from '../services/pdfParser.js';
import { parseLabResultsFromText, parseConditionsFromText, parseImagingFromText, parseProviderFromText, parseOrderingProviderFromText, parseProviderFromFileName, parseDateFromFileName, normalizeLabTestName, canonicalizeLabTestName, isOrganizationProviderName } from '../services/recordExtractor.js';
import { extractWithAI } from '../services/aiExtractor.js';
import { normalizeProviderKey } from './providers.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * Normalize a drug name to its base form for deduplication.
 * Strips dosage amounts, salt forms (HCl, HBr, etc.), release modifiers (ER, XR, SR),
 * and parenthetical content so that e.g. "Sertraline HCl 25 mg", "Sertraline 25 mg",
 * and "Sertraline" all reduce to "sertraline".
 */
/**
 * Returns true if `candidate` is subsumed by `existing` — i.e., the candidate
 * is a less-specific version of the existing entry and should be skipped.
 * e.g. "Endometriosis" is subsumed by "Cul-de-sac Endometriosis".
 * e.g. "Hemorrhagic Ovarian Cyst" is subsumed by "Right Hemorrhagic Ovarian Cyst".
 */
function isSubsumedCondition(candidate: string, existing: string): boolean {
  const a = candidate.toLowerCase().trim();
  const b = existing.toLowerCase().trim();
  if (a === b) return false; // exact match handled separately
  // candidate is subsumed if all its words appear as a contiguous phrase in existing
  return b.includes(a);
}

/**
 * Given a list of condition names (from the same extraction batch), remove any
 * entry that is a less-specific substring of another entry in the same batch.
 * Keeps the most specific (longest matching) form.
 */
function deduplicateExtractedConditions(names: string[]): string[] {
  return names.filter((name) =>
    !names.some(
      (other) => other !== name && other.toLowerCase().includes(name.toLowerCase()) && other.length > name.length
    )
  );
}

function normalizeDrugName(name: string): string {
  return name
    // Remove parenthetical content: "Vyvanse (Lisdexamfetamine Dimesylate)" → "Vyvanse"
    .replace(/\s*\([^)]*\)/g, '')
    // Strip dosage: "25 mg", "0.5 mcg", etc. and everything after
    .replace(/\s+\d+\.?\d*\s*(mg|mcg|ml|g|iu|units?|tablets?|capsules?|tabs?|caps?|patch|spray|drops?|puffs?)\b.*/gi, '')
    // Strip common salt and formulation suffixes and everything after
    .replace(/\s+(hcl|hydrochloride|hbr|hydrobromide|sodium|potassium|sulfate|maleate|tartrate|acetate|fumarate|succinate|citrate|mesylate|phosphate|besylate|dimesylate|er|xr|sr|cr|la|xl|ir)\b.*/gi, '')
    .trim()
    .toLowerCase();
}

/**
 * Returns all normalized name variants for a drug entry.
 * Includes the normalized base name AND any normalized generic names found in parentheses,
 * so "Concerta (Methylphenidate HCl ER)" produces both "concerta" and "methylphenidate".
 */
function allDrugNameVariants(name: string): string[] {
  const variants = new Set<string>();
  variants.add(normalizeDrugName(name));
  // Extract content from parentheses and normalize it too
  const parenMatches = name.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    for (const m of parenMatches) {
      const inner = m.slice(1, -1);
      const normalized = normalizeDrugName(inner);
      if (normalized) variants.add(normalized);
    }
  }
  return Array.from(variants).filter(Boolean);
}

// Credentials that should stay fully uppercase (e.g. MD, NP)
const UPPER_CREDENTIALS = new Set(['MD', 'DO', 'NP', 'PA', 'RN', 'DDS', 'DPM', 'DC', 'OD', 'DVM', 'CNM', 'CRNA', 'DNP', 'ARNP', 'FNP', 'CNP', 'ANP', 'GNP', 'PNP', 'WHNP', 'AGNP', 'II', 'III', 'IV', 'LP', 'LCSW', 'LMFT', 'LPC', 'PMHNP']);
// Credentials with mixed casing
const MIXED_CREDENTIALS: Record<string, string> = { PHD: 'PhD', PHARMD: 'PharmD', JR: 'Jr', SR: 'Sr' };

/** Title-case a provider name, preserving credential abbreviations. */
function titleCaseProviderName(name: string): string {
  return name
    .split(',')
    .map(part =>
      part.trim().split(/\s+/).filter(Boolean).map(word => {
        const up = word.toUpperCase();
        if (UPPER_CREDENTIALS.has(up)) return up;
        if (MIXED_CREDENTIALS[up]) return MIXED_CREDENTIALS[up];
        // Single letter followed by period → uppercase initial (e.g. "l." → "L.")
        if (/^[a-zA-Z]\.$/.test(word)) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }).join(' ')
    )
    .join(', ');
}

/**
 * Normalize a provider name:
 * 1. Convert "First [Middle] Last, Credential" → "Last, First [Middle], Credential"
 * 2. Title-case the result (ROBERTS, CHELSEA → Roberts, Chelsea)
 */
function isCredentialPart(s: string): boolean {
  const up = s.toUpperCase();
  return (
    UPPER_CREDENTIALS.has(up) ||
    up in MIXED_CREDENTIALS ||
    /^RD$|^RDN$|^PA-C$|^LCPC$|^LICSW$/i.test(s) ||
    (/^[A-Z]{2,6}$/.test(s) && s.length <= 6)   // short all-caps abbreviation
  );
}

function normalizeProviderName(name: string): string {
  if (!name || !name.trim()) return name;
  // Medical groups/organizations (e.g., "Function Health", "Quest Diagnostics") aren't
  // "Last, First" people — reordering them would mangle the name (e.g., "Health, Function").
  // Keep them as-is, just title-cased.
  if (isOrganizationProviderName(name)) return titleCaseProviderName(name.trim());
  const parts = name.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return name;
  const firstPart = parts[0];

  let normalized: string;
  if (!firstPart.includes(' ')) {
    // Starts with a single token — assume it's the last name.
    // Detect "Last, Credential, First" (some EMRs put credential before first name)
    // and reorder to "Last, First, Credential".
    if (parts.length >= 3) {
      // Find the credential among the remaining parts
      const credIdx = parts.findIndex((p, i) => i > 0 && isCredentialPart(p));
      if (credIdx !== -1) {
        const credential = parts[credIdx];
        const otherParts = parts.filter((_, i) => i !== credIdx && i !== 0);
        normalized = `${firstPart}, ${otherParts.join(', ')}, ${credential}`;
      } else {
        normalized = name;
      }
    } else {
      // "Last, First [Credential]" — keep order, just title-case
      normalized = name;
    }
  } else {
    // "First [Middle] Last [, Credential]" format — reorder to "Last, First [Middle], Credential"
    const words = firstPart.split(/\s+/).filter(Boolean);
    const lastName = words[words.length - 1];
    const firstName = words.slice(0, -1).join(' ');
    const credential = parts.slice(1).join(', ');
    const base = [lastName, firstName].filter(Boolean).join(', ');
    normalized = credential ? `${base}, ${credential}` : base;
  }

  return titleCaseProviderName(normalized);
}

const updateSchema = z.object({
  fileName: z.string().min(1).optional(),
  recordType: z.nativeEnum(RecordType).optional(),
  recordDate: z.string().optional(),
  providerName: z.string().nullable().optional(),
  notes: z.string().optional(),
});

router.use(requireAuth);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const records = await prisma.medicalRecord.findMany({
    where: { userId: req.userId! },
    orderBy: { recordDate: 'desc' },
    select: {
      id: true,
      fileName: true,
      fileSize: true,
      mimeType: true,
      recordType: true,
      recordDate: true,
      providerName: true,
      notes: true,
      createdAt: true,
    },
  });
  res.json({ records });
});

router.post(
  '/',
  upload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    if (req.file.mimetype !== 'application/pdf') {
      res.status(400).json({ error: 'Only PDF files are supported' });
      return;
    }

    const recordTypeRaw = req.body.recordType as string | undefined;
    const recordType: RecordType =
      recordTypeRaw && Object.values(RecordType).includes(recordTypeRaw as RecordType)
        ? (recordTypeRaw as RecordType)
        : 'OTHER';

    let stored;
    try {
      stored = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    } catch (err) {
      console.error('[records] saveFile failed:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to store file' });
      return;
    }
    const extractedText = await extractTextFromPdf(req.file.buffer);

    const providerName: string | undefined = req.body.providerName ?? undefined;
    const recordName: string = (req.body.recordName as string | undefined)?.trim() || req.file.originalname;

    const record = await prisma.medicalRecord.create({
      data: {
        userId: req.userId!,
        fileName: recordName,
        fileSize: stored.fileSize,
        mimeType: stored.mimeType,
        storagePath: stored.storagePath,
        extractedText,
        recordType,
        recordDate: req.body.recordDate ? new Date(req.body.recordDate) : undefined,
        providerName,
        notes: req.body.notes ?? undefined,
      },
    });

    // ── AI extraction (skipped for AI_SUMMARY records) ────────────────────────
    if (extractedText && recordType !== 'AI_SUMMARY') {
      const userId = req.userId!;

      // Try AI first; fall back to regex if AI unavailable/fails
      const aiResult = await extractWithAI(extractedText, recordType);

      // Resolve provider name: explicit user input > AI > regex > filename
      let resolvedProvider = providerName
        ?? aiResult?.provider?.name
        ?? parseProviderFromText(extractedText)
        ?? parseProviderFromFileName(record.fileName)
        ?? undefined;

      // Normalize to "Last, First [Middle], Credential" format
      if (resolvedProvider) resolvedProvider = normalizeProviderName(resolvedProvider);

      // For labs and imaging entries specifically, the ordering provider in the
      // document takes priority (it may differ from the record-level/signing provider).
      const rawOrderingProvider = parseOrderingProviderFromText(extractedText);
      const orderingProvider = rawOrderingProvider ? normalizeProviderName(rawOrderingProvider) : null;
      const labImagingProvider = orderingProvider ?? resolvedProvider;

      // Back-fill record's providerName and/or recordDate if resolved via AI/regex
      const backfill: Record<string, unknown> = {};
      if (!providerName && resolvedProvider) backfill.providerName = resolvedProvider;
      const fileNameDate = parseDateFromFileName(record.fileName);
      if (!req.body.recordDate && aiResult?.recordDate) backfill.recordDate = new Date(aiResult.recordDate);
      else if (!req.body.recordDate && !aiResult?.recordDate && fileNameDate) backfill.recordDate = new Date(fileNameDate);
      if (Object.keys(backfill).length > 0) {
        await prisma.medicalRecord.update({ where: { id: record.id }, data: backfill });
      }

      // Effective date for child records: user-supplied > AI-extracted > filename > createdAt
      const effectiveDate: Date =
        req.body.recordDate ? new Date(req.body.recordDate)
        : aiResult?.recordDate ? new Date(aiResult.recordDate)
        : fileNameDate ? new Date(fileNameDate)
        : record.createdAt;

      // Upsert provider directory
      if (resolvedProvider) {
        const normKey = normalizeProviderKey(resolvedProvider);
        const isOrg = isOrganizationProviderName(resolvedProvider);
        // Match by normalized key so "Smith, J, MD" and "Smith, J" don't create duplicates
        const allProviders = await prisma.provider.findMany({ where: { userId }, select: { id: true, name: true, affiliation: true, providerType: true, specialty: true, sourceRecordIds: true } });
        const existingProvider = allProviders.find(p => normalizeProviderKey(p.name) === normKey) ?? null;
        if (!existingProvider) {
          await prisma.provider.create({
            data: {
              userId,
              name: resolvedProvider,
              // When no individual clinician is identified and we only have a medical
              // group/organization (e.g., "Function Health"), use that name as the
              // affiliation too — bypassing the usual individual-name requirement —
              // so the directory entry surfaces and sorts under the group's name.
              affiliation: isOrg ? resolvedProvider : undefined,
              providerType: aiResult?.provider?.providerType ?? (isOrg ? 'Medical Group' : undefined),
              specialty: aiResult?.provider?.specialty ?? undefined,
              sourceRecordIds: [record.id],
              isManual: false,
            },
          });
        } else {
          const ids = Array.from(new Set([...existingProvider.sourceRecordIds, record.id]));
          await prisma.provider.update({
            where: { id: existingProvider.id },
            data: {
              sourceRecordIds: ids,
              ...(isOrg && !existingProvider.affiliation && { affiliation: resolvedProvider }),
              ...(aiResult?.provider?.providerType && !existingProvider.providerType && { providerType: aiResult.provider.providerType }),
              ...(aiResult?.provider?.specialty && !existingProvider.specialty && { specialty: aiResult.provider.specialty }),
            },
          });
        }
      }

      let labsAdded = 0, conditionsAdded = 0, medicationsAdded = 0, imagingAdded = 0, vitalsAdded = 0, providersAdded = resolvedProvider ? 1 : 0;

      if (aiResult) {
        // ── Labs ──────────────────────────────────────────────────────────────
        const existingLabNames = new Set(
          (await prisma.labResult.findMany({ where: { userId }, select: { testName: true } }))
            .map(l => normalizeLabTestName(l.testName))
        );
        for (const lab of aiResult.labs) {
          const canonicalName = canonicalizeLabTestName(lab.testName);
          const key = normalizeLabTestName(canonicalName);
          if (existingLabNames.has(key)) continue;
          // Use per-lab date when AI provides one; fall back to record-level effectiveDate
          const labDate = lab.recordedAt ? new Date(lab.recordedAt) : effectiveDate;
          await prisma.labResult.create({
            data: {
              userId,
              testName: canonicalName,
              value: lab.value,
              unit: lab.unit,
              referenceMin: lab.referenceMin,
              referenceMax: lab.referenceMax,
              isFlagged: lab.isFlagged,
              recordedAt: isNaN(labDate.getTime()) ? effectiveDate : labDate,
              sourceRecordId: record.id,
              providerName: labImagingProvider,
            },
          });
          existingLabNames.add(key);
          labsAdded++;
        }

        // ── Conditions ────────────────────────────────────────────────────────
        const existingCondNamesRaw = (await prisma.medicalHistoryEntry.findMany({ where: { userId, category: 'CONDITION' }, select: { name: true } }))
          .map(c => c.name.toLowerCase());
        const existingCondNames = new Set(existingCondNamesRaw);
        // Deduplicate within the extracted batch (drop less-specific variants)
        const dedupedCondNames = deduplicateExtractedConditions(aiResult.conditions.map(c => c.name));
        const dedupedConds = aiResult.conditions.filter(c => dedupedCondNames.includes(c.name));
        for (const cond of dedupedConds) {
          const key = cond.name.toLowerCase();
          if (existingCondNames.has(key)) continue;
          // Skip if a more-specific version of this condition already exists in the DB
          if (existingCondNamesRaw.some(existing => existing.includes(key) && existing !== key)) continue;
          // If new condition subsumes an existing one, skip (the existing is already more specific)
          if (existingCondNamesRaw.some(existing => isSubsumedCondition(existing, key))) continue;
          // Use per-condition date when AI provides one; fall back to effectiveDate
          const condDate = cond.startDate ? new Date(cond.startDate) : effectiveDate;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'CONDITION', name: cond.name, details: cond.details,
              startDate: isNaN(condDate.getTime()) ? effectiveDate : condDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingCondNames.add(key);
          conditionsAdded++;
        }

        // ── Medications ───────────────────────────────────────────────────────
        const existingMedsRaw = await prisma.medicalHistoryEntry.findMany({ where: { userId, category: 'MEDICATION' }, select: { name: true } });
        const existingMedNames = new Set(existingMedsRaw.map(m => m.name.toLowerCase()));
        // Normalized set: "Sertraline HCl 25 mg" → "sertraline" so it blocks a bare "Sertraline" re-extraction
        const existingMedNormalized = new Set(existingMedsRaw.flatMap(m => allDrugNameVariants(m.name)));
        for (const med of aiResult.medications) {
          // Combine name + dosage into the name field (matches how the UI stores/displays it)
          const combinedName = [med.name.trim(), med.dosage?.trim()].filter(Boolean).join(' ');
          const key = combinedName.toLowerCase();
          const normalizedKey = normalizeDrugName(combinedName);
          if (existingMedNames.has(key) || existingMedNormalized.has(normalizedKey)) continue;
          // Reject entries that look like document field names, date fragments, or bare dosage words
          if (/^(status|repeat|number|dispense|quantity|last\s*modified|organization|details|time|date|notes?|comments?|indication|directions?|instructions?|sig|refills?|ndc|fill|filled|prescribed|prescriber|pharmacy|days?\s*supply|route|form|strength|unit|units)$/i.test(med.name.trim())) continue;
          if (/^[\d\/\-]+$/.test(med.name.trim()) || /^(tablet|capsule|cap|tab|patch|spray|drop|puff|solution|suspension|injection)s?$/i.test(med.name.trim())) continue;
          if (/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}$/.test(med.name.trim())) continue;
          // Use per-medication date when AI provides one; fall back to the record's effective date
          const medDate = med.startDate ? new Date(med.startDate) : null;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'MEDICATION',
              name: combinedName,
              details: med.details || undefined,
              startDate: medDate && !isNaN(medDate.getTime()) ? medDate : effectiveDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingMedNames.add(key);
          existingMedNormalized.add(normalizedKey);
          medicationsAdded++;
        }

        // ── Surgeries ─────────────────────────────────────────────────────────
        const existingSurgeryNames = new Set(
          (await prisma.medicalHistoryEntry.findMany({ where: { userId, category: 'SURGERY' }, select: { name: true } }))
            .map(s => s.name.toLowerCase().trim())
        );
        for (const surg of aiResult.surgeries ?? []) {
          const key = surg.name.toLowerCase().trim();
          if (existingSurgeryNames.has(key)) continue;
          const surgDate = surg.startDate ? new Date(surg.startDate) : null;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'SURGERY',
              name: surg.name,
              details: surg.details || undefined,
              startDate: surgDate && !isNaN(surgDate.getTime()) ? surgDate : effectiveDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingSurgeryNames.add(key);
        }

        // ── Imaging ───────────────────────────────────────────────────────────
        if (aiResult.imaging) {
          const img = aiResult.imaging;
          const alreadyExists = await prisma.imagingStudy.findFirst({
            where: { userId, studyType: img.studyType, bodyPart: { equals: img.bodyPart, mode: 'insensitive' } },
          });
          if (!alreadyExists) {
            const studyDate = img.studyDate ? new Date(img.studyDate) : (record.recordDate ?? record.createdAt);
            await prisma.imagingStudy.create({
              data: {
                userId,
                studyType: img.studyType,
                bodyPart: img.bodyPart,
                description: img.description ?? undefined,
                summary: img.summary,
                facility: img.facility,
                studyDate: isNaN(studyDate.getTime()) ? (record.recordDate ?? record.createdAt) : studyDate,
                providerName: labImagingProvider,
                sourceRecordId: record.id,
              },
            });
            imagingAdded++;
          }
        }

        // ── Vitals ────────────────────────────────────────────────────────────
        for (const vital of (aiResult.vitals ?? [])) {
          const vitalDate = vital.recordedAt ? new Date(vital.recordedAt) : effectiveDate;
          const effectiveVitalDate = isNaN(vitalDate.getTime()) ? effectiveDate : vitalDate;
          // Deduplicate: skip if same type + sourceRecordId already exists
          const alreadyExists = await prisma.vital.findFirst({
            where: { userId, type: vital.type as any, sourceRecordId: record.id },
          });
          if (alreadyExists) continue;
          await prisma.vital.create({
            data: {
              userId,
              type: vital.type as any,
              value: vital.value,
              value2: vital.value2 ?? undefined,
              unit: vital.unit,
              recordedAt: effectiveVitalDate,
              source: 'record',
              sourceRecordId: record.id,
            },
          });
          vitalsAdded++;
        }
      } else {
        // ── Regex fallback (no API key or AI failed) ──────────────────────────
        const existingMeds = await prisma.medicalHistoryEntry.findMany({
          where: { userId, category: 'MEDICATION' }, select: { name: true },
        });
        const existingMedNames = new Set(existingMeds.map(e => e.name.toLowerCase()));
        const suggestions = parseMedicationsFromText(extractedText);
        for (const s of suggestions) {
          const key = s.name.toLowerCase();
          if (existingMedNames.has(key)) continue;
          existingMedNames.add(key);
          await prisma.medicalHistoryEntry.create({
            data: { userId, category: 'MEDICATION', name: s.name, details: s.details || undefined, sourceRecordId: record.id, isManual: false },
          });
          medicationsAdded++;
        }
      }

      res.status(201).json({ record, extracted: { labs: labsAdded, medications: medicationsAdded, conditions: conditionsAdded, imaging: imagingAdded, vitals: vitalsAdded, providers: providersAdded } });
      return;
    }

    res.status(201).json({ record, extracted: { labs: 0, medications: 0, conditions: 0, imaging: 0, vitals: 0, providers: 0 } });
  }
);

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = updateSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const existing = await prisma.medicalRecord.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  const { fileName, recordType, recordDate, providerName, notes } = result.data;
  const updated = await prisma.medicalRecord.update({
    where: { id: req.params.id },
    data: {
      ...(fileName !== undefined && { fileName }),
      ...(recordType !== undefined && { recordType }),
      ...(recordDate !== undefined && { recordDate: new Date(recordDate) }),
      ...(providerName !== undefined && { providerName: providerName ?? null }),
      ...(notes !== undefined && { notes }),
    },
  });

  // Keep provider.sourceRecordIds in sync when providerName changes
  if (providerName !== undefined) {
    const recordId = req.params.id;
    const userId = req.userId!;

    const allProviders = await prisma.provider.findMany({ where: { userId } });

    // Remove from old provider if providerName changed
    if (existing.providerName && existing.providerName !== providerName) {
      const oldKey = normalizeProviderKey(existing.providerName);
      const oldProvider = allProviders.find(p => normalizeProviderKey(p.name) === oldKey);
      if (oldProvider) {
        await prisma.provider.update({
          where: { id: oldProvider.id },
          data: { sourceRecordIds: oldProvider.sourceRecordIds.filter(id => id !== recordId) },
        });
      }
    }

    // Add to new provider — create a manual provider entry if none exists yet
    if (providerName) {
      const newKey = normalizeProviderKey(providerName);
      const newProvider = allProviders.find(p => normalizeProviderKey(p.name) === newKey);
      if (newProvider) {
        if (!newProvider.sourceRecordIds.includes(recordId)) {
          await prisma.provider.update({
            where: { id: newProvider.id },
            data: { sourceRecordIds: [...newProvider.sourceRecordIds, recordId] },
          });
        }
      } else {
        await prisma.provider.create({
          data: {
            userId,
            name: providerName,
            sourceRecordIds: [recordId],
            isManual: true,
          },
        });
      }
    }
  }

  res.json({ record: updated });
});

router.get('/:id/download', async (req: AuthRequest, res: Response): Promise<void> => {
  const record = await prisma.medicalRecord.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  try {
    const buffer = await readFile(record.storagePath);
    res.setHeader('Content-Disposition', `attachment; filename="${record.fileName}"`);
    res.setHeader('Content-Type', record.mimeType);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'File not found in storage' });
  }
});

router.get('/:id/view', async (req: AuthRequest, res: Response): Promise<void> => {
  const record = await prisma.medicalRecord.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  try {
    const buffer = await readFile(record.storagePath);
    res.setHeader('Content-Disposition', `inline; filename="${record.fileName}"`);
    res.setHeader('Content-Type', record.mimeType);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'File not found in storage' });
  }
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const record = await prisma.medicalRecord.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return;
  }

  const deleteAssociated = req.query.deleteAssociated === 'true';

  if (deleteAssociated) {
    // Delete all extracted data sourced from this record
    await prisma.labResult.deleteMany({ where: { userId: req.userId!, sourceRecordId: record.id } });
    await prisma.medicalHistoryEntry.deleteMany({ where: { userId: req.userId!, sourceRecordId: record.id } });
    await prisma.imagingStudy.deleteMany({ where: { userId: req.userId!, sourceRecordId: record.id } });
    await prisma.vital.deleteMany({ where: { userId: req.userId!, sourceRecordId: record.id } });
  }

  // Always remove this record's ID from any provider's sourceRecordIds — even when
  // deleteAssociated is false, dead IDs must not accumulate (they would prevent the
  // provider from being deleted when the last real record is eventually removed).
  const allRecordIds = new Set(
    (await prisma.medicalRecord.findMany({ where: { userId: req.userId! }, select: { id: true } })).map(r => r.id)
  );
  const linkedProviders = await prisma.provider.findMany({
    where: { userId: req.userId!, sourceRecordIds: { has: record.id } },
  });
  for (const provider of linkedProviders) {
    // Strip the deleted record AND any other already-deleted record IDs
    const remaining = provider.sourceRecordIds.filter(id => id !== record.id && allRecordIds.has(id));
    if (remaining.length === 0 && !provider.isManual && deleteAssociated) {
      await prisma.provider.delete({ where: { id: provider.id } });
    } else {
      await prisma.provider.update({ where: { id: provider.id }, data: { sourceRecordIds: remaining } });
    }
  }

  await prisma.medicalRecord.delete({ where: { id: record.id } });
  await deleteFile(record.storagePath);

  res.json({ message: 'Record deleted' });
});

function parseMedicationsFromText(text: string): { name: string; details: string }[] {
  const results: { name: string; details: string }[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let inMedSection = false;

  for (const line of lines) {
    if (/^(medications?|prescriptions?|current\s+meds?|active\s+meds?)\s*:?\s*$/i.test(line)) {
      inMedSection = true;
      continue;
    }
    if (inMedSection && /^(allergies|diagnos|problem|assessment|plan|lab|vital|history|physical|review)/i.test(line) && line.length < 60) {
      inMedSection = false;
    }

    const hasDosage = /\b\d+\.?\d*\s*(mg|mcg|tab|cap|tablet|capsule|patch|spray|puff)\b/i.test(line);
    if (!hasDosage && !inMedSection) continue;
    if (line.length > 120 || line.length < 4) continue;

    // Skip lines that look like anatomical measurements, lab values, or imaging findings
    if (/\b(ovary|ovaries|uterus|uterine|endometrium|cervix|fallopian|adnexa|follicle|corpus\s+luteum|cyst|lesion|mass|nodule|lobe|kidney|liver|spleen|gallbladder|bladder|prostate|thyroid|lymph\s*node|vessel|artery|vein|aorta)\b/i.test(line)) continue;
    if (/\b(enlarged|calcif|echogen|hyperechoic|hypoechoic|heterogeneous|homogeneous|cystic|solid|fluid|volume|dimension|diameter|measurement|cm|mm)\b/i.test(line)) continue;
    if (/\b(white\s+blood|red\s+blood|platelet|hemoglobin|hematocrit|creatinine|glucose|cholesterol|triglyceride|sodium|potassium|chloride|albumin|bilirubin)\b/i.test(line)) continue;

    const cleaned = line.replace(/^[-•*·\d.)\s]+/, '').trim();
    const match = cleaned.match(/^([^–—\-:,]+(?:\s+\d+\s*(?:mg|mcg|tablet|capsule|tab|cap)[^\s,]*)?)\s*[–—\-:]?\s*(.*)$/i);
    const name = (match ? match[1] : cleaned).trim();
    const details = (match?.[2] ?? '').trim();

    // Skip therapeutic category labels and clinical plan language — not actual drug names
    if (/\b(pharmacotherapy|psychostimulant|stimulant|non-stimulant|therapy|treatment\s+plan|regimen|protocol|clinical\s+trial|initiat|category|class|approach|strategy|management|intervention)\b/i.test(name)) continue;
    // Drug names shouldn't be more than 4 words (e.g. "Ferrous Sulfate 325mg daily" is borderline ok, "Psychostimulant Pharmacotherapy" is not a drug)
    if (name.split(/\s+/).length > 5 && !hasDosage) continue;
    // Skip database/document field names that appear in pharmacy export formats
    if (/^(status|repeat|number|dispense|quantity|last\s*modified|organization|details|time|date|notes?|comments?|description|indication|directions?|instructions?|sig|refills?|daw|ndc|fill|filled|prescribed|prescriber|pharmacy|days?\s*supply|route|form|strength|unit|units)$/i.test(name)) continue;
    // Skip entries that look like date fragments or bare dosage words
    if (/^[\d\/\-]+$/.test(name) || /^(tablet|capsule|cap|tab|patch|spray|drop|puff|solution|suspension|injection)s?$/i.test(name)) continue;
    // Skip CamelCase compound words that are clearly database field names (e.g. "StatusNoteIndicationFill")
    if (/^[A-Z][a-z]+(?:[A-Z][a-z]+){2,}$/.test(name)) continue;

    if (name.length >= 3) results.push({ name, details });
  }

  return results;
}

// ── Sync: extract structured data from all records ───────────────────────────
router.post('/sync', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;

  const records = await prisma.medicalRecord.findMany({
    where: { userId, extractedText: { not: null }, recordType: { not: 'AI_SUMMARY' } },
  });

  let labsAdded = 0;
  let conditionsAdded = 0;
  let medicationsAdded = 0;
  let imagingAdded = 0;
  let vitalsAdded = 0;
  let providersAdded = 0;

  // Fetch ignore lists — items the user has explicitly deleted so we don't re-create them
  const ignoredItems = await prisma.syncIgnoreItem.findMany({
    where: { userId },
    select: { itemType: true, itemKey: true },
  });
  const ignoredLabs       = new Set(ignoredItems.filter(i => i.itemType === 'LAB').map(i => i.itemKey));
  const ignoredConditions = new Set(ignoredItems.filter(i => i.itemType === 'CONDITION').map(i => i.itemKey));
  const ignoredMeds       = new Set(ignoredItems.filter(i => i.itemType === 'MEDICATION').map(i => i.itemKey));
  const ignoredImaging    = new Set(ignoredItems.filter(i => i.itemType === 'IMAGING').map(i => i.itemKey));
  const ignoredProviders  = new Set(ignoredItems.filter(i => i.itemType === 'PROVIDER').map(i => i.itemKey));

  // Fetch existing data for deduplication
  const existingLabs = await prisma.labResult.findMany({ where: { userId }, select: { testName: true } });
  const existingLabNames = new Set(existingLabs.map(l => normalizeLabTestName(l.testName)));

  const existingConditions = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'CONDITION' }, select: { name: true },
  });
  const existingConditionNames = new Set(existingConditions.map(c => c.name.toLowerCase()));

  const existingMeds = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'MEDICATION' }, select: { name: true },
  });
  const existingMedNames = new Set(existingMeds.map(m => m.name.toLowerCase()));
  // Normalized set so "Sertraline HCl 25 mg" blocks a bare "Sertraline" and vice versa
  const existingMedNormalized = new Set(existingMeds.flatMap(m => allDrugNameVariants(m.name)));

  const existingImaging = await prisma.imagingStudy.findMany({
    where: { userId }, select: { bodyPart: true, studyType: true },
  });

  // Surgery dedup — initialized once before the loop (like conditions and meds above)
  const existingSurgeries = await prisma.medicalHistoryEntry.findMany({
    where: { userId, category: 'SURGERY' }, select: { name: true },
  });
  const existingSurgeryNames = new Set(existingSurgeries.map(s => s.name.toLowerCase().trim()));

  // Load all providers indexed by normalized key for dedup across name variants (Dr., credentials, etc.)
  const allProviders = await prisma.provider.findMany({ where: { userId } });
  const providerByKey = new Map<string, typeof allProviders[number]>();
  for (const p of allProviders) {
    providerByKey.set(normalizeProviderKey(p.name), p);
  }

  for (const record of records) {
    const text = record.extractedText!;

    // Determine which categories this record has already contributed to.
    // Skipping already-processed categories prevents re-running AI and creating
    // duplicates when sync is called more than once (AI output is non-deterministic).
    const [alreadyExtractedEntries, alreadyHasLabs, alreadyHasImaging] = await Promise.all([
      prisma.medicalHistoryEntry.findMany({
        where: { sourceRecordId: record.id, isManual: false },
        select: { category: true },
      }),
      prisma.labResult.count({ where: { sourceRecordId: record.id } }),
      prisma.imagingStudy.count({ where: { sourceRecordId: record.id } }),
    ]);
    const recordExtractedCategories = new Set(alreadyExtractedEntries.map(e => e.category));
    const recordNeedsLabs        = alreadyHasLabs === 0;
    const recordNeedsConditions  = !recordExtractedCategories.has('CONDITION');
    const recordNeedsMedications = !recordExtractedCategories.has('MEDICATION');
    const recordNeedsSurgeries   = !recordExtractedCategories.has('SURGERY');
    const recordNeedsImaging     = alreadyHasImaging === 0;
    const needsAI = recordNeedsLabs || recordNeedsConditions || recordNeedsMedications
                    || recordNeedsSurgeries || recordNeedsImaging;

    // Try AI extraction first; fall back to regex if unavailable
    const aiResult = needsAI ? await extractWithAI(text, record.recordType) : null;

    // Effective date: stored recordDate > AI-extracted date > createdAt
    const effectiveDate: Date =
      record.recordDate ? record.recordDate
      : aiResult?.recordDate ? new Date(aiResult.recordDate)
      : record.createdAt;

    // Back-fill recordDate on the medical record itself if not yet set
    if (!record.recordDate && aiResult?.recordDate) {
      await prisma.medicalRecord.update({
        where: { id: record.id },
        data: { recordDate: new Date(aiResult.recordDate) },
      });
    }

    // ── Provider ──────────────────────────────────────────────────────────────
    let providerName: string | null = record.providerName
      ?? aiResult?.provider?.name
      ?? parseProviderFromText(text)
      ?? parseProviderFromFileName(record.fileName)
      ?? null;

    // Normalize to "Last, First [Middle], Credential" title-case format
    if (providerName) providerName = normalizeProviderName(providerName);

    // For labs and imaging entries specifically, the ordering provider in the
    // document takes priority (it may differ from the record-level provider).
    const rawOrderingProvider = parseOrderingProviderFromText(text);
    const orderingProvider = rawOrderingProvider ? normalizeProviderName(rawOrderingProvider) : null;
    const labImagingProvider = orderingProvider ?? providerName;

    if (providerName) {
      if (!record.providerName) {
        await prisma.medicalRecord.update({ where: { id: record.id }, data: { providerName } });
      }
      const provNormKey = normalizeProviderKey(providerName);
      const isOrg = isOrganizationProviderName(providerName);
      if (!ignoredProviders.has(provNormKey)) {
        const existingProvider = providerByKey.get(provNormKey);
        if (!existingProvider) {
          const created = await prisma.provider.create({
            data: {
              userId,
              name: providerName,
              // Medical groups/organizations (e.g., "Function Health") have no individual
              // clinician name — surface them by their group name via affiliation instead.
              affiliation: isOrg ? providerName : undefined,
              providerType: aiResult?.provider?.providerType ?? (isOrg ? 'Medical Group' : undefined),
              specialty: aiResult?.provider?.specialty ?? undefined,
              sourceRecordIds: [record.id],
              isManual: false,
            },
          });
          providerByKey.set(provNormKey, created);
          providersAdded++;
        } else {
          const ids = Array.from(new Set([...existingProvider.sourceRecordIds, record.id]));
          const update: Record<string, unknown> = {};
          if (ids.length !== existingProvider.sourceRecordIds.length) update.sourceRecordIds = ids;
          if (isOrg && !existingProvider.affiliation) update.affiliation = providerName;
          if (Object.keys(update).length > 0) {
            await prisma.provider.update({ where: { id: existingProvider.id }, data: update });
            Object.assign(existingProvider, update);
          }
        }
      }
    }

    if (aiResult) {
      // ── Labs (AI) ────────────────────────────────────────────────────────────
      if (recordNeedsLabs) {
        for (const lab of aiResult.labs) {
          const canonicalName = canonicalizeLabTestName(lab.testName);
          const key = normalizeLabTestName(canonicalName);
          if (existingLabNames.has(key) || ignoredLabs.has(key)) continue;
          const labDate = lab.recordedAt ? new Date(lab.recordedAt) : effectiveDate;
          await prisma.labResult.create({
            data: {
              userId,
              testName: canonicalName,
              value: lab.value,
              unit: lab.unit,
              referenceMin: lab.referenceMin,
              referenceMax: lab.referenceMax,
              isFlagged: lab.isFlagged,
              recordedAt: isNaN(labDate.getTime()) ? effectiveDate : labDate,
              sourceRecordId: record.id,
              providerName: labImagingProvider ?? undefined,
            },
          });
          existingLabNames.add(key);
          labsAdded++;
        }
      }

      // ── Conditions (AI) ──────────────────────────────────────────────────────
      if (recordNeedsConditions) {
        const dedupedCondNames = deduplicateExtractedConditions(aiResult.conditions.map(c => c.name));
        const dedupedConds = aiResult.conditions.filter(c => dedupedCondNames.includes(c.name));
        const existingCondNamesArr = Array.from(existingConditionNames);
        for (const cond of dedupedConds) {
          const key = cond.name.toLowerCase();
          if (existingConditionNames.has(key) || ignoredConditions.has(key)) continue;
          // Skip if a more-specific version already exists (e.g. "Cul-de-sac Endometriosis" covers "Endometriosis")
          if (existingCondNamesArr.some(existing => existing.includes(key) && existing !== key)) continue;
          // Skip if this condition subsumes (is more specific than) an existing one — the existing will be kept
          if (existingCondNamesArr.some(existing => isSubsumedCondition(existing, key))) continue;
          // Cross-category dedup: don't add as CONDITION if the same name already exists as a SURGERY
          if (existingSurgeryNames.has(key)) continue;
          const condDate = cond.startDate ? new Date(cond.startDate) : effectiveDate;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'CONDITION', name: cond.name, details: cond.details,
              startDate: isNaN(condDate.getTime()) ? effectiveDate : condDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingConditionNames.add(key);
          existingCondNamesArr.push(key);
          conditionsAdded++;
        }
      }

      // ── Medications (AI) ─────────────────────────────────────────────────────
      if (recordNeedsMedications) {
        for (const med of aiResult.medications) {
          const combinedName = [med.name.trim(), med.dosage?.trim()].filter(Boolean).join(' ');
          const key = combinedName.toLowerCase();
          const normalizedKey = normalizeDrugName(combinedName);
          // Check exact name, normalized base name, and ignore list (both exact and normalized)
          if (existingMedNames.has(key) || existingMedNormalized.has(normalizedKey)) continue;
          if (ignoredMeds.has(key) || ignoredMeds.has(normalizedKey)) continue;
          const medDate = med.startDate ? new Date(med.startDate) : null;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'MEDICATION',
              name: combinedName,
              details: med.details || undefined,
              startDate: medDate && !isNaN(medDate.getTime()) ? medDate : effectiveDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingMedNames.add(key);
          existingMedNormalized.add(normalizedKey);
          medicationsAdded++;
        }
      }

      // ── Surgeries ────────────────────────────────────────────────────────────
      if (recordNeedsSurgeries) {
        for (const surg of aiResult.surgeries ?? []) {
          const key = surg.name.toLowerCase().trim();
          if (existingSurgeryNames.has(key)) continue;
          // Cross-category dedup: skip if already stored as a condition
          if (existingConditionNames.has(key)) continue;
          const surgDate = surg.startDate ? new Date(surg.startDate) : null;
          await prisma.medicalHistoryEntry.create({
            data: {
              userId, category: 'SURGERY',
              name: surg.name,
              details: surg.details || undefined,
              startDate: surgDate && !isNaN(surgDate.getTime()) ? surgDate : effectiveDate,
              sourceRecordId: record.id, isManual: false,
            },
          });
          existingSurgeryNames.add(key);
        }
      }

      // ── Imaging (AI) ─────────────────────────────────────────────────────────
      if (recordNeedsImaging && aiResult.imaging) {
        const img = aiResult.imaging;
        const ignoreKey = `${img.studyType}:${img.bodyPart.toLowerCase().trim()}`;
        const alreadyExists = existingImaging.some(
          i => i.studyType === img.studyType && i.bodyPart.toLowerCase() === img.bodyPart.toLowerCase()
        );
        if (!alreadyExists && !ignoredImaging.has(ignoreKey)) {
          const studyDate = img.studyDate ? new Date(img.studyDate) : effectiveDate;
          await prisma.imagingStudy.create({
            data: {
              userId,
              studyType: img.studyType,
              bodyPart: img.bodyPart,
              description: img.description ?? undefined,
              summary: img.summary,
              facility: img.facility,
              studyDate: isNaN(studyDate.getTime()) ? effectiveDate : studyDate,
              providerName: labImagingProvider ?? undefined,
              sourceRecordId: record.id,
            },
          });
          existingImaging.push({ studyType: img.studyType, bodyPart: img.bodyPart });
          imagingAdded++;
        }
      }

      // ── Vitals (AI) ──────────────────────────────────────────────────────────
      for (const vital of (aiResult.vitals ?? [])) {
        const vitalDate = vital.recordedAt ? new Date(vital.recordedAt) : effectiveDate;
        const effectiveVitalDate = isNaN(vitalDate.getTime()) ? effectiveDate : vitalDate;
        // Deduplicate: skip if same type + sourceRecordId already exists
        const alreadyExists = await prisma.vital.findFirst({
          where: { userId, type: vital.type as any, sourceRecordId: record.id },
        });
        if (alreadyExists) continue;
        await prisma.vital.create({
          data: {
            userId,
            type: vital.type as any,
            value: vital.value,
            value2: vital.value2 ?? undefined,
            unit: vital.unit,
            recordedAt: effectiveVitalDate,
            source: 'record',
            sourceRecordId: record.id,
          },
        });
        vitalsAdded++;
      }
    } else if (needsAI) {
      // ── Regex fallback (AI unavailable, and at least one category still needs extraction) ──
      const labs = parseLabResultsFromText(text, effectiveDate);
      for (const lab of labs) {
        const canonicalName = canonicalizeLabTestName(lab.testName);
        const key = normalizeLabTestName(canonicalName);
        if (existingLabNames.has(key) || ignoredLabs.has(key)) continue;
        await prisma.labResult.create({
          data: {
            userId, testName: canonicalName, value: lab.value, unit: lab.unit,
            referenceMin: lab.referenceMin, referenceMax: lab.referenceMax, isFlagged: lab.isFlagged,
            recordedAt: effectiveDate, sourceRecordId: record.id, providerName: labImagingProvider ?? undefined,
          },
        });
        existingLabNames.add(key);
        labsAdded++;
      }
      const conditions = parseConditionsFromText(text);
      for (const cond of conditions) {
        const key = cond.name.toLowerCase();
        if (existingConditionNames.has(key) || ignoredConditions.has(key)) continue;
        await prisma.medicalHistoryEntry.create({
          data: { userId, category: 'CONDITION', name: cond.name, details: cond.details, startDate: effectiveDate, sourceRecordId: record.id, isManual: false },
        });
        existingConditionNames.add(key);
        conditionsAdded++;
      }
      const meds = parseMedicationsFromText(text);
      for (const med of meds) {
        const key = med.name.toLowerCase();
        if (existingMedNames.has(key) || ignoredMeds.has(key)) continue;
        await prisma.medicalHistoryEntry.create({
          data: { userId, category: 'MEDICATION', name: med.name, details: med.details || undefined, sourceRecordId: record.id, isManual: false },
        });
        existingMedNames.add(key);
        medicationsAdded++;
      }
      const imaging = parseImagingFromText(text, effectiveDate);
      if (imaging) {
        const ignoreKey = `${imaging.studyType}:${imaging.bodyPart.toLowerCase().trim()}`;
        const alreadyExists = existingImaging.some(
          i => i.studyType === imaging.studyType && i.bodyPart.toLowerCase() === imaging.bodyPart.toLowerCase()
        );
        if (!alreadyExists && !ignoredImaging.has(ignoreKey)) {
          await prisma.imagingStudy.create({
            data: {
              userId, studyType: imaging.studyType, bodyPart: imaging.bodyPart,
              summary: imaging.summary, facility: imaging.facility,
              studyDate: imaging.studyDate ?? effectiveDate, providerName: labImagingProvider ?? undefined,
              sourceRecordId: record.id,
            },
          });
          existingImaging.push({ studyType: imaging.studyType, bodyPart: imaging.bodyPart });
          imagingAdded++;
        }
      }
    }
  }

  // ── Normalize: stamp canonical provider name onto all linked data ───────────
  const providersForNormalize = await prisma.provider.findMany({ where: { userId } });
  for (const provider of providersForNormalize) {
    if (!provider.sourceRecordIds.length) continue;

    // Get current (possibly stale) providerNames on those records before overwriting
    const linkedRecords = await prisma.medicalRecord.findMany({
      where: { userId, id: { in: provider.sourceRecordIds } },
      select: { id: true, providerName: true },
    });
    const staleNames = Array.from(new Set(
      linkedRecords.map(r => r.providerName).filter(Boolean) as string[]
    ));

    await prisma.medicalRecord.updateMany({
      where: { userId, id: { in: provider.sourceRecordIds } },
      data: { providerName: provider.name },
    });

    await prisma.labResult.updateMany({
      where: { userId, sourceRecordId: { in: provider.sourceRecordIds } },
      data: { providerName: provider.name },
    });

    // ImagingStudy has no sourceRecordId — match by any stale providerName
    if (staleNames.length > 0) {
      await prisma.imagingStudy.updateMany({
        where: { userId, providerName: { in: staleNames } },
        data: { providerName: provider.name },
      });
    }
  }

  // ── Reconcile provider.sourceRecordIds from all records (including AI_SUMMARY) ─
  const allRecordsWithProvider = await prisma.medicalRecord.findMany({
    where: { userId, providerName: { not: null } },
    select: { id: true, providerName: true },
  });
  const allProvidersForReconcile = await prisma.provider.findMany({ where: { userId } });
  const reconcileByKey = new Map(allProvidersForReconcile.map(p => [normalizeProviderKey(p.name), p]));
  const recordsByProviderKey = new Map<string, string[]>();
  for (const r of allRecordsWithProvider) {
    const key = normalizeProviderKey(r.providerName!);
    const ids = recordsByProviderKey.get(key) ?? [];
    ids.push(r.id);
    recordsByProviderKey.set(key, ids);
  }
  for (const [key, recordIds] of recordsByProviderKey) {
    const provider = reconcileByKey.get(key);
    if (!provider) continue;
    const merged = Array.from(new Set([...provider.sourceRecordIds, ...recordIds]));
    if (merged.length !== provider.sourceRecordIds.length) {
      await prisma.provider.update({ where: { id: provider.id }, data: { sourceRecordIds: merged } });
    }
  }

  const total = labsAdded + conditionsAdded + medicationsAdded + imagingAdded + vitalsAdded + providersAdded;
  res.json({
    message: total > 0
      ? `Synced ${total} item${total !== 1 ? 's' : ''} from your records`
      : 'Everything is already up to date',
    labsAdded,
    conditionsAdded,
    medicationsAdded,
    imagingAdded,
    vitalsAdded,
    providersAdded,
  });
});

export default router;
