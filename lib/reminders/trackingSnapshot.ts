/**
 * The rows the tracking reminders are computed from: the user's reminder
 * preferences, account age, and the latest weigh-in / tape / photo date.
 * Shared by the Home nudge (hooks/useTrackingReminders) and the notification
 * planner (lib/reminders/trackingReminderSync) so both read the same facts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getLocalDateString } from '@/lib/utils';
import type { TrackingKind } from '@/services/trackingReminders';

export interface TrackingSnapshot {
  /** users.preferences as stored (JSON-plain). */
  preferences: Record<string, unknown> | null;
  /** Local YYYY-MM-DD the account was created, or null. */
  accountCreated: string | null;
  lastLogged: Record<TrackingKind, string | null>;
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  // Timestamps → the user's local day; plain dates pass through.
  return value.length > 10 ? getLocalDateString(new Date(value)) : value;
}

export async function fetchTrackingSnapshot(
  supabase: SupabaseClient,
  userId: string
): Promise<TrackingSnapshot> {
  const [profile, weight, tape, photo] = await Promise.all([
    supabase.from('users').select('preferences, created_at').eq('id', userId).maybeSingle(),
    supabase
      .from('weight_log')
      .select('logged_at')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('body_measurements')
      .select('logged_at')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('progress_photos')
      .select('photo_date')
      .eq('user_id', userId)
      .order('photo_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // A failed read must not look like "never logged" (that would nag).
  for (const res of [profile, weight, tape, photo]) {
    if (res.error) throw res.error;
  }

  const p = profile.data as { preferences?: Record<string, unknown> | null; created_at?: string } | null;
  return {
    preferences: p?.preferences ?? null,
    accountCreated: dateOnly(p?.created_at),
    lastLogged: {
      weigh: dateOnly((weight.data as { logged_at?: string } | null)?.logged_at),
      measure: dateOnly((tape.data as { logged_at?: string } | null)?.logged_at),
      photo: dateOnly((photo.data as { photo_date?: string } | null)?.photo_date),
    },
  };
}
