/**
 * durationEstimate.ts
 *
 * Adapter between the live workout's state (blocks + logged sets + skips) and
 * the pure duration model in `services/workoutDurationEstimator`. Kept out of
 * the page so the mapping — which sets count, when warmups still cost time,
 * what a pending picker selection would add — is unit-testable on its own.
 */

import type { SetLog } from '@/types/schema';
import {
  estimateWorkoutDuration,
  type DurationBlockInput,
  type WorkoutDurationEstimate,
} from '@/services/workoutDurationEstimator';
import type { ExerciseBlockWithExercise } from './types';

/** Defaults `handleAddExercise` writes for a block added mid-workout. */
export const ADDED_BLOCK_DEFAULTS = {
  compound: { targetSets: 4, restSeconds: 180 },
  isolation: { targetSets: 3, restSeconds: 90 },
} as const;

function isWorkingSet(set: SetLog): boolean {
  return !set.isWarmup && set.setType !== 'warmup';
}

/**
 * Map live session state onto the duration model.
 *
 * Warmups only cost time while an exercise hasn't started: once a working set
 * is logged, whatever warmup happened is already inside the elapsed clock (and
 * a user who dove straight in never owes it).
 */
export function toDurationBlocks(
  blocks: ExerciseBlockWithExercise[],
  completedSets: SetLog[],
  skippedBlockIds: Set<string>
): DurationBlockInput[] {
  const workingByBlock = new Map<string, number>();
  const warmupsByBlock = new Map<string, number>();
  for (const set of completedSets) {
    const target = isWorkingSet(set) ? workingByBlock : warmupsByBlock;
    target.set(set.exerciseBlockId, (target.get(set.exerciseBlockId) ?? 0) + 1);
  }

  return blocks.map((block) => {
    const done = workingByBlock.get(block.id) ?? 0;
    const protocol = block.warmupProtocol ?? [];
    const warmupsDone = warmupsByBlock.get(block.id) ?? 0;
    const warmupSetsRemaining =
      done > 0 ? 0 : Math.max(0, protocol.length - warmupsDone);

    return {
      id: block.id,
      targetSets: block.targetSets,
      completedSets: done,
      restSeconds: block.targetRestSeconds,
      mechanic: block.exercise.mechanic === 'isolation' ? 'isolation' : 'compound',
      exerciseType: block.exercise.exerciseType ?? null,
      warmupSetsRemaining,
      // Warmups the user actually logged. The workout timer anchors to the
      // first logged set of any kind, so these belong in the pace baseline —
      // otherwise warmup time reads as the user being slow and inflates the
      // whole remaining estimate.
      warmupSetsCompleted: warmupsDone,
      warmupRestSeconds: protocol[0]?.restSeconds ?? null,
      supersetGroupId: block.supersetGroupId,
      skipped: skippedBlockIds.has(block.id),
    };
  });
}

/**
 * How long the user has been in the gap after their most recent set, measured
 * on the WORKOUT TIMER's clock rather than wall time.
 *
 * Both stamps are read from set data, but the span is expressed as a
 * difference of timer readings: `elapsedSeconds` already excludes paused time,
 * so a session paused mid-rest stops accruing rest credit instead of coming
 * back to a bogus "your rest is over". A pause taken BEFORE the last set makes
 * the wall-clock offset larger than the timer's, which clamps to 0 here —
 * under-crediting the gap, which leaves the estimate slightly high rather than
 * confidently low.
 */
export function secondsSinceLastSet(completedSets: SetLog[], elapsedSeconds: number): number {
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const set of completedSets) {
    if (!set.loggedAt) continue;
    const ms = new Date(set.loggedAt).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;
  }
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return 0;

  const elapsedAtLastSet = (lastMs - firstMs) / 1000;
  return Math.max(0, elapsedSeconds - elapsedAtLastSet);
}

export interface SessionDurationInput {
  blocks: ExerciseBlockWithExercise[];
  completedSets: SetLog[];
  skippedBlockIds: Set<string>;
  /** Workout timer reading; omit before the first set lands. */
  elapsedSeconds?: number;
}

export function estimateSessionDuration({
  blocks,
  completedSets,
  skippedBlockIds,
  elapsedSeconds,
}: SessionDurationInput): WorkoutDurationEstimate {
  return estimateWorkoutDuration(toDurationBlocks(blocks, completedSets, skippedBlockIds), {
    elapsedSeconds,
    secondsSinceLastSet: secondsSinceLastSet(completedSets, elapsedSeconds ?? 0),
  });
}

/**
 * Seconds the exercises pending in the add-exercise picker would add to what's
 * left of the session, using the same defaults the add path writes. Warmups are
 * left out: whether a new exercise gets one depends on which muscles are
 * already warm, which the picker can't know until the block exists.
 */
export function estimatePendingAdditionSeconds(
  current: DurationBlockInput[],
  pending: { id: string; mechanic?: string | null }[]
): number {
  if (pending.length === 0) return 0;

  const pendingBlocks: DurationBlockInput[] = pending.map((exercise) => {
    const isIsolation = exercise.mechanic === 'isolation';
    const defaults = isIsolation ? ADDED_BLOCK_DEFAULTS.isolation : ADDED_BLOCK_DEFAULTS.compound;
    return {
      id: `pending-${exercise.id}`,
      targetSets: defaults.targetSets,
      completedSets: 0,
      restSeconds: defaults.restSeconds,
      mechanic: isIsolation ? 'isolation' : 'compound',
    };
  });

  const before = estimateWorkoutDuration(current).remainingSeconds;
  const after = estimateWorkoutDuration([...current, ...pendingBlocks]).remainingSeconds;
  return Math.max(0, after - before);
}
