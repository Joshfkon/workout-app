/**
 * Daily macro targets for a phase, from saved macro settings. Pure.
 *
 * This is the ONE place that turns macro_settings + a body weight into
 * nutrition_targets numbers for a phase: the phase switch
 * (lib/actions/phase.updateTrainingPhase) and onboarding's starter targets
 * both call it, so the numbers onboarding shows are the numbers Eat gets.
 */
import {
  calculateMacros,
  type ActivityLevel,
  type Goal as NutritionGoal,
  type Peptide,
} from '@/lib/nutrition/macroCalculator';

/** Top-level phase; values match the users.goal DB enum. */
export type Phase = 'bulk' | 'cut' | 'maintenance';

/** The macro_settings columns the calculation reads. */
export interface PhaseTargetSettings {
  height_cm: number;
  age: number;
  sex: 'male' | 'female';
  activity_level: ActivityLevel | null;
  workouts_per_week: number | null;
  avg_workout_minutes: number | null;
  workout_intensity: 'light' | 'moderate' | 'intense' | null;
  goal: NutritionGoal;
  peptide: Peptide | null;
}

export interface PhaseTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const CUT_GOALS: NutritionGoal[] = ['aggressive_cut', 'moderate_cut', 'slow_cut'];
const BULK_GOALS: NutritionGoal[] = ['slow_bulk', 'moderate_bulk', 'aggressive_bulk'];

/**
 * Map a phase onto the macro calculator's 7-level goal, preserving the user's
 * chosen pace when the direction is unchanged (slow_cut stays slow_cut) and
 * defaulting to a sensible pace when switching direction.
 */
export function phaseToNutritionGoal(phase: Phase, current: NutritionGoal | null): NutritionGoal {
  if (phase === 'maintenance') return 'maintain';
  if (phase === 'cut') {
    return current && CUT_GOALS.includes(current) ? current : 'moderate_cut';
  }
  // Lean-bulk default: minimizes fat gain, the right starting point for most lifters
  return current && BULK_GOALS.includes(current) ? current : 'slow_bulk';
}

/**
 * Activity settings a brand-new user starts with: the macro calculator's own
 * defaults (moderate activity, 4 × 60 min moderate workouts, no medication).
 * Saved with the starter targets so Eat's calculator reopens on them.
 */
export const STARTER_ACTIVITY_SETTINGS = {
  activity_level: 'moderate' as ActivityLevel,
  workouts_per_week: 4,
  avg_workout_minutes: 60,
  workout_intensity: 'moderate' as const,
  peptide: 'none' as Peptide,
};

export function targetsFromMacroSettings(weightKg: number, settings: PhaseTargetSettings): PhaseTargets {
  const recommendation = calculateMacros(
    {
      weightKg,
      heightCm: settings.height_cm,
      age: settings.age,
      sex: settings.sex,
    },
    {
      activityLevel: (settings.activity_level ?? 'moderate') as ActivityLevel,
      // ?? not ||: a stated 0 workouts (a food-only tracker) is an answer, not a gap.
      workoutsPerWeek: settings.workouts_per_week ?? 4,
      avgWorkoutMinutes: settings.avg_workout_minutes || 60,
      workoutIntensity: settings.workout_intensity || 'moderate',
    },
    {
      goal: settings.goal,
      peptide: settings.peptide || 'none',
    }
  );
  return {
    calories: recommendation.calories,
    protein: recommendation.protein,
    carbs: recommendation.carbs,
    fat: recommendation.fat,
  };
}

/** Saved settings for starter targets: every activity field filled in. */
export type StarterMacroSettings = Omit<PhaseTargetSettings, keyof typeof STARTER_ACTIVITY_SETTINGS> &
  typeof STARTER_ACTIVITY_SETTINGS;

export interface StarterTargetsInput {
  phase: Phase;
  weightKg: number;
  heightCm: number;
  age: number | null;
  sex: 'male' | 'female' | null;
  /**
   * False for someone who said they don't lift (register's "No, food
   * tracking"): no workouts are counted, so a non-lifter's targets aren't
   * sized for four hour-long sessions a week.
   */
  liftsWeights?: boolean;
}

/**
 * A new user's first targets for their onboarding goal, plus the macro
 * settings to save alongside them. Null when something the calculation
 * needs is missing (no guessing an age).
 */
export function starterTargets(
  input: StarterTargetsInput
): { settings: StarterMacroSettings; targets: PhaseTargets } | null {
  const { phase, weightKg, heightCm, age, sex } = input;
  if (!sex || !(weightKg > 0) || !(heightCm > 0) || !age || !(age >= 13 && age <= 100)) return null;
  const settings: StarterMacroSettings = {
    height_cm: heightCm,
    age,
    sex,
    goal: phaseToNutritionGoal(phase, null),
    ...STARTER_ACTIVITY_SETTINGS,
    ...(input.liftsWeights === false ? { workouts_per_week: 0 } : {}),
  };
  return { settings, targets: targetsFromMacroSettings(weightKg, settings) };
}
