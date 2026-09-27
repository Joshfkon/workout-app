import type { SetupExercise } from '@/services/workoutSetup/types';
import type { AvailableExercise } from '../types';

/**
 * A setup-catalog exercise in the shape the workout page's add path takes
 * (handleAddExercise). Mechanic falls back to isolation, the safe default the
 * page itself uses for untyped rows.
 */
export function setupExerciseToAvailable(ex: SetupExercise): AvailableExercise {
  return {
    id: ex.id,
    name: ex.name,
    primary_muscle: ex.primaryMuscle,
    secondary_muscles: ex.secondaryMuscles,
    movement_pattern: ex.movementPattern ?? undefined,
    mechanic: ex.mechanic ?? 'isolation',
    equipment_required: ex.equipment,
    equipment_class: ex.equipmentClass,
    default_rep_range: ex.defaultRepRange ?? undefined,
    default_rir: ex.defaultRir ?? undefined,
    is_bodyweight: ex.isBodyweight,
    hypertrophy_tier: ex.tier,
    ...(ex.exerciseType ? { exercise_type: ex.exerciseType } : {}),
  } as AvailableExercise;
}
