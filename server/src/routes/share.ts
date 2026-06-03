import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { generateShareReport } from '../services/reportGenerator.js';
import { saveFile } from '../services/storage.js';
import fs from 'fs';
import path from 'path';

const router = Router();

const shareConfigSchema = z.object({
  includeRecords: z.array(z.string()).optional(),
  includeLabResults: z.array(z.string()).optional(),
  includeVitals: z.array(z.string()).optional(),
  includeHistoryEntries: z.array(z.string()).optional(),
  includeInsightReportId: z.string().optional(),
  expiresInHours: z.number().int().min(1).max(720).default(72),
});

router.post('/token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const result = shareConfigSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const config = result.data;
  const expiresAt = new Date(Date.now() + config.expiresInHours * 60 * 60 * 1000);

  const reportBuffer = await generateShareReport(req.userId!, config);
  const stored = await saveFile(reportBuffer, 'health-summary.pdf', 'application/pdf');

  const token = uuidv4();
  const shareToken = await prisma.shareToken.create({
    data: {
      userId: req.userId!,
      token,
      expiresAt,
      config,
      reportPath: stored.storagePath,
    },
  });

  const shareUrl = `${process.env.CLIENT_URL}/share/${token}`;
  res.status(201).json({ token: shareToken.token, shareUrl, expiresAt });
});

router.get('/token/:token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const tokens = await prisma.shareToken.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ tokens });
});

router.delete('/token/:token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const shareToken = await prisma.shareToken.findFirst({
    where: { token: req.params.token, userId: req.userId! },
  });
  if (!shareToken) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  await prisma.shareToken.delete({ where: { id: shareToken.id } });
  res.json({ message: 'Share link revoked' });
});

router.get('/view/:token', async (req: Request, res: Response): Promise<void> => {
  const shareToken = await prisma.shareToken.findUnique({
    where: { token: req.params.token },
    include: { user: { select: { name: true } } },
  });

  if (!shareToken) {
    res.status(404).json({ error: 'Share link not found or has been revoked' });
    return;
  }

  if (shareToken.expiresAt < new Date()) {
    res.status(410).json({ error: 'This share link has expired' });
    return;
  }

  await prisma.shareToken.update({
    where: { id: shareToken.id },
    data: { accessCount: { increment: 1 } },
  });

  res.json({
    patientName: shareToken.user.name,
    config: shareToken.config,
    expiresAt: shareToken.expiresAt,
    accessCount: shareToken.accessCount + 1,
  });
});

router.get('/view/:token/report', async (req: Request, res: Response): Promise<void> => {
  const shareToken = await prisma.shareToken.findUnique({
    where: { token: req.params.token },
  });

  if (!shareToken || shareToken.expiresAt < new Date()) {
    res.status(404).json({ error: 'Share link not found or expired' });
    return;
  }

  if (!shareToken.reportPath) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }

  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="health-summary.pdf"');
    const stream = fs.createReadStream(shareToken.reportPath);
    stream.pipe(res);
  } catch {
    res.status(404).json({ error: 'Report file not found' });
  }
});

router.get('/my-tokens', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const tokens = await prisma.shareToken.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      token: true,
      expiresAt: true,
      createdAt: true,
      accessCount: true,
      config: true,
    },
  });
  res.json({ tokens });
});

export default router;
