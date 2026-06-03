import { google } from 'googleapis';
import { getOAuthClient } from './googleAuth.js';
import { AppointmentSource } from '@prisma/client';

export interface CalendarEvent {
  googleEventId: string;
  providerName: string;
  specialty?: string;
  scheduledAt: Date;
  duration?: number;
  reason?: string;
  notes?: string;
  location?: string;
  source: AppointmentSource;
}

export async function fetchCalendarEvents(
  accessToken: string,
  refreshToken: string
): Promise<CalendarEvent[]> {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const sixMonthsAhead = new Date();
  sixMonthsAhead.setMonth(sixMonthsAhead.getMonth() + 6);

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: sixMonthsAgo.toISOString(),
    timeMax: sixMonthsAhead.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 100,
    q: 'doctor OR appointment OR clinic OR hospital OR medical OR health',
  });

  const events = response.data.items ?? [];

  return events
    .filter((e) => e.start?.dateTime)
    .map((e) => {
      const start = new Date(e.start!.dateTime!);
      const end = e.end?.dateTime ? new Date(e.end.dateTime) : undefined;
      const duration = end ? Math.round((end.getTime() - start.getTime()) / 60000) : undefined;

      return {
        googleEventId: e.id!,
        providerName: e.summary ?? 'Unknown Provider',
        scheduledAt: start,
        duration,
        reason: e.description ?? undefined,
        location: e.location ?? undefined,
        source: 'GOOGLE_CALENDAR' as AppointmentSource,
      };
    });
}
