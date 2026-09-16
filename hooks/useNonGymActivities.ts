'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { weeklyVolumeWindowStartISO } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { RecoverySession } from '@/services/muscleRecovery';
import {
  activityToRecoverySession,
  cardioLogToRecoverySession,
  sanitizeMuscleGroups,
  type ActivityIntensity,
  type ActivityType,
  type NonGymActivity,
} from '@/services/nonGymActivity';

/**
 * useNonGymActivityFatigue — the non-gym half of the recovery model's input.
 *
 * Fetches recent `non_gym_activities` rows AND recent `cardio_log` rows (the
 * Zone-2 tracker bridge — a ride logged there must not read as zero fatigue
 * while the same ride logged here creates some), and shapes both into
 * synthetic `RecoverySession`s via the pure mapping in
 * services/nonGymActivity. `useRecoveryHistory` appends these to the
 * completed-session feed, so every recovery surface — readiness sheet,
 * good-targets strip, Train page recovery list, analytics card, next-day
 * preview — sees non-gym fatigue without further wiring.
 *
 * These sessions feed RECOVERY ONLY. They are deliberately kept out of
 * `historyRows` (the weekly-volume accumulator input): an activity is
 * recovery debt, never sets toward MEV/MRV.
 */

/** Query-key prefix — invalidated by the logger's mutations. */
export const NON_GYM_ACTIVITIES_QUERY_PREFIX = 'non-gym-activities';

interface ActivityRow {
  id: string;
  performed_at: string;
  activity_type: string;
  name: string | null;
  duration_minutes: number | null;
  intensity: string;
  muscle_groups: string[] | null;
  notes: string | null;
}

interface CardioRow {
  logged_at: string;
  minutes: number;
  modality: string;
  created_at: string | null;
}

interface ActivityFeed {
  activities: NonGymActivity[];
  cardio: CardioRow[];
}

const INTENSITIES: readonly ActivityIntensity[] = ['light', 'moderate', 'hard'];
const ACTIVITY_TYPES: readonly ActivityType[] = ['bike', 'run', 'swim', 'hike', 'sport', 'other'];

function rowToActivity(row: ActivityRow): NonGymActivity | null {
  const performedAt = new Date(row.performed_at);
  if (Number.isNaN(performedAt.getTime())) return null;
  const intensity = INTENSITIES.includes(row.intensity as ActivityIntensity)
    ? (row.intensity as ActivityIntensity)
    : 'moderate';
  const activityType = ACTIVITY_TYPES.includes(row.activity_type as ActivityType)
    ? (row.activity_type as ActivityType)
    : 'other';
  return {
    id: row.id,
    performedAt,
    activityType,
    name: row.name,
    durationMinutes: row.duration_minutes,
    intensity,
    muscleGroups: sanitizeMuscleGroups(row.muscle_groups ?? []),
  };
}

export function useNonGymActivityFatigue(
  now: Date,
  enabled: boolean
): {
  /** App-shaped activity rows (newest first) — the logger's recent list. */
  activities: NonGymActivity[];
  /** Synthetic recovery sessions from activities + bridged cardio_log rows. */
  syntheticSessions: RecoverySession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;

  // Same window anchor as the recovery history query: recovery windows cap at
  // 120h, so the 7-day volume window start always covers every live debt.
  const windowStart = useMemo(() => weeklyVolumeWindowStartISO(now), [now]);

  const query = useQuery<ActivityFeed>({
    queryKey: [NON_GYM_ACTIVITIES_QUERY_PREFIX, userId, windowStart],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const [activityRes, cardioRes] = await Promise.all([
        supabase
          .from('non_gym_activities')
          .select('id, performed_at, activity_type, name, duration_minutes, intensity, muscle_groups, notes')
          .eq('user_id', userId)
          .gte('performed_at', windowStart)
          .order('performed_at', { ascending: false }),
        supabase
          .from('cardio_log')
          .select('logged_at, minutes, modality, created_at')
          .eq('user_id', userId)
          // logged_at is a DATE; comparing against the ISO instant's date part
          // over-fetches by at most one local day, which the mapper tolerates.
          .gte('logged_at', windowStart.slice(0, 10)),
      ]);
      if (activityRes.error) throw activityRes.error;
      if (cardioRes.error) throw cardioRes.error;

      return {
        activities: ((activityRes.data as ActivityRow[] | null) ?? [])
          .map(rowToActivity)
          .filter((a): a is NonGymActivity => a !== null),
        cardio: (cardioRes.data as CardioRow[] | null) ?? [],
      };
    },
  });

  const activities = useMemo(() => query.data?.activities ?? [], [query.data]);

  const syntheticSessions = useMemo<RecoverySession[]>(() => {
    const sessions: RecoverySession[] = [];
    for (const activity of activities) {
      const session = activityToRecoverySession(activity);
      if (session) sessions.push(session);
    }
    for (const row of query.data?.cardio ?? []) {
      const session = cardioLogToRecoverySession(row);
      if (session) sessions.push(session);
    }
    return sessions;
  }, [activities, query.data]);

  return {
    activities,
    syntheticSessions,
    isLoading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    refetch: query.refetch,
  };
}

/** Invalidate the activity feed after a write (log/delete). */
export function useInvalidateNonGymActivities(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [NON_GYM_ACTIVITIES_QUERY_PREFIX] });
}
