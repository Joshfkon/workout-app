/**
 * Onboarding's optional "How do you train now?" step, for lifters: sessions
 * a week, current split, and (bulk or cut) the target rate. Pure.
 *
 * Where the answers live:
 * - days and split: users.preferences.trainingDaysPerWeek / currentSplit
 *   (trainingPreferencesPatch);
 * - the rate: the macro calculator's goal (macro_settings.goal), one of its
 *   own GOAL_PERCENT_BW levels, saved with the starter targets
 *   (lib/nutrition/phaseTargets starterTargets).
 *
 * Every answer is optional; an unanswered one writes nothing.
 */
import { GOAL_PERCENT_BW, type Goal as NutritionGoal } from '@/lib/nutrition/macroCalculator';
import type { TrainingGoal } from '@/lib/onboarding/onboardingProgress';
import type { UserPreferences, WeightUnit } from '@/types/schema';

export type CurrentSplit = NonNullable<UserPreferences['currentSplit']>;

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6, 7] as const;

export const SPLIT_OPTIONS: { value: CurrentSplit; label: string }[] = [
  { value: 'full_body', label: 'Full body' },
  { value: 'upper_lower', label: 'Upper / lower' },
  { value: 'ppl', label: 'Push / pull / legs' },
  { value: 'body_part', label: 'Body-part split' },
  { value: 'other', label: 'Other' },
];

export interface TrainingSetupAnswers {
  daysPerWeek: number | null;
  split: CurrentSplit | null;
  /** A macro-calculator goal in the same direction as the training goal. */
  rate: NutritionGoal | null;
}

export const EMPTY_TRAINING_SETUP: TrainingSetupAnswers = { daysPerWeek: null, split: null, rate: null };

const CUT_RATES: NutritionGoal[] = ['slow_cut', 'moderate_cut', 'aggressive_cut'];
const BULK_RATES: NutritionGoal[] = ['slow_bulk', 'moderate_bulk', 'aggressive_bulk'];

export interface RateOption {
  value: NutritionGoal;
  /** "Lean bulk" */
  name: string;
  /** Signed % of body weight a week, e.g. +0.25. */
  percentBW: number;
}

/** The calculator's own rate levels for a direction; none for maintenance. */
export function rateOptionsForGoal(goal: TrainingGoal | null): RateOption[] {
  const ids = goal === 'cut' ? CUT_RATES : goal === 'bulk' ? BULK_RATES : [];
  return ids.map((value) => {
    const def = GOAL_PERCENT_BW[value];
    return { value, name: def.description.replace(/\s*\(.*\)\s*$/, ''), percentBW: def.percentBW };
  });
}

/** "+0.25% of body weight a week" */
export function formatRatePercent(percentBW: number): string {
  const sign = percentBW > 0 ? '+' : percentBW < 0 ? '−' : '';
  return `${sign}${Math.abs(percentBW)}% of body weight a week`;
}

/** "about +0.2 kg a week" at this body weight (null without one). */
export function rateAmountPerWeek(percentBW: number, weightKg: number, units: WeightUnit): string | null {
  if (!(weightKg > 0)) return null;
  const kg = (weightKg * percentBW) / 100;
  const amount = units === 'lb' ? kg * 2.20462 : kg;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `about ${sign}${rounded} ${units} a week`;
}

/** A rate that fits the goal's direction, else null (never a cut rate on a bulk). */
export function rateForGoal(goal: TrainingGoal | null, rate: NutritionGoal | null): NutritionGoal | null {
  if (!rate) return null;
  return rateOptionsForGoal(goal).some((o) => o.value === rate) ? rate : null;
}

/** The users.preferences keys to merge; empty when nothing was answered. */
export function trainingPreferencesPatch(answers: TrainingSetupAnswers): Partial<UserPreferences> {
  const patch: Partial<UserPreferences> = {};
  if (answers.daysPerWeek !== null && (TRAINING_DAY_OPTIONS as readonly number[]).includes(answers.daysPerWeek)) {
    patch.trainingDaysPerWeek = answers.daysPerWeek;
  }
  if (answers.split !== null && SPLIT_OPTIONS.some((o) => o.value === answers.split)) {
    patch.currentSplit = answers.split;
  }
  return patch;
}

/** Saved answers back from users.preferences (re-entering onboarding). */
export function trainingSetupFromPreferences(prefs: Record<string, unknown> | null | undefined): TrainingSetupAnswers {
  const days = prefs?.trainingDaysPerWeek;
  const split = prefs?.currentSplit;
  return {
    daysPerWeek:
      typeof days === 'number' && (TRAINING_DAY_OPTIONS as readonly number[]).includes(days) ? days : null,
    split: SPLIT_OPTIONS.some((o) => o.value === split) ? (split as CurrentSplit) : null,
    rate: null,
  };
}
