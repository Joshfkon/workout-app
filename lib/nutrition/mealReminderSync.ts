'use client';

/**
 * Keeps the scheduled meal reminders in step with the food log: reads the
 * user's preference and which meals are already logged today, then replaces
 * the scheduled one-shots (services/mealReminders has the rules).
 */

import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { now } from '@/lib/clock';
import {
  planMealReminders,
  readMealReminderSettings,
  type MealReminderSettings,
} from '@/services/mealReminders';
import { scheduleMealReminders } from '@/lib/integrations/notifications';

/** Re-plan and reschedule. `requestPermission` only on an explicit "turn on" tap. */
export async function syncMealReminders(options: { requestPermission?: boolean } = {}): Promise<boolean> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const [{ data: profile }, { data: logged }] = await Promise.all([
    supabase.from('users').select('preferences').eq('id', user.id).maybeSingle(),
    supabase
      .from('food_log')
      .select('meal_type')
      .eq('user_id', user.id)
      .eq('logged_at', getLocalDateString()),
  ]);

  const settings = readMealReminderSettings(profile?.preferences);
  const loggedToday = new Set(((logged ?? []) as Array<{ meal_type: string | null }>).map((r) => r.meal_type ?? ''));
  const planned = planMealReminders(settings, loggedToday, now());
  return scheduleMealReminders(planned, options);
}

/** Save the preference (read-merge-write on users.preferences), then reschedule. */
export async function saveMealReminderSettings(next: MealReminderSettings): Promise<boolean> {
  const supabase = createUntypedClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from('users')
    .select('preferences')
    .eq('id', user.id)
    .maybeSingle();
  const preferences = { ...((profile?.preferences as Record<string, unknown>) ?? {}), mealReminders: next };
  const { error } = await supabase.from('users').update({ preferences }).eq('id', user.id);
  if (error) throw error;
  return syncMealReminders({ requestPermission: next.enabled });
}
