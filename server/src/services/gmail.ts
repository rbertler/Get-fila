import { google } from 'googleapis';
import { getOAuthClient } from './googleAuth.js';
import { AppointmentSource } from '@prisma/client';

export interface GmailAppointment {
  providerName: string;
  scheduledAt: Date;
  reason?: string;
  location?: string;
  source: AppointmentSource;
}

export async function fetchAppointmentEmails(
  accessToken: string,
  refreshToken: string
): Promise<GmailAppointment[]> {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const response = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:(appointment OR confirmation OR reminder) doctor OR clinic OR hospital',
    maxResults: 20,
  });

  const messages = response.data.messages ?? [];
  const appointments: GmailAppointment[] = [];

  for (const msg of messages.slice(0, 10)) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
      const headers = full.data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
      const from = headers.find((h) => h.name === 'From')?.value ?? '';
      const dateHeader = headers.find((h) => h.name === 'Date')?.value;

      if (!dateHeader) continue;

      const date = new Date(dateHeader);
      if (isNaN(date.getTime())) continue;

      appointments.push({
        providerName: extractProviderName(from, subject),
        scheduledAt: date,
        reason: subject,
        source: 'GMAIL' as AppointmentSource,
      });
    } catch {
      // skip malformed messages
    }
  }

  return appointments;
}

function extractProviderName(from: string, subject: string): string {
  const emailMatch = from.match(/^([^<]+)</);
  if (emailMatch) return emailMatch[1].trim();
  const words = subject.split(' ').slice(0, 4).join(' ');
  return words || 'Unknown Provider';
}
