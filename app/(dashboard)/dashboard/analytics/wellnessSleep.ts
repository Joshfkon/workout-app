import { SLEEP_QUALITIES, SLEEP_QUALITY_TO_RATING, type SleepQuality } from '@/types/schema';

/** One day on the Wellness charts (oldest → newest). */
export interface WellnessDay {
  date: string;
  sleepHours: number | null;
  sleepQuality: number | null;
  energyLevel: number | null;
  moodRating: number | null;
  focusRating: number | null;
  libidoRating: number | null;
  stressLevel: number | null;
  sorenessLevel: number | null;
  hungerLevel: number | null;
}

/** A sleep_log row as selected (local_day, hours, quality). */
export interface SleepLogRow {
  local_day: string;
  hours: number | string | null;
  quality: string | null;
}

const EMPTY_DAY: Omit<WellnessDay, 'date'> = {
  sleepHours: null,
  sleepQuality: null,
  energyLevel: null,
  moodRating: null,
  focusRating: null,
  libidoRating: null,
  stressLevel: null,
  sorenessLevel: null,
  hungerLevel: null,
};

/**
 * Put sleep_log nights onto the Wellness days. sleep_log is where sleep
 * lives — Home's quick log, the Sleep card and Apple Health write only
 * there; the daily check-in dual-writes into it. The Wellness charts read
 * only daily_check_ins, so any night not entered through a check-in never
 * reached the sleep graph. A sleep_log night wins over the check-in's copy
 * (it's the edited, canonical one); a night with no check-in gets its own
 * day. Quality maps through the shared 1-5 bridge. Pure; oldest → newest.
 */
export function mergeSleepLogIntoWellness(days: WellnessDay[], sleep: SleepLogRow[]): WellnessDay[] {
  const byDate = new Map(days.map((d) => [d.date, { ...d }]));
  for (const row of sleep) {
    const hours = Number(row.hours);
    if (!row.local_day || !Number.isFinite(hours) || hours <= 0) continue;
    const day = byDate.get(row.local_day) ?? { date: row.local_day, ...EMPTY_DAY };
    day.sleepHours = hours;
    if (row.quality && (SLEEP_QUALITIES as readonly string[]).includes(row.quality)) {
      day.sleepQuality = SLEEP_QUALITY_TO_RATING[row.quality as SleepQuality];
    }
    byDate.set(row.local_day, day);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
