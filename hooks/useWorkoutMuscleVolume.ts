'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRecoveryHistory, rirFromSetLog } from '@/hooks/useMuscleReadiness';
import { useUserStore } from '@/stores';
import { useRecoveryMultipliers } from '@/hooks/useRecoveryMultipliers';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';
import { useSleepLog } from '@/hooks/useSleepLog';
import { getLocalDateString } from '@/lib/utils';
import {
  accumulateExerciseVolume,
  buildVolumeRows,
  volumeAccumulatorToStats,
  type CoarseMuscle,
  type MuscleVolumeStats,
  type VolumeAccumulator,
  type VolumeRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { resolveMuscleToStandard, type StandardMuscleGroup } from '@/types/schema';
import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';
import {
  computeSleepWindowMultiplier,
  recoveryConfigFor,
  type RecoveryExercise,
  type RecoverySession,
} from '@/services/muscleRecovery';
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
 * Ordering: readiness descending — but FROZEN once per local day. The first
 * loaded computation of a day persists the order (localStorage), and every
 * later render that day replays it, so logging sets mid-workout (which drops
 * a trained muscle's readiness to 0) never reshuffles the cards under the
 * user's thumb. Muscles that join the session later append at the end.
 */

export interface WorkoutMuscleVolumeRow extends VolumeRow {
  /** Working sets this muscle receives from the CURRENT session (credited, rounded). */
  sessionSets: number;
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
        accumulateExerciseVolume(
          acc,
          { id: ex.primaryMuscle || 'x', name: ex.primaryMuscle || 'x', primary_muscle: ex.primaryMuscle, secondary_muscles: ex.secondaryMuscles },
          ex.sets.length
        );
        markReachable(ex.primaryMuscle, ex.secondaryMuscles);
      }
    }

    for (const block of liveBlocks) {
      markReachable(block.exercise.primaryMuscle, block.exercise.secondaryMuscles);
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

    return { stats: volumeAccumulatorToStats(acc), reachable };
  }, [historyRows, liveBlocks, liveWorkingSetsByBlock]);
}

export function useWorkoutMuscleVolume({
  liveBlocks,
  liveSets,
  now,
  enabled = true,
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

  // Recovery history: DB sessions + the live session (timestamped `now`), the
  // same merge the readiness sheet performs, so a set logged five minutes ago
  // reads as just-trained on both surfaces.
  const recoveryHistory = useMemo<RecoverySession[]>(() => {
    const liveExercises: RecoveryExercise[] = liveBlocks
      .map((block): RecoveryExercise => ({
        primaryMuscle: block.exercise.primaryMuscle,
        secondaryMuscles: block.exercise.secondaryMuscles,
        sets: (liveWorkingSetsByBlock.get(block.id) || []).map((s) => ({
          repsInTank: rirFromSetLog(s),
        })),
      }))
      .filter((ex) => ex.sets.length > 0);

    if (liveExercises.length === 0) return sessions;
    return [...sessions, { performedAt: now, exercises: liveExercises }];
  }, [sessions, liveBlocks, liveWorkingSetsByBlock, now]);

  // Same config resolution as the readiness sheet: athlete profile, learned
  // per-muscle multipliers, sleep and wearable modifiers.
  const enhancedAthleteMode = useUserStore((s) => s.user?.enhancedAthleteMode === true);
  const { multipliers } = useRecoveryMultipliers();
  const { state: wearableRecovery } = useWearableRecovery();
  const { entries: sleepEntries } = useSleepLog();
  const recoveryConfig = useMemo(
    () =>
      recoveryConfigFor(
        enhancedAthleteMode,
        multipliers,
        computeSleepWindowMultiplier(sleepEntries, now),
        wearableRecovery.scale
      ),
    [enhancedAthleteMode, multipliers, sleepEntries, now, wearableRecovery.scale]
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
    for (const row of buildVolumeRows(volumeAccumulatorToStats(acc))) {
      out.set(row.muscle as CoarseMuscle, row.sets);
    }
    return out;
  }, [liveBlocks, liveWorkingSetsByBlock]);

  // Rows in DESIRED order: readiness descending; session sets, weekly sets and
  // name break ties. EVERY coarse group is listed — muscles this session
  // doesn't touch still carry their weekly total + readiness (the strip is
  // collapsible for users who want it out of the way). The frozen daily order
  // is applied on top below.
  const sortedRows = useMemo<WorkoutMuscleVolumeRow[]>(() => {
    const coarseRows = buildVolumeRows(stats, reachable);
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
  }, [stats, reachable, sessionSetsByCoarse, recoveryHistory, now, recoveryConfig]);

  // ---- Freeze the order once per local day --------------------------------
  const localDay = getLocalDateString(now);
  const [frozen, setFrozen] = useState<{ day: string; order: string[] } | null>(() => {
    const stored = readFrozenOrder(getLocalDateString(now));
    return stored ? { day: getLocalDateString(now), order: stored } : null;
  });

  const desiredOrderKey = sortedRows.map((r) => r.muscle).join('|');
  useEffect(() => {
    // Only freeze from a LOADED computation — pre-history readiness is all 1s
    // and would pin a meaningless order for the rest of the day.
    if (isLoading || sortedRows.length === 0) return;
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
  }, [isLoading, localDay, desiredOrderKey]);

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
