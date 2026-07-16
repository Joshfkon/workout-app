'use client';

import { useMemo } from 'react';
import { useRecoveryHistory } from '@/hooks/useMuscleReadiness';
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
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

/**
 * useWorkoutMuscleVolume — the data behind the top-of-workout weekly-volume
 * strip. For every coarse muscle group THIS session trains, it reports the
 * rolling-7-day credited set total (completed history + the sets logged so far
 * in the live session) positioned in that muscle's MEV–MRV band.
 *
 * It reuses the SAME cached history query (`useRecoveryHistory`) and the SAME
 * shared volume model (`buildVolumeRows`) as the "What to train" readiness
 * sheet, so the strip and the sheet can never disagree on a muscle's weekly set
 * count or zone. Read-only: it never touches the workout store.
 */

export interface WorkoutMuscleVolumeRow extends VolumeRow {
  /** Working sets this muscle receives from the CURRENT session (credited, rounded). */
  sessionSets: number;
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
   * Coarse rows for the muscles this session trains, weekly sets vs the MEV–MRV
   * band, ordered by how much today's session works each (most-worked first).
   * Present even while `isLoading` (weekly totals fill in once history arrives).
   */
  rows: WorkoutMuscleVolumeRow[];
  isLoading: boolean;
}

/** Merge history + live working sets into weekly per-muscle stats + reachability. */
function useWeeklyStats(
  historyRows: ReturnType<typeof useRecoveryHistory>['historyRows'],
  liveBlocks: ExerciseBlockWithExercise[],
  liveWorkingSetsByBlock: Map<string, number>
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
      const workingSets = liveWorkingSetsByBlock.get(block.id) ?? 0;
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
  const { historyRows, isLoading } = useRecoveryHistory(now, enabled);

  // Working (non-warmup) live sets counted per block.
  const liveWorkingSetsByBlock = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of liveSets) {
      if (s.isWarmup || s.setType === 'warmup') continue;
      map.set(s.exerciseBlockId, (map.get(s.exerciseBlockId) ?? 0) + 1);
    }
    return map;
  }, [liveSets]);

  const { stats, reachable } = useWeeklyStats(historyRows, liveBlocks, liveWorkingSetsByBlock);

  // Session-only coarse set counts (credited), for ordering the strip by what
  // today actually works most. Built through the SAME model as the weekly rows.
  const sessionSetsByCoarse = useMemo(() => {
    const acc: VolumeAccumulator = {};
    for (const block of liveBlocks) {
      const workingSets = liveWorkingSetsByBlock.get(block.id) ?? 0;
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

  // The coarse groups this session TARGETS — derived from the exercises (primary
  // + secondary), so the strip lists them from the start of the workout, before
  // any set is logged, and their weekly totals tick up as sets land.
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

  const rows = useMemo<WorkoutMuscleVolumeRow[]>(() => {
    const coarseRows = buildVolumeRows(stats, reachable);
    return coarseRows
      .filter((row) => trainedCoarse.has(row.muscle as CoarseMuscle))
      .map((row) => ({ ...row, sessionSets: sessionSetsByCoarse.get(row.muscle as CoarseMuscle) ?? 0 }))
      .sort(
        (a, b) =>
          b.sessionSets - a.sessionSets ||
          b.sets - a.sets ||
          a.displayName.localeCompare(b.displayName)
      );
  }, [stats, reachable, trainedCoarse, sessionSetsByCoarse]);

  return { rows, isLoading };
}
