/**
 * Daily macro targets for a phase, from saved macro settings. Pure.
 *
 * This is the ONE place that turns macro_settings + a body weight into
 * nutrition_targets numbers for a phase: the phase switch
 * (lib/actions/phase.updateTrainingPhase) and onboarding's starter targets
 * both call it, so the numbers onboarding shows are the numbers Eat gets.
 */
import {
  baseProteinPerLbLeanMass,
  calculateMacros,
  calculateTDEE,
  GOAL_PERCENT_BW,
  getLeanMassLbs,
  getLossRateCap,
  kgToLbs,
  MIN_CALORIE_FLOORS,
  type ActivityLevel,
  type Goal as NutritionGoal,
  type MacroRecommendation,
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
 * Activity settings a brand-new user starts with (onboarding doesn't ask):
 * lightly active daily life, 4 × 60 min moderate workouts, no medication.
 * Saved with the starter targets so Eat's calculator reopens on them.
 *
 * activity_level is daily life OUTSIDE workouts: calculateTDEE adds the
 * workouts on top. It was 'moderate' (×1.55, the classic "exercise 3–5 days
 * a week" level) PLUS four workouts, which counted training twice: an 80 kg,
 * 11% body fat man cutting got 2,882 kcal, ~270 under a 3,149 burn (UX panel
 * round 21). 'light' (×1.375) matches the app's own steps model for a
 * desk-job day (STEP_ACTIVITY_MULTIPLIER floors at ×1.35).
 */
export const STARTER_ACTIVITY_SETTINGS = {
  activity_level: 'light' as ActivityLevel,
  workouts_per_week: 4,
  avg_workout_minutes: 60,
  workout_intensity: 'moderate' as const,
  peptide: 'none' as Peptide,
};

/**
 * Inputs the saved settings don't carry: a body fat % (the calculator then
 * sizes protein to measured lean mass, as Eat's calculator does with one) and
 * a kg-a-week pace (macro_settings.target_weight_change_per_week, which Eat
 * honours too). Omitted = the calculator's defaults.
 */
export interface TargetExtras {
  bodyFatPercent?: number | null;
  targetWeightChangePerWeekKg?: number | null;
}

export function targetsFromMacroSettings(
  weightKg: number,
  settings: PhaseTargetSettings,
  extras: TargetExtras = {}
): PhaseTargets {
  const recommendation = recommendationFromMacroSettings(weightKg, settings, extras);
  return {
    calories: recommendation.calories,
    protein: recommendation.protein,
    carbs: recommendation.carbs,
    fat: recommendation.fat,
  };
}

/** The activity block calculateMacros gets from saved settings. */
function activityFromSettings(settings: PhaseTargetSettings) {
  return {
    activityLevel: (settings.activity_level ?? 'moderate') as ActivityLevel,
    // ?? not ||: a stated 0 workouts (a food-only tracker) is an answer, not a gap.
    workoutsPerWeek: settings.workouts_per_week ?? 4,
    avgWorkoutMinutes: settings.avg_workout_minutes || 60,
    workoutIntensity: settings.workout_intensity || 'moderate',
  };
}

/** The calculator's full answer for saved settings (burn, deficit, …), not just the four targets. */
function recommendationFromMacroSettings(
  weightKg: number,
  settings: PhaseTargetSettings,
  extras: TargetExtras = {}
): MacroRecommendation {
  const bodyFat = extras.bodyFatPercent;
  return calculateMacros(
    {
      weightKg,
      heightCm: settings.height_cm,
      age: settings.age,
      sex: settings.sex,
      ...(bodyFat != null && bodyFat > 0 && bodyFat < 100 ? { bodyFatPercent: bodyFat } : {}),
    },
    activityFromSettings(settings),
    {
      goal: settings.goal,
      ...(extras.targetWeightChangePerWeekKg != null
        ? { targetWeightChangePerWeek: extras.targetWeightChangePerWeekKg }
        : {}),
      peptide: settings.peptide || 'none',
    }
  );
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
  /**
   * The pace picked in onboarding's training step (a macro-calculator goal).
   * Kept only when it runs the same direction as `phase`; otherwise the
   * phase's default pace is used (phaseToNutritionGoal).
   */
  nutritionGoal?: NutritionGoal | null;
  /** Sessions a week the lifter said they train (2–7); replaces the starter 4. */
  workoutsPerWeek?: number | null;
  /**
   * The user's own body fat % (DEXA, typed, or picked from the visual guide;
   * never a skipped-question placeholder). Protein then follows their lean
   * mass, the calculator's own rule, instead of an assumed 20% / 28%.
   */
  bodyFatPercent?: number | null;
  /**
   * A pace typed in kg a week (signed: + gain, − loss). Saved as
   * macro_settings.target_weight_change_per_week; ignored when its sign
   * doesn't match the phase.
   */
  weeklyChangeKg?: number | null;
  /** Protein the user set by hand (g a day); calories stay, carbs absorb the change. */
  proteinG?: number | null;
  /** Calories the user set by hand (kcal a day); protein and fat stay, carbs absorb the change. */
  caloriesKcal?: number | null;
}

/**
 * How the calorie figure was reached, for the targets card: estimated
 * maintenance (resting burn × daily activity + workouts), then the change
 * for the goal's pace. All numbers come from the calculator's own run.
 */
export interface StarterCalorieBasis {
  /** Estimated maintenance (the calculator's TDEE), kcal a day. */
  maintenanceKcal: number;
  /** Resting burn (BMR), kcal a day. */
  restingKcal: number;
  /** True when the resting burn came from lean mass (body fat given). */
  restingFromLeanMass: boolean;
  /** The daily-activity level used (outside workouts). */
  activityLevel: ActivityLevel;
  workoutsPerWeek: number;
  /** Workouts' share of maintenance, averaged over the week, kcal a day. */
  workoutKcalPerDay: number;
  /** Calculated target minus maintenance (negative = deficit), kcal a day. */
  adjustmentKcal: number;
  /** The pace the adjustment gives, kg a week (signed). */
  weeklyChangeKg: number;
  /** The pace's own % of body weight a week (signed), before any cap. */
  requestedPercentBW: number;
  /** Set when leanness capped a cut: the cap (% BW a week) and the body fat it came from. */
  lossCap: { percentBW: number; bodyFatPercent: number } | null;
  /** The user's own number replaced the calculated one. */
  setByHand: boolean;
  /** What the calculator gave before any hand edit. */
  calculated: number;
}

/** Highest hand-set calories, kcal a day (the lowest is the calculator's floor: calorieEditMin). */
export const CALORIE_EDIT_MAX = 6000;

/** Lowest hand-set calories for this sex (the calculator's own floor). */
export function calorieEditMin(sex: 'male' | 'female'): number {
  return MIN_CALORIE_FLOORS[sex];
}

/**
 * Swap in hand-set calories: protein and fat are kept, carbs take the
 * difference. When carbs would go below 0, fat gives the rest (never below 0).
 */
export function withCalorieOverride(targets: PhaseTargets, caloriesKcal: number): PhaseTargets {
  const calories = Math.round(caloriesKcal);
  const left = calories - targets.protein * 4 - targets.fat * 9;
  if (left >= 0) {
    return { ...targets, carbs: Math.round(left / 4), calories };
  }
  const fat = Math.max(0, Math.round((calories - targets.protein * 4) / 9));
  return { ...targets, carbs: 0, fat, calories };
}

/** How the protein figure was reached, for the onboarding explanation. */
export interface StarterProteinBasis {
  /** g per lb of lean mass the calculator used (1.0, or 1.1 on a cut). */
  perLbLeanMass: number;
  leanMassKg: number;
  /** True when lean mass came from the user's body fat, false when estimated. */
  fromBodyFat: boolean;
  /** g per kg of BODY weight, the figure lifters usually compare. */
  perKgBodyWeight: number;
  /** The user's own number replaced the calculated one. */
  setByHand: boolean;
  /** What the calculator gave before any hand edit. */
  calculated: number;
}

/** Allowed hand-set protein, g a day. */
export const PROTEIN_EDIT_RANGE = { min: 40, max: 400 } as const;

/**
 * Swap in a hand-set protein figure: calories are kept, carbs take the
 * difference (never below 0, which is the only case calories move).
 */
export function withProteinOverride(targets: PhaseTargets, proteinG: number): PhaseTargets {
  const protein = Math.round(proteinG);
  const carbs = Math.max(0, targets.carbs - (protein - targets.protein));
  return {
    ...targets,
    protein,
    carbs,
    calories: protein * 4 + carbs * 4 + targets.fat * 9,
  };
}

/** The phase's sign: + bulk, − cut, none for maintenance. */
function paceMatchesPhase(phase: Phase, kg: number | null | undefined): kg is number {
  if (kg == null || !Number.isFinite(kg) || kg === 0) return false;
  return phase === 'bulk' ? kg > 0 : phase === 'cut' ? kg < 0 : false;
}

/**
 * A new user's first targets for their onboarding goal, plus the macro
 * settings to save alongside them. Null when something the calculation
 * needs is missing (no guessing an age).
 */
export function starterTargets(input: StarterTargetsInput): {
  settings: StarterMacroSettings;
  targets: PhaseTargets;
  /** kg a week to save as macro_settings.target_weight_change_per_week (null = the pace's default). */
  targetWeightChangePerWeek: number | null;
  protein: StarterProteinBasis;
  calories: StarterCalorieBasis;
} | null {
  const { phase, weightKg, heightCm, age, sex } = input;
  if (!sex || !(weightKg > 0) || !(heightCm > 0) || !age || !(age >= 13 && age <= 100)) return null;
  const settings: StarterMacroSettings = {
    height_cm: heightCm,
    age,
    sex,
    goal: phaseToNutritionGoal(phase, input.nutritionGoal ?? null),
    ...STARTER_ACTIVITY_SETTINGS,
    ...(input.liftsWeights !== false && input.workoutsPerWeek && input.workoutsPerWeek >= 1 && input.workoutsPerWeek <= 7
      ? { workouts_per_week: Math.round(input.workoutsPerWeek) }
      : {}),
    ...(input.liftsWeights === false ? { workouts_per_week: 0 } : {}),
  };
  const bodyFat =
    input.bodyFatPercent != null && input.bodyFatPercent > 0 && input.bodyFatPercent < 100
      ? input.bodyFatPercent
      : null;
  const weeklyChangeKg = paceMatchesPhase(phase, input.weeklyChangeKg) ? input.weeklyChangeKg : null;
  const recommendation = recommendationFromMacroSettings(weightKg, settings, {
    bodyFatPercent: bodyFat,
    targetWeightChangePerWeekKg: weeklyChangeKg,
  });
  const calculated: PhaseTargets = {
    calories: recommendation.calories,
    protein: recommendation.protein,
    carbs: recommendation.carbs,
    fat: recommendation.fat,
  };
  const byHand =
    input.proteinG != null &&
    input.proteinG >= PROTEIN_EDIT_RANGE.min &&
    input.proteinG <= PROTEIN_EDIT_RANGE.max &&
    Math.round(input.proteinG) !== calculated.protein;
  const withProtein = byHand ? withProteinOverride(calculated, input.proteinG as number) : calculated;
  const caloriesByHand =
    input.caloriesKcal != null &&
    input.caloriesKcal >= calorieEditMin(sex) &&
    input.caloriesKcal <= CALORIE_EDIT_MAX &&
    Math.round(input.caloriesKcal) !== withProtein.calories;
  const targets = caloriesByHand ? withCalorieOverride(withProtein, input.caloriesKcal as number) : withProtein;

  // The calorie breakdown, from the same run: maintenance = resting burn ×
  // daily activity + workouts; the workouts' share is maintenance minus the
  // same burn with no workouts.
  const stats = { weightKg, heightCm, age, sex, ...(bodyFat !== null ? { bodyFatPercent: bodyFat } : {}) };
  const activity = activityFromSettings(settings);
  const withoutWorkouts = calculateTDEE(stats, { ...activity, workoutsPerWeek: 0 });
  const requestedPercentBW =
    weeklyChangeKg !== null ? (weeklyChangeKg / weightKg) * 100 : GOAL_PERCENT_BW[settings.goal].percentBW;
  const capPercent = getLossRateCap(bodyFat ?? undefined);
  const lossCap =
    requestedPercentBW < 0 && Math.abs(requestedPercentBW) > capPercent + 1e-9
      ? { percentBW: capPercent, bodyFatPercent: bodyFat ?? 0 }
      : null;
  const leanMassLbs = getLeanMassLbs({ weightKg, sex, bodyFatPercent: bodyFat ?? undefined });
  return {
    settings,
    targets,
    targetWeightChangePerWeek: weeklyChangeKg,
    protein: {
      perLbLeanMass: baseProteinPerLbLeanMass(settings.goal),
      leanMassKg: leanMassLbs / kgToLbs(1),
      fromBodyFat: bodyFat !== null,
      perKgBodyWeight: targets.protein / weightKg,
      setByHand: byHand,
      calculated: calculated.protein,
    },
    calories: {
      maintenanceKcal: recommendation.tdee,
      restingKcal: Math.round(recommendation.bmr),
      restingFromLeanMass: bodyFat !== null,
      activityLevel: activity.activityLevel,
      workoutsPerWeek: activity.workoutsPerWeek,
      workoutKcalPerDay: Math.max(0, recommendation.tdee - withoutWorkouts),
      adjustmentKcal: recommendation.calories - recommendation.tdee,
      weeklyChangeKg: recommendation.weeklyChangeKg,
      requestedPercentBW,
      lossCap,
      setByHand: caloriesByHand,
      calculated: calculated.calories,
    },
  };
}
