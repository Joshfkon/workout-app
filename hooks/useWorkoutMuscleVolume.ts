'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
import { useUserStore } from '@/stores';
import { usePlannedFrequency } from '@/hooks/usePlannedFrequency';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import { useSleepLog } from '@/hooks/useSleepLog';
import { getLocalDateString } from '@/lib/utils';
import {
  accumulateExerciseVolume,
  buildVolumeRows,
  volumeAccumulatorToStats,
  STANDARD_TO_COARSE,
  type CoarseMuscle,
  type MuscleVolumeStats,
  type VolumeAccumulator,
  type VolumeRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';
import type { SetLog } from '@/types/schema';
import { rirFromFeedback, summarizeEffectiveVolume } from '@/services/effectiveVolume';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import { computeSleepWindowMultiplier, recoveryConfigFor } from '@/services/muscleRecovery';
import {
  applyFrozenOrder,
  coarseRecovery,
  hoursUntilReadinessThreshold,
  readinessScore,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';

/**
 * useWorkoutMuscleVolume — the data behind the top-of-workout weekly-volume
 * strip. For EVERY coarse muscle group, it reports the rolling-7-day credited
 * set total (completed history + the sets logged so far in the live session)
 * positioned in that muscle's MEV–MRV band, plus a scalar readiness score
 * projected from the shared recovery heuristic.
 *
 * It reuses the SAME cached history query (`useRecoveryHistory`), the SAME
 * shared volume model (`buildVolumeRows`) and the SAME recovery config
 * (`recoveryConfigFor`, worst-of-children via `coarseRecovery`) as the "What
 * to train" readiness sheet, so the strip and the sheet can never disagree on
 * a muscle's weekly set count, zone or recovery. Read-only: it never touches
 * the workout store.
 *
 * Weekly sets include the live session; readiness does NOT — recovery is
 * forecast from completed sessions only, so a muscle's score holds steady while
 * you train it and moves once the session is finished (see `RecoverySession`).
 *
 * Ordering: readiness descending — but FROZEN once per local day. The first
 * loaded computation of a day persists the order (localStorage), and every
 * later render that day replays it, so nothing reshuffles the cards under the
 * user's thumb mid-session — not a history refetch, and not the completed
 * session landing in the feed. Muscles that join the session later append at
 * the end.
 */

export interface WorkoutMuscleVolumeRow extends VolumeRow {
  /** Working sets this muscle receives from the CURRENT session (credited, rounded). */
  sessionSets: number;
  /**
   * Whether THIS session's exercises target the muscle (primary or secondary).
   * The strip shows these by default; the rest sit behind "Show all".
   */
  trainedThisSession: boolean;
  /** Scalar readiness in [0, 1] — see readinessScore in _lib/readiness. */
  readiness: number;
  /** Estimated hours until readiness crosses the ready threshold (0 = ready). */
  readyInHours: number;
}

export interface UseWorkoutMuscleVolumeArgs {
  /** Non-skipped blocks of the live session (read-only). */
  liveBlocks: ExerciseBlockWithExercise[];
  /** Working + warmup sets logged so far in the live session (read-only). */
  liveSets: SetLog[];
  /** Injected clock — anchors the rolling-7-day window to a stable local day. */
  now: Date;
  /** Gate the history fetch (defaults to true — the strip loads eagerly). */
  enabled?: boolean;
  /**
   * Whether the LIVE workout data (blocks + logged sets) has hydrated. The
   * daily order freeze waits for BOTH this and the history query: a cached
   * history response must not pin the day's order from a render where
   * `liveBlocks`/`liveSets` are still empty (e.g. resuming a workout), or the
   * frozen order races page hydration. Defaults to true for callers without a
   * separate load phase.
   */
  liveDataReady?: boolean;
}

export interface UseWorkoutMuscleVolumeResult {
  /**
   * One row per coarse muscle group, weekly sets vs the MEV–MRV band, ordered
   * by readiness (frozen once per local day — see module doc). Present even
   * while `isLoading` (weekly totals fill in once history arrives).
   */
  rows: WorkoutMuscleVolumeRow[];
  isLoading: boolean;
}

/** localStorage key prefix for the per-local-day frozen strip order. */
const STRIP_ORDER_KEY_PREFIX = 'workout-volume-strip-order:';

function readFrozenOrder(localDay: string): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STRIP_ORDER_KEY_PREFIX + localDay);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((k) => typeof k === 'string') ? parsed : null;
  } catch {
    return null;
  }
}

function writeFrozenOrder(localDay: string, order: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    // Drop stale days so the freeze keys never accumulate.
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(STRIP_ORDER_KEY_PREFIX) && key !== STRIP_ORDER_KEY_PREFIX + localDay) {
        window.localStorage.removeItem(key);
      }
    }
    window.localStorage.setItem(STRIP_ORDER_KEY_PREFIX + localDay, JSON.stringify(order));
  } catch {
    // Storage unavailable (private mode, quota) — the strip just sorts live.
  }
}

/** Merge history + live working sets into weekly per-muscle stats + reachability. */
function useWeeklyStats(
  historyRows: ReturnType<typeof useRecoveryHistory>['historyRows'],
  liveBlocks: ExerciseBlockWithExercise[],
  liveWorkingSetsByBlock: Map<string, SetLog[]>
): { stats: MuscleVolumeStats[]; reachable: Set<StandardMuscleGroup> } {
  return useMemo(() => {
    const acc: VolumeAccumulator = {};
    const reachable = new Set<StandardMuscleGroup>();
    const markReachable = (primary: string | null, secondary: string[]) => {
      for (const token of [primary, ...secondary]) {
        if (!token) continue;
        for (const std of resolveMuscleToStandard(token)) reachable.add(std);
      }
    };

    for (const s of historyRows) {
      for (const ex of s.exercises) {
        const hist = summarizeEffectiveVolume(
          ex.sets.map((set) => set.reportedRir),
          ex.primaryMuscle ?? undefined
        );
        // Real exercise identity: entries merged by id must share tags, or the
        // per-exercise group cap (and the drill-down panel) would conflate
        // distinct exercises that happen to share a primary muscle.
        accumulateExerciseVolume(
          acc,
          { id: ex.id, name: ex.name, primary_muscle: ex.primaryMuscle, secondary_muscles: ex.secondaryMuscles },
          ex.sets.length,
          hist.effectiveSets,
          hist.unratedSets
        );
        markReachable(ex.primaryMuscle, ex.secondaryMuscles);
      }
    }

    for (const block of liveBlocks) {
      markReachable(block.exercise.primaryMuscle, block.exercise.secondaryMuscles);
      const workingSets = liveWorkingSetsByBlock.get(block.id) ?? [];
      if (workingSets.length === 0) continue;
      const live = summarizeEffectiveVolume(
        workingSets.map((s) => rirFromFeedback(s.feedback)),
        block.exercise.name
      );
      accumulateExerciseVolume(
        acc,
        {
          id: block.exercise.id,
          name: block.exercise.name,
          primary_muscle: block.exercise.primaryMuscle,
          secondary_muscles: block.exercise.secondaryMuscles,
        },
        workingSets.length,
        live.effectiveSets,
        live.unratedSets
      );
    }

    return { stats: volumeAccumulatorToStats(acc), reachable };
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock]);
}

export function useWorkoutMuscleVolume({
  liveBlocks,
  liveSets,
  now,
  enabled = true,
  liveDataReady = true,
}: UseWorkoutMuscleVolumeArgs): UseWorkoutMuscleVolumeResult {
  const { historyRows, sessions, isLoading } = useRecoveryHistory(now, enabled);

  // Working (non-warmup) live sets grouped per block (counts feed the volume
  // accumulator; the sets themselves feed the recovery model via their RIR).
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

  const { stats, reachable } = useWeeklyStats(historyRows, liveBlocks, liveWorkingSetsByBlock);

  // Recovery reads COMPLETED sessions only — the same rule the readiness sheet
  // follows, so the strip's readiness score and the sheet's badge still agree.
  // Weekly sets above DO include the live session; readiness does not.
  const recoveryHistory = sessions;

  // Same config resolution as the readiness sheet: athlete profile, learned
  // per-muscle multipliers, sleep and wearable modifiers.
  const enhancedAthleteMode = useUserStore((s) => s.user?.enhancedAthleteMode === true);
  // The user's real experience level drives the Bug 6 session-capacity
  // normalizer (direct MRV / planned frequency). Left undefined it would
  // silently fall back to 'intermediate' — supply it wherever the store has it
  // so the fallback stays visible in dose diagnostics rather than routine.
  const experienceForCapacity = useUserStore((s) => s.user?.experience);
  // PLANNED per-muscle weekly frequency from the active mesocycle — the
  // denominator for the recovery dose model's session capacity. Absent (no
  // active plan) it falls back to DEFAULT_PLANNED_SESSIONS_PER_WEEK, reported
  // in dose diagnostics. Never derived from observed training history.
  const { plannedSessionsPerWeekByMuscle } = usePlannedFrequency();

  const recoveryProfile = enhancedAthleteMode ? ('enhanced' as const) : ('standard' as const);
  const { multipliers } = useRecoveryMultipliers();
  const { state: wearableRecovery } = useWearableRecovery();
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

  // Session-only coarse set counts (credited), the readiness tiebreaker.
  // Built through the SAME model as the weekly rows.
  const sessionSetsByCoarse = useMemo(() => {
    const acc: VolumeAccumulator = {};
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
    const out = new Map<CoarseMuscle, number>();
    for (const row of buildVolumeRows(volumeAccumulatorToStats(acc), undefined, { recoveryProfile })) {
      out.set(row.muscle as CoarseMuscle, row.sets);
    }
    return out;
  }, [liveBlocks, liveWorkingSetsByBlock]);

  // The coarse groups this session TARGETS — derived from the exercises
  // (primary + secondary). These render by default; the rest of the groups sit
  // behind the strip's "Show all" expander.
  const trainedCoarse = useMemo(() => {
    const set = new Set<CoarseMuscle>();
    for (const block of liveBlocks) {
      const tokens = [block.exercise.primaryMuscle, ...(block.exercise.secondaryMuscles || [])];
      for (const token of tokens) {
        if (!token) continue;
        for (const std of resolveMuscleToStandard(token)) {
          const coarse = STANDARD_TO_COARSE[std];
          if (coarse) set.add(coarse);
        }
      }
    }
    return set;
  }, [liveBlocks]);

  // Rows in DESIRED order: readiness descending; session sets, weekly sets and
  // name break ties. EVERY coarse group is listed — the component decides
  // which to render (session muscles by default, all behind "Show all"). The
  // frozen daily order is applied on top below.
  const sortedRows = useMemo<WorkoutMuscleVolumeRow[]>(() => {
    const coarseRows = buildVolumeRows(stats, reachable, { recoveryProfile });
    return coarseRows
      .map((row) => {
        const recovery = coarseRecovery(
          row.muscle as CoarseMuscle,
          recoveryHistory,
          now,
          recoveryConfig
        );
        return {
          ...row,
          sessionSets: sessionSetsByCoarse.get(row.muscle as CoarseMuscle) ?? 0,
          trainedThisSession: trainedCoarse.has(row.muscle as CoarseMuscle),
          readiness: readinessScore(recovery),
          readyInHours: hoursUntilReadinessThreshold(recovery),
        };
      })
      .sort(
        (a, b) =>
          b.readiness - a.readiness ||
          b.sessionSets - a.sessionSets ||
          b.sets - a.sets ||
          a.displayName.localeCompare(b.displayName)
      );
  }, [stats, reachable, trainedCoarse, sessionSetsByCoarse, recoveryHistory, now, recoveryConfig]);

  // ---- Freeze the order once per local day --------------------------------
  const localDay = getLocalDateString(now);
  const [frozen, setFrozen] = useState<{ day: string; order: string[] } | null>(() => {
    const stored = readFrozenOrder(getLocalDateString(now));
    return stored ? { day: getLocalDateString(now), order: stored } : null;
  });

  const desiredOrderKey = sortedRows.map((r) => r.muscle).join('|');
  useEffect(() => {
    // Only freeze from a FULLY loaded computation: history still resolving
    // means readiness is all 1s, and live workout data still hydrating means
    // today's logged sets are missing — either would pin a wrong order for
    // the rest of the day (Codex P2 on #503: a cached history query must not
    // win the race against page hydration).
    if (isLoading || !liveDataReady || sortedRows.length === 0) return;
    const desired = desiredOrderKey.split('|');
    const current = frozen?.day === localDay ? frozen.order : readFrozenOrder(localDay);
    if (!current) {
      writeFrozenOrder(localDay, desired);
      setFrozen({ day: localDay, order: desired });
      return;
    }
    // Order stays frozen; only APPEND muscles the day's order hasn't seen yet.
    const known = new Set(current);
    const additions = desired.filter((m) => !known.has(m));
    const next = additions.length > 0 ? [...current, ...additions] : current;
    if (additions.length > 0) writeFrozenOrder(localDay, next);
    if (frozen?.day !== localDay || next !== frozen.order) {
      setFrozen({ day: localDay, order: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, liveDataReady, localDay, desiredOrderKey]);

  const rows = useMemo<WorkoutMuscleVolumeRow[]>(() => {
    if (!frozen || frozen.day !== localDay) return sortedRows;
    const order = applyFrozenOrder(sortedRows.map((r) => r.muscle), frozen.order);
    const rank = new Map(order.map((m, i) => [m, i]));
    return [...sortedRows].sort(
      (a, b) => (rank.get(a.muscle) ?? 0) - (rank.get(b.muscle) ?? 0)
    );
  }, [sortedRows, frozen, localDay]);

  return { rows, isLoading };
}
