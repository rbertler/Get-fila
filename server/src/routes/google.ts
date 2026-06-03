import { Router, Response, Request } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { getAuthUrl, getOAuthClient, isGoogleConfigured } from '../services/googleAuth.js';

const router = Router();

router.get('/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });
  res.json({
    configured: isGoogleConfigured(),
    connected: !!user.googleAccessToken,
  });
});

router.get('/connect', requireAuth, (req: AuthRequest, res: Response): void => {
  if (!isGoogleConfigured()) {
    res.status(400).json({ error: 'Google OAuth is not configured on this server' });
    return;
  }

  const authUrl = getAuthUrl(req.userId!);
  res.json({ authUrl });
});

router.get('/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state: userId } = req.query as { code?: string; state?: string };

  if (!code || !userId) {
    res.status(400).send('Missing required parameters');
    return;
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    await prisma.user.update({
      where: { id: userId },
      data: {
        googleAccessToken: tokens.access_token ?? undefined,
        googleRefreshToken: tokens.refresh_token ?? undefined,
      },
    });

    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';
    res.redirect(`${clientUrl}/appointments?google=connected`);
  } catch {
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';
    res.redirect(`${clientUrl}/appointments?google=error`);
  }
});

router.post('/disconnect', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.user.update({
    where: { id: req.userId! },
    data: { googleAccessToken: null, googleRefreshToken: null },
  });
  res.json({ message: 'Google account disconnected' });
});

export default router;
