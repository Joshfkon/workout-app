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

const LB_PER_KG = 2.20462;

export type CurrentSplit = NonNullable<UserPreferences['currentSplit']>;

export const TRAINING_DAY_OPTIONS = [2, 3, 4, 5, 6, 7] as const;

/** Each split with what its training days look like, in plain words (UX panel round 21: jargon). */
export const SPLIT_OPTIONS: { value: CurrentSplit; label: string; description: string }[] = [
  { value: 'full_body', label: 'Full body', description: 'Every workout trains your whole body.' },
  { value: 'upper_lower', label: 'Upper / lower', description: 'Upper-body days and leg days, taking turns.' },
  {
    value: 'ppl',
    label: 'Push / pull / legs',
    description: 'Chest, shoulders and triceps one day; back and biceps the next; then legs.',
  },
  { value: 'body_part', label: 'Body-part split', description: 'One or two muscles a day, like chest day or back day.' },
  { value: 'other', label: 'Other', description: 'Something else, or you’re not sure.' },
];

/**
 * What Skip leaves the first plan on: the builder's own defaults with no
 * answers (4 days a week; recommendSplit gives Upper/Lower for 4 days at
 * every experience level and goal — pinned by a test).
 */
export const SKIP_DEFAULT_DAYS = 4;
export const SKIP_DEFAULT_SPLIT_LABEL = 'upper/lower';

export interface TrainingSetupAnswers {
  daysPerWeek: number | null;
  split: CurrentSplit | null;
  /** A macro-calculator goal in the same direction as the training goal. */
  rate: NutritionGoal | null;
  /**
   * A pace typed in the user's unit, stored in kg a week, signed (+ gain,
   * − loss). Replaces `rate` while set; saved as
   * macro_settings.target_weight_change_per_week.
   */
  weeklyChangeKg: number | null;
}

export const EMPTY_TRAINING_SETUP: TrainingSetupAnswers = {
  daysPerWeek: null,
  split: null,
  rate: null,
  weeklyChangeKg: null,
};

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
  const amount = units === 'lb' ? kg * LB_PER_KG : kg;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `about ${sign}${rounded} ${units} a week`;
}

/** Largest typed pace, as % of body weight a week (the calculator's steepest level). */
export const MAX_CUSTOM_RATE_PERCENT = 1;

/** "0.31% of body weight a week" for a kg-a-week pace (null without a weight). */
export function percentOfBodyWeight(weeklyChangeKg: number, weightKg: number): number | null {
  if (!(weightKg > 0)) return null;
  return Math.round((Math.abs(weeklyChangeKg) / weightKg) * 10000) / 100;
}

export type CustomRateResult =
  | { ok: true; weeklyChangeKg: number; percentBW: number }
  | { ok: false; error: string | null };

/**
 * A pace typed in the user's unit, as an unsigned amount a week: the goal
 * gives the sign. Empty = no custom pace (error null). Pure.
 */
export function parseCustomRate(
  text: string,
  units: WeightUnit,
  goal: TrainingGoal | null,
  weightKg: number
): CustomRateResult {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return { ok: false, error: null };
  if (goal !== 'bulk' && goal !== 'cut') return { ok: false, error: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: `Enter an amount in ${units} a week, like ${units === 'lb' ? '0.5' : '0.25'}.` };
  }
  const kg = units === 'lb' ? value / LB_PER_KG : value;
  if (weightKg > 0) {
    const pct = (kg / weightKg) * 100;
    if (pct > MAX_CUSTOM_RATE_PERCENT) {
      const maxAmount = (weightKg * MAX_CUSTOM_RATE_PERCENT) / 100 * (units === 'lb' ? LB_PER_KG : 1);
      return {
        ok: false,
        error: `That's over ${MAX_CUSTOM_RATE_PERCENT}% of your body weight a week. Try ${Math.floor(maxAmount * 100) / 100} ${units} or less.`,
      };
    }
  }
  const weeklyChangeKg = Math.round((goal === 'cut' ? -kg : kg) * 1000) / 1000;
  return { ok: true, weeklyChangeKg, percentBW: percentOfBodyWeight(weeklyChangeKg, weightKg) ?? 0 };
}

/**
 * The calculator level closest to a typed pace, saved as macro_settings.goal
 * so the pace's name (and Eat's goal picker) still reads right.
 */
export function nearestRateForChange(
  goal: TrainingGoal | null,
  weeklyChangeKg: number,
  weightKg: number
): NutritionGoal | null {
  const options = rateOptionsForGoal(goal);
  if (options.length === 0 || !(weightKg > 0)) return null;
  const pct = (weeklyChangeKg / weightKg) * 100;
  return options.reduce((best, o) =>
    Math.abs(o.percentBW - pct) < Math.abs(best.percentBW - pct) ? o : best
  ).value;
}

/** A typed pace that runs the goal's way, else null (switching goal drops it). */
export function customChangeForGoal(goal: TrainingGoal | null, weeklyChangeKg: number | null): number | null {
  if (weeklyChangeKg == null || weeklyChangeKg === 0) return null;
  if (goal === 'bulk') return weeklyChangeKg > 0 ? weeklyChangeKg : null;
  if (goal === 'cut') return weeklyChangeKg < 0 ? weeklyChangeKg : null;
  return null;
}

/** "+0.25 kg a week" / "−0.5 lb a week" in the user's unit. */
export function formatWeeklyChange(weeklyChangeKg: number, units: WeightUnit): string {
  const amount = units === 'lb' ? weeklyChangeKg * LB_PER_KG : weeklyChangeKg;
  const rounded = Math.round(Math.abs(amount) * 100) / 100;
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return `${sign}${rounded} ${units} a week`;
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
    weeklyChangeKg: null,
  };
}
