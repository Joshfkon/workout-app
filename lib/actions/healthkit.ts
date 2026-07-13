'use server';

/**
 * Server Actions for the Apple HealthKit sync pipeline.
 *
 * The native client (lib/integrations/healthkit-sync.ts) reads HealthKit on
 * app foreground and pushes per-local-day aggregates through these actions.
 * Everything is additive and source-tagged:
 *   - sleep      -> daily_check_ins.sleep_hours (source 'healthkit'; manual
 *                   entries are never overwritten)
 *   - HRV / RHR  -> daily_wellness_metrics
 *   - steps/energy -> daily_activity_data (steps_source 'apple_healthkit')
 *   - anchors    -> healthkit_sync_anchors (incremental sync cursors)
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { getActivityLevelFromSteps } from '@/types/wearable';
import { selectWritableSleepDays } from '@/services/healthkitSleep';
import type { WellnessDay } from '@/services/wearableRecovery';

export type HealthKitDataType =
  | 'sleep'
  | 'hrv'
  | 'resting_heart_rate'
  | 'steps'
  | 'active_energy';

export interface HealthKitSyncContext {
  connected: boolean;
  /** ISO timestamp of the newest ingested sample per data type. */
  anchors: Partial<Record<HealthKitDataType, string>>;
}

export interface HealthKitSleepDay {
  /** Local day (YYYY-MM-DD) the night belongs to. */
  date: string;
  hours: number;
}

export interface HealthKitWellnessDay {
  date: string;
  hrvSdnnMs: number | null;
  restingHrBpm: number | null;
}

export interface HealthKitActivityDay {
  date: string;
  steps: number | null;
  activeCalories: number | null;
}

/** Connection + anchors in one round trip, for the sync orchestrator. */
export async function getHealthKitSyncContext(): Promise<HealthKitSyncContext> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { connected: false, anchors: {} };

  const [{ data: connection }, { data: anchorRows }] = await Promise.all([
    supabase
      .from('wearable_connections')
      .select('is_connected')
      .eq('user_id', user.id)
      .eq('source', 'apple_healthkit')
      .maybeSingle(),
    supabase
      .from('healthkit_sync_anchors')
      .select('data_type, last_sample_end_at')
      .eq('user_id', user.id),
  ]);

  const anchors: Partial<Record<HealthKitDataType, string>> = {};
  for (const row of (anchorRows ?? []) as {
    data_type: HealthKitDataType;
    last_sample_end_at: string;
  }[]) {
    anchors[row.data_type] = row.last_sample_end_at;
  }

  return {
    connected: Boolean((connection as { is_connected: boolean } | null)?.is_connected),
    anchors,
  };
}

/**
 * Write HealthKit sleep nights into daily check-ins.
 *
 * Manual entries ALWAYS win: a row whose sleep_hours was set by the user
 * (sleep_source 'manual', or a legacy row with hours and no source) is left
 * untouched. Only empty days and previous auto-fills are written, tagged
 * sleep_source='healthkit'.
 */
export async function saveHealthKitSleepDays(
  days: HealthKitSleepDay[]
): Promise<{ saved: number }> {
  if (days.length === 0) return { saved: 0 };
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { saved: 0 };

  const dates = days.map((d) => d.date);
  const { data: existingRows } = await supabase
    .from('daily_check_ins')
    .select('date, sleep_hours, sleep_source')
    .eq('user_id', user.id)
    .in('date', dates);

  const writable = selectWritableSleepDays(
    days,
    ((existingRows ?? []) as {
      date: string;
      sleep_hours: number | null;
      sleep_source: string | null;
    }[]).map((row) => ({
      date: row.date,
      sleepHours: row.sleep_hours,
      sleepSource: row.sleep_source,
    }))
  );
  if (writable.length === 0) return { saved: 0 };

  const { error } = await supabase.from('daily_check_ins').upsert(
    writable.map((day) => ({
      user_id: user.id,
      date: day.date,
      sleep_hours: Math.round(day.hours * 10) / 10,
      sleep_source: 'healthkit',
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,date' }
  );

  if (error) {
    console.error('Failed to save HealthKit sleep:', error);
    return { saved: 0 };
  }
  return { saved: writable.length };
}

/** Upsert per-day HRV / resting HR rows (source 'healthkit'). */
export async function saveHealthKitWellness(
  days: HealthKitWellnessDay[]
): Promise<{ saved: number }> {
  const rows = days.filter((d) => d.hrvSdnnMs != null || d.restingHrBpm != null);
  if (rows.length === 0) return { saved: 0 };
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { saved: 0 };

  const { error } = await supabase.from('daily_wellness_metrics').upsert(
    rows.map((day) => ({
      user_id: user.id,
      date: day.date,
      hrv_sdnn_ms: day.hrvSdnnMs,
      resting_hr_bpm: day.restingHrBpm,
      source: 'healthkit',
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,date,source' }
  );

  if (error) {
    console.error('Failed to save HealthKit wellness metrics:', error);
    return { saved: 0 };
  }
  return { saved: rows.length };
}

/**
 * Upsert per-day steps / active energy from HealthKit into
 * daily_activity_data. HealthKit is the top-priority step source (matching
 * lib/integrations/activity-sync.ts), so it overwrites manual counts.
 */
export async function saveHealthKitDailyActivity(
  days: HealthKitActivityDay[]
): Promise<{ saved: number }> {
  const rows = days.filter((d) => (d.steps ?? 0) > 0 || (d.activeCalories ?? 0) > 0);
  if (rows.length === 0) return { saved: 0 };
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { saved: 0 };

  const { error } = await supabase.from('daily_activity_data').upsert(
    rows.map((day) => ({
      user_id: user.id,
      date: day.date,
      steps_total: Math.max(0, Math.round(day.steps ?? 0)),
      steps_source: 'apple_healthkit',
      steps_confidence: 'measured',
      wearable_active_calories:
        day.activeCalories != null ? Math.round(day.activeCalories) : null,
      wearable_active_calories_source:
        day.activeCalories != null ? 'apple_healthkit' : null,
      activity_level: getActivityLevelFromSteps(Math.round(day.steps ?? 0)),
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'user_id,date' }
  );

  if (error) {
    console.error('Failed to save HealthKit activity:', error);
    return { saved: 0 };
  }
  return { saved: rows.length };
}

/** Persist sync anchors and stamp the connection's last_sync_at. */
export async function updateHealthKitAnchors(
  anchors: { dataType: HealthKitDataType; lastSampleEndAt: string }[]
): Promise<{ success: boolean }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false };

  if (anchors.length > 0) {
    const { error } = await supabase.from('healthkit_sync_anchors').upsert(
      anchors.map((anchor) => ({
        user_id: user.id,
        data_type: anchor.dataType,
        last_sample_end_at: anchor.lastSampleEndAt,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,data_type' }
    );
    if (error) {
      console.error('Failed to update HealthKit anchors:', error);
      return { success: false };
    }
  }

  await supabase
    .from('wearable_connections')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('source', 'apple_healthkit');

  return { success: true };
}

/**
 * Recent wellness history (HRV/RHR per local day) for the recovery modifier.
 * Empty array whenever the table has nothing — absence is normal.
 */
export async function getWellnessHistory(days = 21): Promise<WellnessDay[]> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const since = new Date(Date.now() - days * 86_400_000);
  const sinceDay = since.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('daily_wellness_metrics')
    .select('date, hrv_sdnn_ms, resting_hr_bpm')
    .eq('user_id', user.id)
    .gte('date', sinceDay)
    .order('date', { ascending: true });

  if (error || !data) return [];

  return (data as { date: string; hrv_sdnn_ms: number | null; resting_hr_bpm: number | null }[]).map(
    (row) => ({
      date: row.date,
      hrvSdnnMs: row.hrv_sdnn_ms,
      restingHrBpm: row.resting_hr_bpm,
    })
  );
}
