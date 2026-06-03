import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [
    recordCount,
    flaggedLabCount,
    latestInsight,
    medications,
    conditions,
    upcomingAppointments,
    recentLabResults,
    recentRecords,
    allProviders,
  ] = await Promise.all([
    prisma.medicalRecord.count({ where: { userId } }),
    prisma.labResult.count({ where: { userId, isFlagged: true } }),
    prisma.healthInsightReport.findFirst({
      where: { userId },
      orderBy: { generatedAt: 'desc' },
    }),
    prisma.medicalHistoryEntry.findMany({
      where: {
        userId,
        category: 'MEDICATION',
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, details: true, startDate: true },
    }),
    prisma.medicalHistoryEntry.findMany({
      where: {
        userId,
        category: 'CONDITION',
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, details: true, startDate: true },
    }),
    prisma.appointment.findMany({
      where: { userId, scheduledAt: { gte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
      select: { id: true, providerName: true, specialty: true, scheduledAt: true, reason: true, location: true },
    }),
    prisma.labResult.findMany({
      where: { userId, recordedAt: { gte: oneYearAgo } },
      orderBy: { recordedAt: 'desc' },
      select: { id: true, testName: true, value: true, unit: true, referenceMin: true, referenceMax: true, isFlagged: true, recordedAt: true, providerName: true },
    }),
    prisma.medicalRecord.findMany({
      where: {
        userId,
        OR: [
          { recordDate: { gte: oneYearAgo } },
          { recordDate: null, createdAt: { gte: oneYearAgo } },
        ],
      },
      select: { id: true, fileName: true, recordType: true, createdAt: true, providerName: true, recordDate: true },
    }),
    prisma.provider.findMany({
      where: { userId, isArchived: false },
      select: { id: true, name: true, phone: true, fax: true, email: true, address: true },
    }),
  ]);

  // Priority: 2 = flagged, 1 = borderline (within 5% of reference boundary), 0 = normal
  function labPriority(l: { value: number; referenceMin: number | null; referenceMax: number | null; isFlagged: boolean }): number {
    if (l.isFlagged) return 2;
    if (l.referenceMin != null && l.referenceMax != null) {
      const buffer = (l.referenceMax - l.referenceMin) * 0.05;
      if (l.value <= l.referenceMin + buffer || l.value >= l.referenceMax - buffer) return 1;
    }
    return 0;
  }

  const sortedLabResults = [...recentLabResults]
    .sort((a, b) => {
      // Primary: most recent date first
      const dateDiff = new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime();
      if (dateDiff !== 0) return dateDiff;
      // Secondary: out of range > borderline > normal
      return labPriority(b) - labPriority(a);
    })
    .slice(0, 8);

  // Providers with upcoming appointments that are missing ALL contact info
  const providerByName = new Map(allProviders.map(p => [p.name.toLowerCase(), p]));
  const providersWithAppts = upcomingAppointments
    .map(a => providerByName.get(a.providerName.toLowerCase()))
    .filter((p): p is NonNullable<typeof p> => p != null);
  const providersMissingContact = providersWithAppts
    .filter(p => !p.phone && !p.email && !p.address)
    .map(p => ({ id: p.id, name: p.name }));

  // Active medications missing details (no dosage/frequency instructions)
  const medicationsMissingDetails = medications
    .filter(m => !m.details || m.details.trim() === '')
    .map(m => ({ id: m.id, name: m.name }));

  const sortedRecentRecords = [...recentRecords].sort((a, b) => {
    const aDate = a.recordDate ?? a.createdAt;
    const bDate = b.recordDate ?? b.createdAt;
    return new Date(bDate).getTime() - new Date(aDate).getTime();
  });

  res.json({
    recordCount,
    flaggedLabCount,
    medications,
    conditions,
    upcomingAppointments,
    recentLabResults: sortedLabResults,
    recentRecords: sortedRecentRecords,
    providersMissingContact,
    medicationsMissingDetails,
    latestInsight: latestInsight
      ? {
          id: latestInsight.id,
          summary: latestInsight.summary,
          insights: latestInsight.insights,
          gaps: latestInsight.gaps,
          generatedAt: latestInsight.generatedAt,
        }
      : null,
  });
});

export default router;
