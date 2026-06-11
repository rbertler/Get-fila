import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/;

/**
 * Parse a server date for display. Date-only values (stored as midnight UTC)
 * are interpreted in local time so they don't shift back a day in timezones
 * west of UTC. Real timestamps pass through unchanged.
 */
export function parseDate(value: string | number | Date): Date {
  if (typeof value === 'string') {
    const m = DATE_ONLY.exec(value);
    if (m) {
      const [y, mo, d] = m[1].split('-').map(Number);
      return new Date(y, mo - 1, d);
    }
  }
  return new Date(value);
}
