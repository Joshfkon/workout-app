'use client';

/**
 * Data for the pre-workout setup flow: the exercise catalog (with the fields
 * the draft builder and auto-arrange read) and a short list of recent
 * completed sessions (shortcuts + swap recency).
 *
 * Both are cached-first React Query reads under PERSISTED prefixes
 * ('exercises', 'history'), so after one online visit the picker and draft
 * editor work from the on-disk snapshot with the network off. 'history' is
 * also a workout-derived prefix, so finishing a workout refreshes the
 * shortcuts.
 */

import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { IMMUTABLE_GC_TIME } from '@/lib/query/queryClient';
import { stabilizersForExerciseName } from '@/services/shared/stabilizerTags';
import type { RecentSessionSummary, SetupExercise } from '@/services/workoutSetup/types';

const SETUP_CATALOG_COLUMNS =
  'id, name, primary_muscle, secondary_muscles, mechanic, movement_pattern, equipment_required, equipment_class, is_bodyweight, hypertrophy_tier, default_rep_range, default_rir, stabilizers, is_custom, exercise_type';

interface CatalogRow {
  id: string;
  name: string;
  primary_muscle: string | null;
  secondary_muscles: string[] | null;
  mechanic: 'compound' | 'isolation' | null;
  movement_pattern: string | null;
  equipment_required: string[] | null;
  equipment_class: string | null;
  is_bodyweight: boolean | null;
  hypertrophy_tier: string | null;
  default_rep_range: number[] | null;
  default_rir: number | null;
  stabilizers: string[] | null;
  is_custom: boolean | null;
  exercise_type: string | null;
}

/** DB row → SetupExercise. Stock rows seeded with '{}' fall back to the
 *  canonical stabilizer map by name (the exerciseService convention). */
export function mapSetupCatalogRow(row: CatalogRow): SetupExercise | null {
  if (!row.primary_muscle) return null;
  const range = row.default_rep_range;
  return {
    id: row.id,
    name: row.name,
    primaryMuscle: row.primary_muscle,
    secondaryMuscles: row.secondary_muscles ?? [],
    mechanic: row.mechanic,
    movementPattern: row.movement_pattern,
    equipment: row.equipment_required ?? [],
    equipmentClass: row.equipment_class,
    isBodyweight: row.is_bodyweight === true,
    tier: row.hypertrophy_tier,
    defaultRepRange: range && range.length >= 2 ? [range[0], range[1]] : null,
    defaultRir: row.default_rir,
    stabilizers:
      row.stabilizers && row.stabilizers.length > 0
        ? row.stabilizers
        : row.is_custom === true
          ? []
          : stabilizersForExerciseName(row.name) ?? [],
    exerciseType: row.exercise_type,
  };
}

export function useSetupCatalog(enabled: boolean) {
  return useQuery<SetupExercise[]>({
    queryKey: ['exercises', 'setup-catalog'],
    enabled,
    staleTime: 10 * 60_000,
    gcTime: IMMUTABLE_GC_TIME,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercises')
        .select(SETUP_CATALOG_COLUMNS)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as CatalogRow[])
        .map(mapSetupCatalogRow)
        .filter((ex): ex is SetupExercise => ex !== null);
    },
  });
}

const RECENT_SESSION_LIMIT = 10;

interface RecentRow {
  id: string;
  completed_at: string | null;
  exercise_blocks:
    | {
        exercise_id: string;
        order: number;
        skipped_at: string | null;
        exercises: { name: string; primary_muscle: string | null; secondary_muscles: string[] | null } | null;
        set_logs: { is_warmup: boolean | null }[] | null;
      }[]
    | null;
}

export function useRecentSessionSummaries(enabled: boolean, excludeSessionId?: string) {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;

  return useQuery<RecentSessionSummary[]>({
    queryKey: ['history', 'setup-recent', userId],
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
    gcTime: IMMUTABLE_GC_TIME,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('workout_sessions')
        .select(
          'id, completed_at, exercise_blocks(exercise_id, order, skipped_at, exercises(name, primary_muscle, secondary_muscles), set_logs(is_warmup))'
        )
        .eq('user_id', userId)
        .eq('state', 'completed')
        .order('completed_at', { ascending: false })
        .limit(RECENT_SESSION_LIMIT);
      if (error) throw error;
      return ((data ?? []) as RecentRow[]).flatMap((row): RecentSessionSummary[] => {
        if (!row.completed_at) return [];
        const exercises = [...(row.exercise_blocks ?? [])]
          .filter((b) => !b.skipped_at && b.exercises?.primary_muscle)
          .sort((a, b) => a.order - b.order)
          .map((b) => ({
            exerciseId: b.exercise_id,
            name: b.exercises!.name,
            primaryMuscle: b.exercises!.primary_muscle!,
            secondaryMuscles: b.exercises!.secondary_muscles ?? [],
            workingSets: (b.set_logs ?? []).filter((s) => !s.is_warmup).length,
          }))
          .filter((e) => e.workingSets > 0);
        return exercises.length > 0
          ? [{ sessionId: row.id, completedAt: row.completed_at, exercises }]
          : [];
      });
    },
    select: (sessions) =>
      excludeSessionId ? sessions.filter((s) => s.sessionId !== excludeSessionId) : sessions,
  });
}
