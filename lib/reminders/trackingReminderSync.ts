'use client';

/**
 * Keeps the scheduled tracking + workout reminders in step with what's been
 * logged: reads the snapshot, the active block's schedule and whether a
 * session was finished today, then replaces the scheduled one-shots
 * (services/trackingReminders has the rules).
 */

import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { now as clockNow } from '@/lib/clock';
import { fetchActiveMesocycle } from '@/lib/training/fetchActiveMesocycle';
import {
  buildTrainingSchedule,
  getWorkoutForDate,
  scheduledDatesBetween,
} from '@/lib/training/trainingSchedule';
import {
  TRACKING_REMINDER_DAYS_AHEAD,
  computeTrackingStatus,
  planTrackingReminders,
  readTrackingReminderSettings,
  trackingReminderIds,
  trackingReminderPreferencesPatch,
  type TrackingReminderSettings,
  type TrainingDay,
} from '@/services/trackingReminders';
import { scheduleReminderBatch } from '@/lib/integrations/notifications';
import { fetchTrackingSnapshot } from './trackingSnapshot';

/** Re-plan and reschedule. `requestPermission` only on an explicit "turn on" tap. */
export async function syncTrackingReminders(options: { requestPermission?: boolean } = {}): Promise<boolean> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const snapshot = await fetchTrackingSnapshot(supabase, user.id);
  const settings = readTrackingReminderSettings(snapshot.preferences);
  const now = clockNow();
  const today = getLocalDateString(now);

  let trainingDays: TrainingDay[] = [];
  let trainedToday = false;
  if (settings.workoutNotify) {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const [mesocycle, finished] = await Promise.all([
      fetchActiveMesocycle(supabase, user.id),
      supabase
        .from('workout_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('state', 'completed')
        .gte('completed_at', midnight.toISOString()),
    ]);
    trainedToday = (finished.count ?? 0) > 0;
    if (mesocycle) {
      const schedule = buildTrainingSchedule(mesocycle);
      const end = new Date(now);
      end.setDate(end.getDate() + TRACKING_REMINDER_DAYS_AHEAD - 1);
      trainingDays = scheduledDatesBetween(schedule, now, end).map((date) => ({
        date: getLocalDateString(date),
        label: getWorkoutForDate(mesocycle.split_type, date, schedule)?.dayName ?? null,
      }));
    }
  }

  const statuses = computeTrackingStatus({
    settings,
    lastLogged: snapshot.lastLogged,
    accountCreated: snapshot.accountCreated,
    today,
  });
  const planned = planTrackingReminders({ settings, statuses, trainingDays, trainedToday, now, today });
  return scheduleReminderBatch(trackingReminderIds(), planned, options);
}

/** Save the preferences (read-merge-write on users.preferences), then reschedule. */
export async function saveTrackingReminderSettings(next: TrackingReminderSettings): Promise<boolean> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile, error: readError } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) throw readError;
  const preferences = {
    ...((profile?.preferences as Record<string, unknown>) ?? {}),
    ...trackingReminderPreferencesPatch(next),
  };
  const { error } = await supabase.from('users').update({ preferences }).eq('id', user.id);
  if (error) throw error;
  return syncTrackingReminders({ requestPermission: next.notify || next.workoutNotify });
}
