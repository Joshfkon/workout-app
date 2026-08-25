'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { usePlannedFrequency } from '@/hooks/usePlannedFrequency';
import { useAuthUser } from '@/hooks/useAuthUser';
import { rpeToRir, type StandardMuscleGroup } from '@/types/schema';
import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import {
  accumulateExerciseVolume,
  volumeAccumulatorToStats,
  weeklyVolumeWindowStartISO,
  type VolumeAccumulator,
  type MuscleVolumeStats,
  type CoarseMuscle,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { resolveMuscleToStandard } from '@/types/schema';
import { rirFromFeedback, sumEffectiveVolume } from '@/services/effectiveVolume';
import {
  computeSleepWindowMultiplier,
  recoveryConfigFor,
  type RecoverySession,
  type RecoveryExercise,
} from '@/services/muscleRecovery';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { stabilizersForExerciseName } from '@/services/shared/stabilizerTags';
import {
  computeDailyGroupSets,
  type DailyGroupSets,
  type DatedVolumeBlock,
} from '@/services/volumeProjection';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import { useSleepLog } from '@/hooks/useSleepLog';
import {
  buildReadinessRows,
  selectGoodTargets,
  type ReadinessRow,
  type ReadinessTarget,
  type NextReadyTarget,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';

/**
 * useMuscleReadiness — data hook for the in-workout Muscle Readiness sheet.
 *
 * Combines two READ-ONLY signals into a ranked list of muscles:
 *   1. weekly volume — completed-session sets from the DB PLUS the sets logged
 *      so far in the live session (passed in as props),
 *   2. recovery — the pure `muscleRecovery` heuristic over COMPLETED sessions
 *      only.
 *
 * The asymmetry is deliberate. Volume is a counter of work done, so a set
 * counts the instant it is logged. Recovery is a forecast of when a muscle will
 * be ready AGAIN, and that clock starts when the session ends — see the
 * `RecoverySession` doc in services/muscleRecovery. So mid-workout a muscle's
 * weekly bar fills as you train it while its recovery badge holds whatever the
 * last completed session left it at; the session you are logging lands on the
 * badge once you finish it.
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
    /** Real exercise identity — the volume accumulator keys contributing-
     *  exercise credits by this, so the readiness drill-down can name the
     *  exercises behind a muscle's weekly count. */
    id: string;
    name: string;
    primaryMuscle: string | null;
    secondaryMuscles: string[];
    /** Stabilizer tags — feed ONLY the stabilizer-recovery channel. */
    stabilizers: string[];
    // Working sets only (warmups excluded on ingest). `repsInTank` is the
    // recovery-model RIR (feedback, else RPE-derived); `reportedRir` is ONLY
    // the explicitly logged feedback RIR (null otherwise) and is what the
    // effective-volume weighting consumes (unknown → 1.0, conservative).
    sets: { repsInTank: number | null; reportedRir: number | null }[];
  }[];
}

interface RawBlockRow {
  exercises: {
    id: string;
    name: string;
    primary_muscle: string | null;
    secondary_muscles: string[] | null;
    stabilizers: string[] | null;
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

export interface UseMuscleReadinessArgs {
  /** Non-skipped blocks of the live session (read-only). */
  liveBlocks: ExerciseBlockWithExercise[];
  /** Working + warmup sets logged so far in the live session (read-only). */
  liveSets: SetLog[];
  /** Injected clock — the sheet passes a value stamped when it opens. */
  now: Date;
  /** Only fetch history while the sheet is open (lazy). */
  enabled: boolean;
  /**
   * Muscles the user reported "still sore" TODAY (start-of-session chips).
   * They render Fatigued for the rest of the session regardless of the time
   * model — the subjective report outranks the heuristic same-day.
   */
  sorenessOverrides?: ReadonlySet<StandardMuscleGroup>;
}

export interface UseMuscleReadinessResult {
  rows: ReadinessRow[];
  targets: ReadinessTarget[];
  /** Soonest-ready lagging muscle, set only when `targets` is empty. */
  nextUp: NextReadyTarget | null;
  /**
   * Credited group sets per local day (index = days ago), from the SAME
   * blocks the rows count — feeds the rolling-volume decay forecast behind
   * each expanded row.
   */
  dailyGroupSets: DailyGroupSets;
  isLoading: boolean;
  error: string | null;
  /** Re-run the history fetch (error retry). */
  refetch: () => void;
}

/**
 * The shared completed-session history feed for every recovery surface: the
 * in-workout readiness sheet, the analytics recovery card and the legacy
 * per-standard-muscle adapter (`useMuscleRecovery`) all read THIS query — one
 * key, one cache — and run the same pure recovery heuristic over its rows.
 */
export function useRecoveryHistory(
  now: Date,
  enabled: boolean
): {
  /** Raw grouped rows (feeds the weekly-volume accumulator). */
  historyRows: HistorySessionRow[];
  /** The same rows shaped for the pure recovery heuristic. */
  sessions: RecoverySession[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
} {
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
          exercises!inner ( id, name, primary_muscle, secondary_muscles, stabilizers ),
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
          id: exercise.id,
          name: exercise.name,
          primaryMuscle: exercise.primary_muscle,
          secondaryMuscles: exercise.secondary_muscles || [],
          // Pre-seed rows carry '{}' — fall back to the canonical map by name
          // (same convention as exerciseService.mapDbExercise).
          stabilizers:
            exercise.stabilizers && exercise.stabilizers.length > 0
              ? exercise.stabilizers
              : stabilizersForExerciseName(exercise.name) ?? [],
          sets: workingSets.map((s) => ({
            repsInTank: rirFromRow(s),
            reportedRir: rirFromFeedback(s.feedback),
          })),
        });
      });

      return Array.from(bySession.values());
    },
  });

  const historyRows = useMemo(() => historyQuery.data ?? [], [historyQuery.data]);

  const sessions = useMemo<RecoverySession[]>(
    () =>
      historyRows.map((s) => ({
        performedAt: new Date(s.completedAt),
        exercises: s.exercises.map(
          (ex): RecoveryExercise => ({
            primaryMuscle: ex.primaryMuscle,
            secondaryMuscles: ex.secondaryMuscles,
            stabilizers: ex.stabilizers,
            sets: ex.sets,
          })
        ),
      })),
    [historyRows]
  );

  return {
    historyRows,
    sessions,
    isLoading: historyQuery.isLoading,
    error: historyQuery.error ? (historyQuery.error as Error).message : null,
    refetch: historyQuery.refetch,
  };
}

export function useMuscleReadiness({
  liveBlocks,
  liveSets,
  now,
  enabled,
  sorenessOverrides,
}: UseMuscleReadinessArgs): UseMuscleReadinessResult {
  const { user: storeUser } = useUserStore();
  const { historyRows, sessions, isLoading, error, refetch } = useRecoveryHistory(now, enabled);
  const { multipliers } = useRecoveryMultipliers();
  const { state: wearableRecovery } = useWearableRecovery();

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

  // Merged weekly volume: DB history + live session, via the shared volume
  // accumulator so credits (and the resulting coarse rows / zones) match the
  // volume card and warning exactly. Also derive the reachability set from the
  // same exercises so fine children gate identically.
  const { stats, reachable } = useMemo((): { stats: MuscleVolumeStats[]; reachable: Set<StandardMuscleGroup> } => {
    const acc: VolumeAccumulator = {};
    const reachableSet = new Set<StandardMuscleGroup>();
    const markReachable = (primary: string | null, secondary: string[]) => {
      for (const token of [primary, ...secondary]) {
        if (!token) continue;
        for (const std of resolveMuscleToStandard(token)) reachableSet.add(std);
      }
    };

    // DB history. Credited under the REAL exercise identity so the rows'
    // contributing-exercise lists (the tap-to-see-sources drill-down) name
    // actual exercises rather than collapsing per muscle.
    for (const s of historyRows) {
      for (const ex of s.exercises) {
        accumulateExerciseVolume(
          acc,
          { id: ex.id, name: ex.name, primary_muscle: ex.primaryMuscle, secondary_muscles: ex.secondaryMuscles },
          ex.sets.length,
          sumEffectiveVolume(ex.sets.map((set) => set.reportedRir), ex.name)
        );
        markReachable(ex.primaryMuscle, ex.secondaryMuscles);
      }
    }

    // Live session.
    for (const block of liveBlocks) {
      const liveWorkingSets = liveWorkingSetsByBlock.get(block.id) ?? [];
      markReachable(block.exercise.primaryMuscle, block.exercise.secondaryMuscles);
      if (liveWorkingSets.length === 0) continue;
      accumulateExerciseVolume(
        acc,
        {
          id: block.exercise.id,
          name: block.exercise.name,
          primary_muscle: block.exercise.primaryMuscle,
          secondary_muscles: block.exercise.secondaryMuscles,
        },
        liveWorkingSets.length,
        sumEffectiveVolume(
          liveWorkingSets.map((s) => rirFromFeedback(s.feedback)),
          block.exercise.name
        )
      );
    }

    return { stats: volumeAccumulatorToStats(acc), reachable: reachableSet };
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock]);

  // Per-day credited group sets for the rolling decay forecast — the same
  // history + live blocks the stats count, dated: history by its session's
  // completed_at, live sets as today. Same canonical per-set credit, so the
  // forecast's day-0 value reconciles with the row headers.
  const dailyGroupSets = useMemo((): DailyGroupSets => {
    const dated: DatedVolumeBlock[] = [];
    for (const s of historyRows) {
      for (const ex of s.exercises) {
        dated.push({
          completedAt: s.completedAt,
          primaryMuscle: ex.primaryMuscle,
          secondaryMuscles: ex.secondaryMuscles,
          workingSets: ex.sets.length,
        });
      }
    }
    for (const block of liveBlocks) {
      const liveWorkingSets = liveWorkingSetsByBlock.get(block.id) ?? [];
      if (liveWorkingSets.length === 0) continue;
      dated.push({
        completedAt: now.toISOString(),
        primaryMuscle: block.exercise.primaryMuscle,
        secondaryMuscles: block.exercise.secondaryMuscles,
        workingSets: liveWorkingSets.length,
      });
    }
    return computeDailyGroupSets(dated, now);
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock, now]);

  // Recovery history is COMPLETED sessions only — the live session is excluded
  // on purpose (see the module doc and `RecoverySession`). It joins this feed
  // when it is marked completed, which invalidateWorkoutDerivedCaches refreshes.
  const recoveryHistory = sessions;

  // Enhanced athletes get shorter recovery windows (shared windowScale), the
  // learned per-muscle soreness multipliers scale each muscle's window, and
  // recent sleep scales ALL windows (trailing-2-night avg <6h → ×1.15;
  // ≥8h good quality → ×0.95), and the wearable HRV/RHR modifier layers on
  // top (bounded, composed + clamped globally in recoveryConfigFor).
  const enhancedAthleteMode = storeUser?.enhancedAthleteMode === true;
  // The user's real experience level drives the Bug 6 session-capacity
  // normalizer (direct MRV / planned frequency). Left undefined it would
  // silently fall back to 'intermediate' — supply it wherever the store has it
  // so the fallback stays visible in dose diagnostics rather than routine.
  const experienceForCapacity = storeUser?.experience;
  // PLANNED per-muscle weekly frequency from the active mesocycle — the
  // denominator for the recovery dose model's session capacity. Absent (no
  // active plan) it falls back to DEFAULT_PLANNED_SESSIONS_PER_WEEK, reported
  // in dose diagnostics. Never derived from observed training history.
  const { plannedSessionsPerWeekByMuscle } = usePlannedFrequency();

  const { entries: sleepEntries } = useSleepLog();
  const recoveryConfig = useMemo(
    () =>
      recoveryConfigFor(
        enhancedAthleteMode,
        multipliers,
        computeSleepWindowMultiplier(sleepEntries, now),
        wearableRecovery.scale,
        { experienceForCapacity, plannedSessionsPerWeekByMuscle }
      ),
    [
      enhancedAthleteMode,
      multipliers,
      sleepEntries,
      now,
      wearableRecovery.scale,
      experienceForCapacity,
      plannedSessionsPerWeekByMuscle,
    ]
  );

  const rows = useMemo(
    () =>
      buildReadinessRows(
        stats,
        recoveryHistory,
        now,
        reachable,
        recoveryConfig,
        sorenessOverrides,
        enhancedAthleteMode ? 'enhanced' : 'standard'
      ),
    [stats, recoveryHistory, now, reachable, recoveryConfig, sorenessOverrides]
  );

  const { targets, nextUp } = useMemo(() => selectGoodTargets(rows, 3), [rows]);

  return {
    rows,
    targets,
    nextUp,
    dailyGroupSets,
    isLoading,
    error,
    refetch,
  };
}

/**
 * Dashboard variant for surfaces OUTSIDE an active workout (the analytics
 * Muscle Recovery card): the same unified rows — same fetch, same query key
 * (shared React Query cache with the in-workout sheet), same volume + recovery
 * pairing — with no live session to merge.
 */
export function useDashboardMuscleReadiness(now: Date): UseMuscleReadinessResult {
  return useMuscleReadiness({
    liveBlocks: EMPTY_BLOCKS,
    liveSets: EMPTY_SETS,
    now,
    enabled: true,
  });
}

// Stable empty references so the no-live-session hook variant never re-memoizes.
const EMPTY_BLOCKS: ExerciseBlockWithExercise[] = [];
const EMPTY_SETS: SetLog[] = [];
