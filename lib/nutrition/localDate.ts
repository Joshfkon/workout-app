/**
 * Resolving "today" for nutrition server actions.
 *
 * Server actions run on the host (UTC in production), so the host's calendar
 * day is not the user's: a Sydney user weighing in at 07:00 on the 12th is
 * still on the 11th in UTC, and a date filter built from the server's day
 * drops that weigh-in. Clients pass their own local day (YYYY-MM-DD); this
 * validates it and falls back to the server's day (the previous behaviour)
 * when it is missing or implausible.
 */

import { today as clockToday } from '@/lib/clock';
import { addLocalDays, localDaysBetweenDays } from '@/lib/date/localDay';

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A client-supplied local date is trusted only when it is a well-formed
 * calendar day within one day of the server's own (time zones span UTC-12 to
 * UTC+14, so a genuine client can never be further off than that).
 */
export function resolveLocalDate(
  localDate: string | null | undefined,
  serverToday: string = clockToday()
): string {
  if (!localDate || !LOCAL_DATE_RE.test(localDate)) return serverToday;
  // Reject impossible days such as 2026-02-31 (they round-trip to another date).
  if (addLocalDays(localDate, 0) !== localDate) return serverToday;
  if (Math.abs(localDaysBetweenDays(serverToday, localDate)) > 1) return serverToday;
  return localDate;
}
