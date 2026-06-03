import { Router, Response } from 'express';
import { z } from 'zod';
import { AppointmentSource } from '@prisma/client';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { fetchCalendarEvents } from '../services/googleCalendar.js';
import { fetchAppointmentEmails } from '../services/gmail.js';

const router = Router();
router.use(requireAuth);

const appointmentSchema = z.object({
  providerName: z.string().min(1),
  specialty: z.string().optional(),
  scheduledAt: z.string(),
  duration: z.number().int().positive().optional(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  location: z.string().optional(),
});

const updateSchema = appointmentSchema.partial();

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const appointments = await prisma.appointment.findMany({
    where: { userId: req.userId! },
    orderBy: { scheduledAt: 'desc' },
  });
  res.json({ appointments });
});

router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = appointmentSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const appointment = await prisma.appointment.create({
    data: {
      userId: req.userId!,
      ...result.data,
      scheduledAt: new Date(result.data.scheduledAt),
      source: 'MANUAL' as AppointmentSource,
    },
  });

  res.status(201).json({ appointment });
});

router.patch('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const result = updateSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: result.error.errors[0]?.message ?? 'Invalid input' });
    return;
  }

  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Appointment not found' });
    return;
  }

  const updated = await prisma.appointment.update({
    where: { id: req.params.id },
    data: {
      ...result.data,
      scheduledAt: result.data.scheduledAt ? new Date(result.data.scheduledAt) : undefined,
    },
  });

  res.json({ appointment: updated });
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await prisma.appointment.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!existing) {
    res.status(404).json({ error: 'Appointment not found' });
    return;
  }

  await prisma.appointment.delete({ where: { id: req.params.id } });
  res.json({ message: 'Appointment deleted' });
});

router.post('/sync/google-calendar', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });

  if (!user.googleAccessToken || !user.googleRefreshToken) {
    res.status(400).json({ error: 'Google Calendar not connected' });
    return;
  }

  const events = await fetchCalendarEvents(user.googleAccessToken, user.googleRefreshToken);
  let created = 0;

  for (const event of events) {
    const exists = await prisma.appointment.findFirst({
      where: { userId: req.userId!, googleEventId: event.googleEventId },
    });
    if (!exists) {
      await prisma.appointment.create({
        data: {
          userId: req.userId!,
          ...event,
        },
      });
      created++;
    }
  }

  res.json({ message: `Synced ${created} new appointments`, total: events.length, created });
});

router.post('/sync/gmail', async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId! } });

  if (!user.googleAccessToken || !user.googleRefreshToken) {
    res.status(400).json({ error: 'Gmail not connected' });
    return;
  }

  const appointments = await fetchAppointmentEmails(user.googleAccessToken, user.googleRefreshToken);
  let created = 0;

  for (const appt of appointments) {
    await prisma.appointment.create({
      data: {
        userId: req.userId!,
        ...appt,
      },
    });
    created++;
  }

  res.json({ message: `Imported ${created} appointments from Gmail`, created });
});

export default router;
