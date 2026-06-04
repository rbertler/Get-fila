import { Router, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { generateInsights, FocusedScope } from '../services/insightGenerator.js';
import { generateInsightPdf } from '../services/insightPdfGenerator.js';
import { saveFile } from '../services/storage.js';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId!;
  const reports = await prisma.healthInsightReport.findMany({
    where: { userId },
    orderBy: { generatedAt: 'desc' },
    take: 10,
  });

  // Determine whether a new report can be generated (new data since last report)
  const lastGeneral = reports.find((r) => r.reportType === 'general');
  let canGenerate = true;
  if (lastGeneral) {
    const since = lastGeneral.generatedAt;
    const [newEntries, newLabs, newVitals, newImaging, newRecords] = await Promise.all([
      prisma.medicalHistoryEntry.count({ where: { userId, createdAt: { gt: since } } }),
      prisma.labResult.count({ where: { userId, createdAt: { gt: since } } }),
      prisma.vital.count({ where: { userId, createdAt: { gt: since } } }),
      prisma.imagingStudy.count({ where: { userId, createdAt: { gt: since } } }),
      prisma.medicalRecord.count({ where: { userId, createdAt: { gt: since }, recordType: { not: 'AI_SUMMARY' } } }),
    ]);
    canGenerate = (newEntries + newLabs + newVitals + newImaging + newRecords) > 0;
  }

  res.json({ reports, canGenerate });
});

router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.healthInsightReport.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json({ report });
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const report = await prisma.healthInsightReport.findFirst({
      where: { id: req.params.id, userId: req.userId! },
    });
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    await prisma.healthInsightReport.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete report';
    res.status(500).json({ error: message });
  }
});

router.post('/generate', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reportId = await generateInsights(req.userId!);
    const report = await prisma.healthInsightReport.findUnique({ where: { id: reportId } });
    res.status(201).json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate insights';
    const status = message.includes('Insufficient health data') || message.includes('No new health data') ? 400
      : message.includes('ANTHROPIC_API_KEY') ? 503
      : 500;
    res.status(status).json({ error: message });
  }
});

router.post('/generate/focused', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { entryIds = [], labTestNames = [], imagingIds = [] } = req.body as Partial<FocusedScope>;
    const scope: FocusedScope = { entryIds, labTestNames, imagingIds };
    const reportId = await generateInsights(req.userId!, scope);
    const report = await prisma.healthInsightReport.findUnique({ where: { id: reportId } });
    res.status(201).json({ report });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate focused insights';
    const status = message.includes('No items selected') || message.includes('Insufficient') ? 400
      : message.includes('ANTHROPIC_API_KEY') ? 503
      : 500;
    res.status(status).json({ error: message });
  }
});

// ── Download PDF ──────────────────────────────────────────────────────────────
router.get('/:id/pdf', async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.healthInsightReport.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  try {
    const pdfBuffer = await generateInsightPdf(report.id);
    const dateStr = format(new Date(report.generatedAt), 'yyyy-MM-dd');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="health-intelligence-${dateStr}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.send(pdfBuffer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate PDF';
    res.status(500).json({ error: msg });
  }
});

// ── Save to Records ───────────────────────────────────────────────────────────
router.post('/:id/save-to-records', async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.healthInsightReport.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  try {
    const pdfBuffer = await generateInsightPdf(report.id);
    const dateStr = format(new Date(report.generatedAt), 'yyyy-MM-dd');
    const fileName = `Health Intelligence - ${format(new Date(report.generatedAt), 'MMMM d, yyyy')}.pdf`;
    const stored = await saveFile(pdfBuffer, fileName, 'application/pdf');

    const record = await prisma.medicalRecord.create({
      data: {
        userId: req.userId!,
        fileName,
        fileSize: stored.fileSize,
        mimeType: 'application/pdf',
        storagePath: stored.storagePath,
        recordType: 'AI_SUMMARY',
        recordDate: report.generatedAt,
        notes: `ai_insight_report_id:${report.id}`,
      },
    });

    res.status(201).json({ record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save record';
    res.status(500).json({ error: msg });
  }
});

// ── Create Share Link ─────────────────────────────────────────────────────────
router.post('/:id/share', async (req: AuthRequest, res: Response): Promise<void> => {
  const report = await prisma.healthInsightReport.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  try {
    const pdfBuffer = await generateInsightPdf(report.id);
    const stored = await saveFile(pdfBuffer, 'health-intelligence.pdf', 'application/pdf');

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const token = uuidv4();
    const shareToken = await prisma.shareToken.create({
      data: {
        userId: req.userId!,
        token,
        expiresAt,
        config: { includeInsightReportId: report.id },
        reportPath: stored.storagePath,
      },
    });

    const shareUrl = `${process.env.CLIENT_URL ?? 'http://localhost:5173'}/share/${shareToken.token}`;
    res.status(201).json({ token: shareToken.token, shareUrl, expiresAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create share link';
    res.status(500).json({ error: msg });
  }
});

export default router;
