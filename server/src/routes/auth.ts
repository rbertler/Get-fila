import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../utils/prisma.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  dateOfBirth: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setAuthCookie(res: Response, userId: string): void {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`,
  });

  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const result = signupSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const { email, password, name, dateOfBirth } = result.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
    },
    select: { id: true, email: true, name: true, dateOfBirth: true },
  });

  setAuthCookie(res, user.id);
  res.status(201).json({ user });
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid email or password format' });
    return;
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  setAuthCookie(res, user.id);
  res.json({
    user: { id: user.id, email: user.email, name: user.name, dateOfBirth: user.dateOfBirth },
  });
});

router.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
});

router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    select: { id: true, email: true, name: true, dateOfBirth: true, googleAccessToken: true },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    user: {
      ...user,
      googleConnected: !!user.googleAccessToken,
      googleAccessToken: undefined,
    },
  });
});

export default router;
