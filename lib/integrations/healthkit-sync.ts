/**
 * HealthKit anchored foreground sync.
 *
 * Runs on every app foreground (and after connecting). Each data type keeps a
 * persisted anchor — the newest sample end-time already ingested — so a pull
 * only fetches what's new, minus a lookback window that absorbs late-arriving
 * samples (a Watch can write last night's sleep hours after the fact, and
 * today's daily buckets are always partial).
 *
 * The plugin exposes no per-sample HKAnchoredObjectQuery cursor, so the
 * anchor semantics live here: query [anchor - lookback, now], aggregate to
 * local days, upsert idempotently (day-keyed), then advance the anchor to the
 * newest sample seen. Re-pulling the lookback region is harmless by design.
 *
 * All entry points are capability-gated; on web/Android this module resolves
 * to a no-op (and is only ever loaded via dynamic import from gated call
 * sites anyway).
 */

import {
  isHealthKitAvailable,
  fetchHealthKitSleepSamples,
  fetchHealthKitDailyHrv,
  fetchHealthKitDailyRestingHeartRate,
  fetchHealthKitSteps,
  fetchHealthKitActiveEnergy,
} from './healthkit';
import {
  getHealthKitSyncContext,
  saveHealthKitSleepDays,
  saveHealthKitWellness,
  saveHealthKitDailyActivity,
  updateHealthKitAnchors,
  type HealthKitDataType,
  type HealthKitSyncContext,
} from '@/lib/actions/healthkit';
import { aggregateSleepSamples } from '@/services/healthkitSleep';

export const HEALTHKIT_SYNC = {
  /** Re-pull this far behind the anchor to absorb late-written samples. */
  lookbackHours: 36,
  /** First-ever sync window — long enough to seed 14-day HRV/RHR baselines. */
  firstSyncDays: 21,
  /** Foreground syncs closer together than this are skipped (not forced). */
  minIntervalMs: 15 * 60 * 1000,
} as const;

/**
 * The window to query for one data type given its persisted anchor.
 * Pure — exported for tests.
 */
export function planSyncWindow(
  anchor: string | null | undefined,
  now: Date,
  config = HEALTHKIT_SYNC
): { start: Date; end: Date } {
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  const start = Number.isFinite(anchorMs)
    ? new Date(
        Math.min(anchorMs - config.lookbackHours * 3_600_000, now.getTime())
      )
    : new Date(now.getTime() - config.firstSyncDays * 86_400_000);
  return { start, end: now };
}

export interface HealthKitSyncOutcome {
  status: 'synced' | 'skipped';
  reason?: 'not_available' | 'not_connected' | 'throttled' | 'error';
  sleepDays?: number;
  wellnessDays?: number;
  activityDays?: number;
}

/** Injectable seams so tests can drive the sync against fixtures. */
export interface HealthKitSyncDeps {
  isAvailable: typeof isHealthKitAvailable;
  getContext: () => Promise<HealthKitSyncContext>;
  fetchSleep: typeof fetchHealthKitSleepSamples;
  fetchHrv: typeof fetchHealthKitDailyHrv;
  fetchRhr: typeof fetchHealthKitDailyRestingHeartRate;
  fetchSteps: typeof fetchHealthKitSteps;
  fetchEnergy: typeof fetchHealthKitActiveEnergy;
  saveSleep: typeof saveHealthKitSleepDays;
  saveWellness: typeof saveHealthKitWellness;
  saveActivity: typeof saveHealthKitDailyActivity;
  saveAnchors: typeof updateHealthKitAnchors;
  now: () => Date;
}

const defaultDeps: HealthKitSyncDeps = {
  isAvailable: isHealthKitAvailable,
  getContext: getHealthKitSyncContext,
  fetchSleep: fetchHealthKitSleepSamples,
  fetchHrv: fetchHealthKitDailyHrv,
  fetchRhr: fetchHealthKitDailyRestingHeartRate,
  fetchSteps: fetchHealthKitSteps,
  fetchEnergy: fetchHealthKitActiveEnergy,
  saveSleep: saveHealthKitSleepDays,
  saveWellness: saveHealthKitWellness,
  saveActivity: saveHealthKitDailyActivity,
  saveAnchors: updateHealthKitAnchors,
  now: () => new Date(),
};

let lastSyncStartedAt = 0;

/**
 * Pull new HealthKit data since the persisted anchors and store it.
 * Safe to call opportunistically — throttled, capability-gated, and every
 * failure degrades to a skip (per-type absence is normal, never an error).
 */
export async function runHealthKitSync(
  options: { force?: boolean } = {},
  deps: HealthKitSyncDeps = defaultDeps
): Promise<HealthKitSyncOutcome> {
  try {
    if (!(await deps.isAvailable())) {
      return { status: 'skipped', reason: 'not_available' };
    }

    const now = deps.now();
    if (!options.force && now.getTime() - lastSyncStartedAt < HEALTHKIT_SYNC.minIntervalMs) {
      return { status: 'skipped', reason: 'throttled' };
    }

    const context = await deps.getContext();
    if (!context.connected) {
      return { status: 'skipped', reason: 'not_connected' };
    }

    lastSyncStartedAt = now.getTime();

    const windows: Record<HealthKitDataType, { start: Date; end: Date }> = {
      sleep: planSyncWindow(context.anchors.sleep, now),
      hrv: planSyncWindow(context.anchors.hrv, now),
      resting_heart_rate: planSyncWindow(context.anchors.resting_heart_rate, now),
      steps: planSyncWindow(context.anchors.steps, now),
      active_energy: planSyncWindow(context.anchors.active_energy, now),
    };

    const [sleepSamples, hrvDays, rhrDays, stepDays, energyDays] = await Promise.all([
      deps.fetchSleep(windows.sleep.start, windows.sleep.end),
      deps.fetchHrv(windows.hrv.start, windows.hrv.end),
      deps.fetchRhr(windows.resting_heart_rate.start, windows.resting_heart_rate.end),
      deps.fetchSteps(windows.steps.start, windows.steps.end),
      deps.fetchEnergy(windows.active_energy.start, windows.active_energy.end),
    ]);

    // --- Sleep: aggregate fragmented, multi-source samples to nights. ---
    const nights = aggregateSleepSamples(sleepSamples);
    const sleepResult =
      nights.length > 0
        ? await deps.saveSleep(nights.map((n) => ({ date: n.localDay, hours: n.hours })))
        : { saved: 0, success: true };

    // --- HRV + RHR: merge per local day into wellness rows. ---
    const wellnessByDay = new Map<string, { hrv: number | null; rhr: number | null }>();
    for (const day of hrvDays) {
      wellnessByDay.set(day.date, { hrv: day.value, rhr: null });
    }
    for (const day of rhrDays) {
      const existing = wellnessByDay.get(day.date);
      if (existing) existing.rhr = day.value;
      else wellnessByDay.set(day.date, { hrv: null, rhr: day.value });
    }
    const wellnessResult =
      wellnessByDay.size > 0
        ? await deps.saveWellness(
            Array.from(wellnessByDay, ([date, v]) => ({
              date,
              hrvSdnnMs: v.hrv,
              restingHrBpm: v.rhr,
            }))
          )
        : { saved: 0, success: true };

    // --- Steps + active energy: merge per local day. ---
    const activityByDay = new Map<string, { steps: number | null; energy: number | null }>();
    for (const day of stepDays) {
      activityByDay.set(day.date, { steps: day.steps, energy: null });
    }
    for (const day of energyDays) {
      const existing = activityByDay.get(day.date);
      if (existing) existing.energy = day.activeCalories;
      else activityByDay.set(day.date, { steps: null, energy: day.activeCalories });
    }
    const activityResult =
      activityByDay.size > 0
        ? await deps.saveActivity(
            Array.from(activityByDay, ([date, v]) => ({
              date,
              steps: v.steps,
              activeCalories: v.energy,
            }))
          )
        : { saved: 0, success: true };

    // --- Advance anchors to the newest ingested moment per type — but ONLY
    // for types whose write succeeded. A failed write must leave its anchor
    // behind so the next sync re-pulls the same window (upserts are
    // idempotent, so re-pulling is free; skipping data is not). Daily buckets
    // anchor at now (their partial today-bucket is inside the lookback
    // re-pull next time); sleep anchors at its newest sample end. ---
    const nowIso = now.toISOString();
    let sleepAnchor = context.anchors.sleep ?? null;
    for (const sample of sleepSamples) {
      if (!sleepAnchor || sample.endDate > sleepAnchor) sleepAnchor = sample.endDate;
    }

    const anchorUpdates: { dataType: HealthKitDataType; lastSampleEndAt: string }[] = [];
    if (sleepResult.success && sleepAnchor) {
      anchorUpdates.push({ dataType: 'sleep', lastSampleEndAt: sleepAnchor });
    }
    if (wellnessResult.success) {
      anchorUpdates.push({ dataType: 'hrv', lastSampleEndAt: nowIso });
      anchorUpdates.push({ dataType: 'resting_heart_rate', lastSampleEndAt: nowIso });
    }
    if (activityResult.success) {
      anchorUpdates.push({ dataType: 'steps', lastSampleEndAt: nowIso });
      anchorUpdates.push({ dataType: 'active_energy', lastSampleEndAt: nowIso });
    }
    await deps.saveAnchors(anchorUpdates);

    return {
      status: 'synced',
      sleepDays: sleepResult.saved,
      wellnessDays: wellnessResult.saved,
      activityDays: activityResult.saved,
    };
  } catch (error) {
    console.warn('HealthKit sync failed:', error);
    return { status: 'skipped', reason: 'error' };
  }
}
