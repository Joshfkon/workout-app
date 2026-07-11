'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { rpeToRir, type StandardMuscleGroup } from '@/types/schema';
import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import {
  accumulateExerciseVolume,
  weeklyVolumeWindowStartISO,
  type VolumeAccumulator,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { RecoverySession, RecoveryExercise } from '@/services/muscleRecovery';
import {
  buildReadinessRows,
  topTargets,
  type ReadinessRow,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';

/**
 * useMuscleReadiness — data hook for the in-workout Muscle Readiness sheet.
 *
 * Combines two READ-ONLY signals into a ranked list of muscles:
 *   1. weekly volume — completed-session sets from the DB PLUS the sets logged
 *      so far in the live session (passed in as props),
 *   2. recovery — the pure `muscleRecovery` heuristic over the same history +
 *      the live session (timestamped "now" so its sets read as just-trained).
 *
 * It never writes to or reshapes the workout store. Live session data arrives
 * as plain props (the page's own local state), so this hook — and everything it
 * feeds — stays a pure read of session + history.
 */

/** One completed session's rows, as fetched from the DB. */
interface HistorySessionRow {
  sessionId: string;
  completedAt: string;
  exercises: {
    primaryMuscle: string | null;
    secondaryMuscles: string[];
    // Working sets only (warmups excluded on ingest).
    sets: { repsInTank: number | null }[];
  }[];
}

interface RawBlockRow {
  exercises: {
    id: string;
    name: string;
    primary_muscle: string | null;
    secondary_muscles: string[] | null;
  } | null;
  workout_sessions: { id: string; completed_at: string | null } | null;
  set_logs:
    | { id: string; is_warmup: boolean | null; rpe: number | null; feedback?: { repsInTank?: number | null } | null }[]
    | null;
}

/** RIR for a raw DB set row: prefer the logged feedback, else derive from RPE. */
function rirFromRow(set: { rpe: number | null; feedback?: { repsInTank?: number | null } | null }): number | null {
  const rir = set.feedback?.repsInTank;
  if (typeof rir === 'number') return rir;
  return typeof set.rpe === 'number' ? rpeToRir(set.rpe) : null;
}

/** RIR for a live SetLog: prefer the logged feedback, else derive from RPE. */
function rirFromSetLog(set: SetLog): number | null {
  const rir = set.feedback?.repsInTank;
  if (typeof rir === 'number') return rir;
  return typeof set.rpe === 'number' ? rpeToRir(set.rpe) : null;
}

export interface UseMuscleReadinessArgs {
  /** Non-skipped blocks of the live session (read-only). */
  liveBlocks: ExerciseBlockWithExercise[];
  /** Working + warmup sets logged so far in the live session (read-only). */
  liveSets: SetLog[];
  /** Injected clock — the sheet passes a value stamped when it opens. */
  now: Date;
  /** Only fetch history while the sheet is open (lazy). */
  enabled: boolean;
}

export interface UseMuscleReadinessResult {
  rows: ReadinessRow[];
  targets: ReadinessRow[];
  isLoading: boolean;
  error: string | null;
}

export function useMuscleReadiness({
  liveBlocks,
  liveSets,
  now,
  enabled,
}: UseMuscleReadinessArgs): UseMuscleReadinessResult {
  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;

  // Anchor the fetch window to the local day (stable across re-renders within a
  // day) so React Query can cache history across sheet opens.
  const windowStart = useMemo(() => weeklyVolumeWindowStartISO(now), [now]);

  const historyQuery = useQuery<HistorySessionRow[]>({
    queryKey: ['muscle-readiness-history', userId, windowStart],
    enabled: enabled && !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercise_blocks')
        .select(`
          exercises!inner ( id, name, primary_muscle, secondary_muscles ),
          workout_sessions!inner ( id, completed_at, user_id, state ),
          set_logs ( id, is_warmup, rpe, feedback )
        `)
        .eq('workout_sessions.user_id', userId)
        .eq('workout_sessions.state', 'completed')
        .gte('workout_sessions.completed_at', windowStart);

      if (error) throw error;

      // Group blocks into sessions (keyed by session id) for the recovery model.
      const bySession = new Map<string, HistorySessionRow>();
      (data as RawBlockRow[] | null)?.forEach((block) => {
        const exercise = block.exercises;
        const session = block.workout_sessions;
        if (!exercise || !session?.completed_at) return;

        const workingSets = (block.set_logs || []).filter((s) => !s.is_warmup);
        if (workingSets.length === 0) return;

        let entry = bySession.get(session.id);
        if (!entry) {
          entry = { sessionId: session.id, completedAt: session.completed_at, exercises: [] };
          bySession.set(session.id, entry);
        }
        entry.exercises.push({
          primaryMuscle: exercise.primary_muscle,
          secondaryMuscles: exercise.secondary_muscles || [],
          sets: workingSets.map((s) => ({ repsInTank: rirFromRow(s) })),
        });
      });

      return Array.from(bySession.values());
    },
  });

  const historyRows = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  // Working (non-warmup) live sets grouped by block.
  const liveWorkingSetsByBlock = useMemo(() => {
    const map = new Map<string, SetLog[]>();
    for (const s of liveSets) {
      if (s.isWarmup || s.setType === 'warmup') continue;
      const arr = map.get(s.exerciseBlockId) || [];
      arr.push(s);
      map.set(s.exerciseBlockId, arr);
    }
    return map;
  }, [liveSets]);

  // Merged weekly sets per muscle: DB history + live session, via the shared
  // volume accumulator so credits match the volume card exactly.
  const weeklySetsByMuscle = useMemo(() => {
    const acc: VolumeAccumulator = {};

    // DB history.
    for (const s of historyRows) {
      for (const ex of s.exercises) {
        accumulateExerciseVolume(
          acc,
          { id: ex.primaryMuscle || 'x', name: ex.primaryMuscle || 'x', primary_muscle: ex.primaryMuscle, secondary_muscles: ex.secondaryMuscles },
          ex.sets.length
        );
      }
    }

    // Live session.
    for (const block of liveBlocks) {
      const workingSets = liveWorkingSetsByBlock.get(block.id)?.length ?? 0;
      if (workingSets === 0) continue;
      accumulateExerciseVolume(
        acc,
        {
          id: block.exercise.id,
          name: block.exercise.name,
          primary_muscle: block.exercise.primaryMuscle,
          secondary_muscles: block.exercise.secondaryMuscles,
        },
        workingSets
      );
    }

    const out: Partial<Record<StandardMuscleGroup, number>> = {};
    for (const [muscle, data] of Object.entries(acc)) {
      out[muscle as StandardMuscleGroup] = data.sets;
    }
    return out;
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock]);

  // Recovery history: DB sessions + the live session (timestamped `now`).
  const recoveryHistory = useMemo<RecoverySession[]>(() => {
    const sessions: RecoverySession[] = historyRows.map((s) => ({
      performedAt: new Date(s.completedAt),
      exercises: s.exercises.map(
        (ex): RecoveryExercise => ({
          primaryMuscle: ex.primaryMuscle,
          secondaryMuscles: ex.secondaryMuscles,
          sets: ex.sets,
        })
      ),
    }));

    const liveExercises: RecoveryExercise[] = liveBlocks
      .map((block): RecoveryExercise => {
        const sets = (liveWorkingSetsByBlock.get(block.id) || []).map((s) => ({
          repsInTank: rirFromSetLog(s),
        }));
        return {
          primaryMuscle: block.exercise.primaryMuscle,
          secondaryMuscles: block.exercise.secondaryMuscles,
          sets,
        };
      })
      .filter((ex) => ex.sets.length > 0);

    if (liveExercises.length > 0) {
      sessions.push({ performedAt: now, exercises: liveExercises });
    }
    return sessions;
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock, now]);

  const rows = useMemo(
    () => buildReadinessRows(weeklySetsByMuscle, recoveryHistory, now),
    [weeklySetsByMuscle, recoveryHistory, now]
  );

  const targets = useMemo(() => topTargets(rows, 3), [rows]);

  return {
    rows,
    targets,
    isLoading: historyQuery.isLoading,
    error: historyQuery.error ? (historyQuery.error as Error).message : null,
  };
}
