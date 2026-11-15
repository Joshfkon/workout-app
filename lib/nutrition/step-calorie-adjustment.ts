/**
 * Step-adjusted daily calorie target ("activity_adjusted" mode).
 *
 * DOUBLE-COUNT FIREWALL
 * ---------------------
 * The base calorie target is built from the adaptive TDEE, which is observed
 * from intake vs. weight change over a trailing window (plus a formula prior
 * that already reads the trailing step average). Whatever the user's AVERAGE
 * activity was over that window is therefore already inside the base target.
 *
 * So this module never adds "calories burned by steps". It only moves the
 * target by the DEVIATION of a day's steps from the user's own trailing
 * average:
 *
 *     adjustment = (daySteps − expectedStepsSoFar) × kcalPerStep, capped ±cap
 *
 * Over the baseline window the deviations sum to ~zero by construction (the
 * baseline IS their mean), so the average daily target — and therefore the
 * planned deficit/surplus — is unchanged. Active days get a little more, quiet
 * days a little less. Logged workouts are not added here either.
 *
 * For "today" the comparison uses the user's usual PACE (average × the share
 * of the waking day elapsed) rather than the full-day average, so the target
 * isn't cut every morning just because the day has barely started. Past days
 * are compared to the full average.
 */

/** Trailing window (days, excluding the target day) for the step baseline. */
export const STEP_BASELINE_WINDOW_DAYS = 28;
/** Minimum days with step data before any adjustment is made. */
export const STEP_BASELINE_MIN_DAYS = 7;
/**
 * NET walking cost above resting, kcal per kg body weight per step
 * (~0.5 kcal/kg/km at ~1,300 steps/km ≈ 0.0004; we use 0.0005, i.e. ~0.04
 * kcal/step at 80 kg, matching the enhanced-TDEE step-rate prior).
 */
export const NET_KCAL_PER_KG_PER_STEP = 0.0005;
export const DEFAULT_KCAL_PER_STEP = 0.04;
/** Adjustments smaller than this are reported as "on your usual pace". */
export const MIN_REPORTED_ADJUSTMENT = 25;
/** Waking-day window used to pro-rate the expected steps for today. */
export const PACE_DAY_START_MIN = 7 * 60;
export const PACE_DAY_END_MIN = 22 * 60;

export interface StepDay {
  date: string; // YYYY-MM-DD (local)
  steps: number;
}

export interface StepBaseline {
  avgSteps: number;
  days: number;
}

/**
 * Mean steps over the trailing window BEFORE `date` (the target day itself is
 * excluded so it can't pull its own baseline). Days without step data
 * (missing or 0 — a sync gap, not a measured zero) are ignored.
 */
export function computeStepBaseline(
  history: StepDay[],
  date: string,
  windowDays: number = STEP_BASELINE_WINDOW_DAYS,
  minDays: number = STEP_BASELINE_MIN_DAYS
): StepBaseline | null {
  const cutoff = addDays(date, -windowDays);
  const days = history.filter(
    (d) => d.date < date && d.date >= cutoff && Number.isFinite(d.steps) && d.steps > 0
  );
  if (days.length < minDays) return null;
  const avgSteps = days.reduce((s, d) => s + d.steps, 0) / days.length;
  return { avgSteps, days: days.length };
}

/** Net kcal per step for a body weight; falls back to a typical value. */
export function kcalPerStep(weightKg: number | null | undefined): number {
  if (!weightKg || !Number.isFinite(weightKg) || weightKg <= 0) return DEFAULT_KCAL_PER_STEP;
  return Math.min(0.07, Math.max(0.02, weightKg * NET_KCAL_PER_KG_PER_STEP));
}

/** Share (0–1) of the waking day elapsed at a local minute-of-day. */
export function dayFractionElapsed(minutesOfDay: number): number {
  if (minutesOfDay <= PACE_DAY_START_MIN) return 0;
  if (minutesOfDay >= PACE_DAY_END_MIN) return 1;
  return (minutesOfDay - PACE_DAY_START_MIN) / (PACE_DAY_END_MIN - PACE_DAY_START_MIN);
}

export interface StepAdjustmentInput {
  baseCalories: number;
  /** Steps recorded for the target day (null = no data synced for it). */
  daySteps: number | null;
  baseline: StepBaseline | null;
  weightKg: number | null;
  maxDailyAdjustment: number;
  /** True when the target day is today (use pace, not the full-day average). */
  isToday: boolean;
  /** Local minute-of-day "now"; only used when isToday. */
  nowMinutes?: number;
}

export interface StepAdjustmentResult {
  baseCalories: number;
  adjustedCalories: number;
  /** Signed kcal applied to the target (0 when within noise or no data). */
  adjustment: number;
  /** Steps vs. expected (signed), rounded. Null when not computable. */
  stepDelta: number | null;
  expectedSteps: number | null;
  daySteps: number | null;
  capped: boolean;
  reason: string;
}

export function calculateStepAdjustedTarget(input: StepAdjustmentInput): StepAdjustmentResult {
  const { baseCalories, daySteps, baseline, weightKg, isToday } = input;
  const cap = Math.max(0, input.maxDailyAdjustment || 0);

  const none = (reason: string, extra: Partial<StepAdjustmentResult> = {}): StepAdjustmentResult => ({
    baseCalories,
    adjustedCalories: baseCalories,
    adjustment: 0,
    stepDelta: null,
    expectedSteps: null,
    daySteps,
    capped: false,
    reason,
    ...extra,
  });

  if (!baseline) {
    return none(`Need ${STEP_BASELINE_MIN_DAYS}+ days of step data to adjust your target`);
  }
  if (daySteps == null || !Number.isFinite(daySteps) || daySteps <= 0) {
    return none(isToday ? 'No steps synced yet today' : 'No step data for this day');
  }

  const fraction = isToday ? dayFractionElapsed(input.nowMinutes ?? PACE_DAY_END_MIN) : 1;
  const expectedSteps = Math.round(baseline.avgSteps * fraction);
  const stepDelta = Math.round(daySteps - expectedSteps);
  const raw = stepDelta * kcalPerStep(weightKg);
  const clamped = Math.max(-cap, Math.min(cap, raw));
  const capped = Math.abs(raw) > cap;
  // Round to 10 kcal so the target doesn't twitch with every sync.
  let adjustment = Math.round(clamped / 10) * 10;
  if (Math.abs(adjustment) < MIN_REPORTED_ADJUSTMENT) adjustment = 0;

  const deltaText = `${Math.abs(stepDelta).toLocaleString('en-US')} steps`;
  const vs = isToday && fraction < 1 ? 'your usual pace' : 'your average';
  let reason: string;
  if (adjustment === 0) {
    reason = `Steps on par with ${vs}`;
  } else if (adjustment > 0) {
    reason = `+${adjustment} kcal: ${deltaText} above ${vs}${capped ? ' (capped)' : ''}`;
  } else {
    reason = `${adjustment} kcal: ${deltaText} below ${vs}${capped ? ' (capped)' : ''}`;
  }

  return {
    baseCalories,
    adjustedCalories: baseCalories + adjustment,
    adjustment,
    stepDelta,
    expectedSteps,
    daySteps,
    capped,
    reason,
  };
}

/**
 * Apply a calorie adjustment to a macro target set. Protein and fat are held;
 * the calorie change goes to carbs (4 kcal/g), floored at 0 g.
 */
export function applyAdjustmentToMacros<
  T extends { calories: number | null; carbs: number | null }
>(targets: T, adjustment: number): T {
  if (!adjustment || targets.calories == null) return targets;
  if (targets.carbs == null) {
    return { ...targets, calories: Math.round(targets.calories + adjustment) };
  }
  const carbs = Math.max(0, Math.round(targets.carbs + adjustment / 4));
  const realised = (carbs - targets.carbs) * 4;
  return { ...targets, calories: Math.round(targets.calories + realised), carbs };
}

function addDays(date: string, delta: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Only the explicit opt-in mode moves the target. 'fixed' (the default) and
 * the legacy, never-implemented 'deficit_locked' keep the target unchanged,
 * so no existing user's numbers move unless they choose step adjustment.
 */
export function isStepAdjustmentEnabled(mode: string | null | undefined): boolean {
  return mode === 'activity_adjusted';
}
