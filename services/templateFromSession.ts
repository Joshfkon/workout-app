/**
 * templateFromSession.ts
 *
 * Pure mapping from a workout session's exercise blocks (+ its logged sets)
 * to `workout_template_exercises` draft rows, so an in-progress or
 * just-finished session can be saved as a reusable template ("Save as
 * template" in the active workout's ⋮ menu).
 *
 * Rule: what you ACTUALLY did wins over what was planned. A block with
 * logged working sets contributes its real set count, rep spread and top
 * working weight; a block you haven't reached yet falls back to its
 * prescribed targets. Warmups never count.
 *
 * Weights stay in kg — the app-wide storage invariant. Duration-based
 * exercises (seconds in the reps field, see services/shared/setModality)
 * format their range with an `s` suffix so "45s" never reads as 45 reps.
 */

import { getSetDuration, getSetReps, isDurationExercise } from '@/services/shared/setModality';
import type { ExerciseType } from '@/types/schema';

/** Fallbacks for blocks carrying no usable prescription. */
const FALLBACK_REP_RANGE: [number, number] = [8, 12];
const FALLBACK_REST_SECONDS = 90;

/** The minimal exercise shape the mapping needs. */
export interface TemplateSourceExercise {
  name: string;
  exerciseType?: ExerciseType | null;
}

/** The minimal exercise-block shape the mapping needs. */
export interface TemplateSourceBlock {
  id: string;
  exerciseId: string;
  exercise: TemplateSourceExercise;
  targetSets: number;
  targetRepRange: readonly number[];
  targetWeightKg: number;
  targetRestSeconds: number;
  note?: string | null;
}

/** The minimal logged-set shape the mapping needs. */
export interface TemplateSourceSet {
  exerciseBlockId: string;
  reps: number;
  weightKg: number;
  isWarmup?: boolean;
  setType?: string | null;
}

/**
 * One `workout_template_exercises` row, minus `template_id` (assigned by the
 * writer once the parent template exists). Snake_case because it is inserted
 * verbatim.
 */
export interface TemplateExerciseDraft {
  exercise_id: string;
  exercise_name: string;
  exercise_type: string;
  sort_order: number;
  default_sets: number;
  default_reps: string;
  default_weight: number | null;
  default_rest_seconds: number;
  notes: string | null;
}

function normalizeRange(range: readonly number[] | null | undefined): [number, number] {
  const min = range?.[0];
  const max = range?.[1];
  if (!Number.isFinite(min) || !Number.isFinite(max) || (min as number) <= 0) {
    return FALLBACK_REP_RANGE;
  }
  const lo = min as number;
  const hi = Number.isFinite(max) && (max as number) >= lo ? (max as number) : lo;
  return [lo, hi];
}

function formatRange(min: number, max: number, unit: 'reps' | 'seconds'): string {
  const suffix = unit === 'seconds' ? 's' : '';
  const lo = Math.round(min);
  const hi = Math.round(max);
  return lo === hi ? `${lo}${suffix}` : `${lo}-${hi}${suffix}`;
}

function roundWeight(kg: number): number {
  return Math.round(kg * 100) / 100;
}

/**
 * Build the template's exercise rows from a session's blocks, in the order
 * the blocks are given (callers pass the non-skipped blocks in workout order).
 */
export function buildTemplateExercises(
  blocks: readonly TemplateSourceBlock[],
  sets: readonly TemplateSourceSet[] = []
): TemplateExerciseDraft[] {
  // Working sets per block — warmups are prescription noise, not the template.
  const workingByBlock = new Map<string, TemplateSourceSet[]>();
  for (const set of sets) {
    if (set.isWarmup || set.setType === 'warmup') continue;
    const existing = workingByBlock.get(set.exerciseBlockId);
    if (existing) existing.push(set);
    else workingByBlock.set(set.exerciseBlockId, [set]);
  }

  return blocks.map((block, index) => {
    const logged = workingByBlock.get(block.id) ?? [];
    const duration = isDurationExercise(block.exercise);
    const unit: 'reps' | 'seconds' = duration ? 'seconds' : 'reps';

    const loggedValues = logged
      .map((set) =>
        duration ? getSetDuration(set, block.exercise) : getSetReps(set, block.exercise)
      )
      .filter((value): value is number => Number.isFinite(value) && (value as number) > 0);

    const [targetMin, targetMax] = normalizeRange(block.targetRepRange);
    const defaultReps = loggedValues.length
      ? formatRange(Math.min(...loggedValues), Math.max(...loggedValues), unit)
      : formatRange(targetMin, targetMax, unit);

    // Top working weight beats an average: it's the load worth reloading the
    // bar to next time, and matches how snapshots record a session.
    const loggedWeights = logged
      .map((set) => set.weightKg)
      .filter((kg) => Number.isFinite(kg) && kg > 0);
    const weightKg = loggedWeights.length
      ? Math.max(...loggedWeights)
      : block.targetWeightKg;

    const targetSets = Number.isFinite(block.targetSets) ? block.targetSets : 0;
    const rest = Number.isFinite(block.targetRestSeconds) ? block.targetRestSeconds : 0;

    return {
      exercise_id: block.exerciseId,
      exercise_name: block.exercise.name,
      exercise_type: block.exercise.exerciseType ?? 'rep_based',
      sort_order: index,
      default_sets: Math.max(1, logged.length || targetSets),
      default_reps: defaultReps,
      default_weight:
        Number.isFinite(weightKg) && weightKg > 0 ? roundWeight(weightKg) : null,
      default_rest_seconds: rest > 0 ? rest : FALLBACK_REST_SECONDS,
      notes: block.note?.trim() || null,
    };
  });
}
