/**
 * "How this is set" for Eat's calorie target: which inputs produced the
 * stored nutrition_targets, in plain words. Pure — the page passes rows in.
 *
 * Only real values: the estimated daily burn and the goal adjustment are
 * shown ONLY when re-running the same calculation the app ran (the macro
 * calculator / weight auto-update, or the adaptive sync with the measured
 * burn) on the saved macro_settings reproduces today's stored calorie
 * target. Anything that can't be reproduced is omitted, never guessed —
 * hand-entered targets get "You entered these yourself" and nothing more
 * than the protein-per-body-weight ratio, which is plain arithmetic on the
 * stored protein target and the latest weigh-in.
 */

import {
  calculateMacros,
  getActivityOptions,
  getGoalOptions,
  type ActivityLevel,
  type Goal,
  type Peptide,
} from '@/lib/nutrition/macroCalculator';

const LB_PER_KG = 2.20462;

/** The macro_settings columns this reads (row as stored; any may be null). */
export interface TargetBasisSettings {
  height_cm?: number | string | null;
  age?: number | string | null;
  sex?: string | null;
  activity_level?: string | null;
  workouts_per_week?: number | null;
  avg_workout_minutes?: number | null;
  workout_intensity?: string | null;
  goal?: string | null;
  target_weight_change_per_week?: number | null;
  peptide?: string | null;
  auto_update_enabled?: boolean | null;
}

export interface TargetBasisInput {
  /** Stored nutrition_targets (base, before any step adjustment). */
  targets: { calories: number | null; protein: number | null } | null;
  /** The user's macro_settings row; null = never used the calculator. */
  settings: TargetBasisSettings | null;
  /** Latest weigh-in, kg. */
  weightKg: number | null;
  /** Latest scan body fat %, when one exists (the calculator uses it). */
  bodyFatPercent?: number | null;
  /** Measured (adaptive) daily burn, only when its confidence is stable. */
  measuredBurnKcal?: number | null;
  /** Weight for the adaptive sync's own calculation, kg (it uses this, not the latest log). */
  measuredWeightKg?: number | null;
  units: 'kg' | 'lb';
}

export interface TargetBasis {
  /** 'calculator' = the numbers reproduce from saved settings; 'manual' = typed in. */
  source: 'calculator' | 'manual' | 'unknown';
  /** Estimated daily burn the target was built on, kcal. */
  dailyBurnKcal?: number;
  /** Where that burn came from. */
  burnFrom?: 'formula' | 'measured';
  /** Goal as the user picked it, e.g. "Moderate cut". */
  goalLabel?: string;
  /** Target minus burn, kcal/day (negative = below burn). */
  adjustmentKcal?: number;
  /** Activity level as picked, e.g. "Moderately active". */
  activityLabel?: string;
  /** Protein target per unit of body weight, in the user's units. */
  proteinPerWeight?: { grams: number; unit: 'kg' | 'lb' };
}

/** Stored target and a fresh calculation agree within this (rounding, a slightly different weigh-in). */
export const TARGET_MATCH_TOLERANCE_KCAL = 30;

const GOALS = new Set<string>(getGoalOptions().map((o) => o.value));
const ACTIVITIES = new Set<string>(getActivityOptions().map((o) => o.value));

function sentenceCase(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

function goalLabelOf(goal: string | null | undefined): string | undefined {
  if (!goal || !GOALS.has(goal)) return undefined;
  const option = getGoalOptions().find((o) => o.value === goal);
  return option ? sentenceCase(option.label) : undefined;
}

function activityLabelOf(level: string | null | undefined): string | undefined {
  if (!level || !ACTIVITIES.has(level)) return undefined;
  const option = getActivityOptions().find((o) => o.value === level);
  return option ? sentenceCase(option.label) : undefined;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function proteinRatio(
  protein: number | null | undefined,
  weightKg: number | null,
  units: 'kg' | 'lb'
): TargetBasis['proteinPerWeight'] {
  if (!protein || protein <= 0 || !weightKg || weightKg <= 0) return undefined;
  const bodyWeight = units === 'lb' ? weightKg * LB_PER_KG : weightKg;
  return { grams: Math.round((protein / bodyWeight) * 10) / 10, unit: units };
}

/** Re-run the app's own calculation on the saved settings; null when a required input is missing. */
function recompute(
  settings: TargetBasisSettings,
  weightKg: number,
  bodyFatPercent: number | null | undefined,
  overrideBurn?: number
) {
  const heightCm = num(settings.height_cm);
  const age = num(settings.age);
  const sex = settings.sex === 'male' || settings.sex === 'female' ? settings.sex : null;
  const goal = settings.goal && GOALS.has(settings.goal) ? (settings.goal as Goal) : null;
  if (!heightCm || !age || !sex || !goal) return null;
  const intensity = settings.workout_intensity;
  return calculateMacros(
    { weightKg, heightCm, age, sex, bodyFatPercent: bodyFatPercent ?? undefined },
    {
      activityLevel: (settings.activity_level && ACTIVITIES.has(settings.activity_level)
        ? settings.activity_level
        : 'moderate') as ActivityLevel,
      workoutsPerWeek: settings.workouts_per_week ?? 4,
      avgWorkoutMinutes: settings.avg_workout_minutes || 60,
      workoutIntensity:
        intensity === 'light' || intensity === 'moderate' || intensity === 'intense' ? intensity : 'moderate',
    },
    {
      goal,
      targetWeightChangePerWeek: settings.target_weight_change_per_week ?? undefined,
      peptide: (settings.peptide || 'none') as Peptide,
    },
    overrideBurn
  );
}

export function describeTargetBasis(input: TargetBasisInput): TargetBasis | null {
  const { targets, settings, weightKg, units } = input;
  if (!targets?.calories) return null;
  const proteinPerWeight = proteinRatio(targets.protein, weightKg, units);

  // No calculator settings, or automatic updates switched off — which is
  // exactly what saving hand-entered targets does.
  if (!settings || settings.auto_update_enabled === false) {
    return { source: 'manual', proteinPerWeight };
  }

  const goalLabel = goalLabelOf(settings.goal);
  const activityLabel = activityLabelOf(settings.activity_level);
  const matches = (calories: number) =>
    Math.abs(calories - (targets.calories as number)) <= TARGET_MATCH_TOLERANCE_KCAL;

  if (weightKg && weightKg > 0) {
    const formula = recompute(settings, weightKg, input.bodyFatPercent);
    if (formula && matches(formula.calories)) {
      return {
        source: 'calculator',
        dailyBurnKcal: formula.tdee,
        burnFrom: 'formula',
        goalLabel,
        adjustmentKcal: formula.calories - formula.tdee,
        activityLabel,
        proteinPerWeight,
      };
    }
  }

  const measuredWeight = input.measuredWeightKg ?? weightKg;
  if (input.measuredBurnKcal && input.measuredBurnKcal > 0 && measuredWeight && measuredWeight > 0) {
    const measured = recompute(settings, measuredWeight, input.bodyFatPercent, input.measuredBurnKcal);
    if (measured && matches(measured.calories)) {
      return {
        source: 'calculator',
        dailyBurnKcal: measured.tdee,
        burnFrom: 'measured',
        goalLabel,
        adjustmentKcal: measured.calories - measured.tdee,
        proteinPerWeight,
      };
    }
  }

  // Settings exist but today's target doesn't reproduce from them (weight
  // changed since, or edited elsewhere): show the saved choices only.
  return { source: 'unknown', goalLabel, activityLabel, proteinPerWeight };
}

/** Lines for the disclosure, in display order. */
export function targetBasisLines(basis: TargetBasis): string[] {
  const lines: string[] = [];
  if (basis.source === 'manual') lines.push('You entered these targets yourself.');
  if (basis.dailyBurnKcal) {
    const from =
      basis.burnFrom === 'measured'
        ? 'measured from your logged food and weight trend'
        : 'from your weight, height, age and activity';
    lines.push(`Estimated daily burn: ~${basis.dailyBurnKcal.toLocaleString('en-US')} kcal (${from})`);
  }
  if (basis.activityLabel && basis.burnFrom !== 'measured') {
    lines.push(`Activity: ${basis.activityLabel}`);
  }
  if (basis.goalLabel) {
    const adj = basis.adjustmentKcal;
    const adjText =
      adj === undefined
        ? ''
        : Math.abs(adj) < 25
          ? ' (about your daily burn)'
          : ` (${adj < 0 ? '−' : '+'}${Math.abs(Math.round(adj)).toLocaleString('en-US')} kcal a day)`;
    lines.push(`Goal: ${basis.goalLabel}${adjText}`);
  }
  if (basis.proteinPerWeight) {
    lines.push(`Protein: ${basis.proteinPerWeight.grams.toFixed(1)} g per ${basis.proteinPerWeight.unit} of body weight`);
  }
  return lines;
}
