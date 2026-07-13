/**
 * healthkitSleep.ts — PURE aggregation of HealthKit sleep samples into
 * per-night hours for the daily check-in sleep card.
 *
 * HealthKit sleep analysis is messy in exactly three ways this module exists
 * to absorb:
 *  1. A night is fragmented into many samples (stages, wake gaps, resumes).
 *  2. Multiple sources double-report the same night (Apple Watch stages +
 *     Garmin "asleep" + iPhone "in bed"). Summing them inflates hours, so per
 *     night we pick ONE source — preferring stage-level data over inferred
 *     asleep over in-bed-only — and never sum across sources.
 *  3. Samples within one source can still overlap; intervals are merged
 *     before summing so overlap is never counted twice.
 *
 * Nights are bucketed to the LOCAL day the sleep belongs to on the check-in
 * card: a sample belongs to local day D when its midpoint falls in
 * [D-1 12:00, D 12:00) local time — i.e. "last night's sleep" shows on
 * today's check-in.
 *
 * No clock reads, no I/O — everything flows from the input samples.
 */

import { getLocalDateString } from '@/lib/utils';

/** The subset of a HealthKit sleep sample this module consumes. */
export interface SleepSampleInput {
  /** ISO 8601 timestamps. */
  startDate: string;
  endDate: string;
  /** Plugin-normalized sleep state for the sample. */
  sleepState?: 'inBed' | 'asleep' | 'awake' | 'rem' | 'deep' | 'light' | string;
  /** Writing app/device, used to keep sources separate for dedupe. */
  sourceName?: string;
  sourceId?: string;
}

export interface NightSleep {
  /** Local day (YYYY-MM-DD) the night belongs to (the wake-up day). */
  localDay: string;
  /** Aggregated asleep hours, rounded to 0.1h. */
  hours: number;
  /** Source the night was taken from after dedupe. */
  sourceName: string;
  /** True when the winning source reported stage-level data. */
  staged: boolean;
}

const STAGE_STATES = new Set(['rem', 'deep', 'light']);
const ASLEEP_STATES = new Set(['asleep', 'rem', 'deep', 'light']);

/** Sanity bounds — a "night" outside these is dropped as junk data. */
export const SLEEP_NIGHT_BOUNDS = { minHours: 0.5, maxHours: 16 } as const;

const MS_PER_HOUR = 3_600_000;
const HALF_DAY_MS = 12 * MS_PER_HOUR;

interface Interval {
  start: number;
  end: number;
}

/** Local day a sample's night belongs to: midpoint shifted forward 12h. */
function nightLocalDay(startMs: number, endMs: number): string {
  const midpoint = (startMs + endMs) / 2;
  return getLocalDateString(new Date(midpoint + HALF_DAY_MS));
}

/** Merge overlapping/touching intervals and return total duration in ms. */
function mergedDurationMs(intervals: Interval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = sorted[0].start;
  let curEnd = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start <= curEnd) {
      curEnd = Math.max(curEnd, end);
    } else {
      total += curEnd - curStart;
      curStart = start;
      curEnd = end;
    }
  }
  total += curEnd - curStart;
  return total;
}

interface SourceNight {
  sourceName: string;
  /** 2 = stage data, 1 = plain asleep, 0 = in-bed only. */
  quality: 0 | 1 | 2;
  asleepIntervals: Interval[];
  inBedIntervals: Interval[];
}

/**
 * Aggregate raw HealthKit sleep samples into one entry per local night.
 *
 * Per night: group samples by source, score each source by data quality
 * (stages > asleep > in-bed), keep the best source only, merge its intervals,
 * and sum. In-bed intervals are used only when a source reported nothing
 * better (e.g. iPhone-only users).
 */
export function aggregateSleepSamples(samples: SleepSampleInput[]): NightSleep[] {
  // localDay -> sourceKey -> accumulated intervals
  const nights = new Map<string, Map<string, SourceNight>>();

  for (const sample of samples) {
    const startMs = Date.parse(sample.startDate);
    const endMs = Date.parse(sample.endDate);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const state = sample.sleepState ?? 'asleep';
    if (state === 'awake') continue;

    const day = nightLocalDay(startMs, endMs);
    const sourceKey = sample.sourceId || sample.sourceName || 'unknown';

    let bySource = nights.get(day);
    if (!bySource) {
      bySource = new Map();
      nights.set(day, bySource);
    }
    let source = bySource.get(sourceKey);
    if (!source) {
      source = {
        sourceName: sample.sourceName || sourceKey,
        quality: 0,
        asleepIntervals: [],
        inBedIntervals: [],
      };
      bySource.set(sourceKey, source);
    }

    const interval = { start: startMs, end: endMs };
    if (ASLEEP_STATES.has(state)) {
      source.asleepIntervals.push(interval);
      const quality = STAGE_STATES.has(state) ? 2 : 1;
      if (quality > source.quality) source.quality = quality;
    } else {
      // 'inBed' and unknown states count only as in-bed fallback.
      source.inBedIntervals.push(interval);
    }
  }

  const result: NightSleep[] = [];
  for (const [localDay, bySource] of Array.from(nights.entries())) {
    // Best source wins the night: stages beat inferred-asleep beat in-bed;
    // ties break toward the longer asleep record.
    let winner: SourceNight | null = null;
    let winnerMs = 0;
    for (const source of Array.from(bySource.values())) {
      const ms = mergedDurationMs(
        source.asleepIntervals.length > 0 ? source.asleepIntervals : source.inBedIntervals
      );
      if (
        !winner ||
        source.quality > winner.quality ||
        (source.quality === winner.quality && ms > winnerMs)
      ) {
        winner = source;
        winnerMs = ms;
      }
    }
    if (!winner) continue;

    const hours = winnerMs / MS_PER_HOUR;
    if (hours < SLEEP_NIGHT_BOUNDS.minHours || hours > SLEEP_NIGHT_BOUNDS.maxHours) continue;

    result.push({
      localDay,
      hours: Math.round(hours * 10) / 10,
      sourceName: winner.sourceName,
      staged: winner.quality === 2,
    });
  }

  return result.sort((a, b) => a.localDay.localeCompare(b.localDay));
}

/** Existing sleep_log row state for the days a sync wants to write. */
export interface ExistingSleepRow {
  /** Local day (YYYY-MM-DD) of the row. */
  localDay: string;
  /** 'manual' | 'healthkit' (defensively: unknown/null blocks like manual). */
  source: string | null;
}

/**
 * Manual-entry-wins filter: HealthKit may only write days that are empty or
 * that it imported itself. Any row not explicitly tagged 'healthkit' was put
 * there by the user (the quick-log sheet and check-in stamp 'manual') and is
 * untouchable.
 */
export function selectWritableSleepDays<T extends { date: string; hours: number }>(
  days: T[],
  existing: ExistingSleepRow[]
): T[] {
  const manualDates = new Set(
    existing.filter((row) => row.source !== 'healthkit').map((row) => row.localDay)
  );
  return days.filter(
    (day) => !manualDates.has(day.date) && day.hours > 0 && day.hours < 24
  );
}
