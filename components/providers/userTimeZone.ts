/**
 * The user's timezone, as seen by the SERVER.
 *
 * `lib/clock.today()` is a calendar day in the RUNTIME's zone. In the browser
 * that is the user's zone; in a server action / server component it is the
 * host's (UTC on most hosts), so "today" rendered server-side was tomorrow for
 * a US user every evening. The dashboard shell writes the device's IANA zone
 * into a cookie (`UserTimeZoneCookie`), and server code resolves the user's
 * calendar day from it with `resolveUserDay`.
 *
 * Deliberately free of React / Next imports so both server and client code can
 * import it. Only a zone NAME is stored — no personal data.
 */

import { now as clockNow, localDateIn, type LocalDate } from '@/lib/clock';

export const USER_TIME_ZONE_COOKIE = 'ht_tz';

/** True for a zone name `Intl` accepts (rejects junk / tampered cookie values). */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface UserDay {
  /** The user's calendar day, `YYYY-MM-DD`. */
  day: LocalDate;
  /**
   * A Date whose RUNTIME-LOCAL calendar fields equal `day` (local midnight).
   * For helpers that take a Date and read its local day — the training
   * schedule resolver, `rollingWindowStart` — so they see the user's day
   * rather than the host's.
   */
  date: Date;
  /** The validated zone, or null when the cookie was absent/invalid. */
  timeZone: string | null;
}

/**
 * Resolve the user's calendar day from the timezone cookie value. With no
 * (or an invalid) zone this is exactly the pre-existing behaviour: the
 * runtime's local day.
 */
export function resolveUserDay(
  timeZoneCookie: string | null | undefined,
  now: Date = clockNow()
): UserDay {
  const decoded = timeZoneCookie ? safeDecode(timeZoneCookie) : null;
  const timeZone = isValidTimeZone(decoded) ? decoded : null;
  const day = localDateIn(now, timeZone ?? undefined);
  const [y, m, d] = day.split('-').map(Number);
  return { day, date: new Date(y, m - 1, d), timeZone };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Client only: the device's IANA zone, or null if the platform hides it. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Client only: persist the device zone for the server. Returns true when the
 * cookie value CHANGED (first visit, or the user travelled) — the caller can
 * then refresh server-rendered data that was computed for the wrong day.
 */
export function writeUserTimeZoneCookie(): boolean {
  if (typeof document === 'undefined') return false;
  const zone = deviceTimeZone();
  if (!zone) return false;
  const encoded = encodeURIComponent(zone);
  const current = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${USER_TIME_ZONE_COOKIE}=`))
    ?.slice(USER_TIME_ZONE_COOKIE.length + 1);
  if (current === encoded) return false;
  document.cookie = `${USER_TIME_ZONE_COOKIE}=${encoded}; path=/; max-age=31536000; SameSite=Lax`;
  return true;
}
