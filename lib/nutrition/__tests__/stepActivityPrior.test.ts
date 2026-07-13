import {
  activityMultiplierFromSteps,
  calculateBMR,
  calculateTDEE,
  STEP_ACTIVITY_MULTIPLIER,
  type UserStats,
  type ActivityConfig,
} from '@/lib/nutrition/macroCalculator';
import { getFormulaTDEE } from '@/lib/nutrition/adaptive-tdee';
import {
  estimateIntervalTDEE,
  type WeighIn,
  type IntakeDay,
} from '@/lib/nutrition/interval-tdee';

const stats: UserStats = {
  weightKg: 81.6, // ~180 lb
  heightCm: 175,
  age: 30,
  sex: 'male',
};

const baseActivity: ActivityConfig = {
  activityLevel: 'sedentary',
  workoutsPerWeek: 0,
  avgWorkoutMinutes: 0,
  workoutIntensity: 'moderate',
};

describe('activityMultiplierFromSteps', () => {
  it('maps the documented anchors with smooth interpolation between them', () => {
    expect(activityMultiplierFromSteps(3_000)).toBe(1.35);
    expect(activityMultiplierFromSteps(5_000)).toBe(1.35);
    expect(activityMultiplierFromSteps(12_000)).toBe(1.7);
    expect(activityMultiplierFromSteps(13_000)).toBe(1.7); // "13k avg -> ~1.7"
    expect(activityMultiplierFromSteps(8_500)).toBeCloseTo(1.525, 5); // midpoint
  });
});

describe('calculateTDEE with a steps-derived prior multiplier', () => {
  it('uses measured steps instead of the self-reported level when present', () => {
    const bmr = calculateBMR(stats);
    const withSteps = calculateTDEE(stats, { ...baseActivity, avgDailySteps: 13_000 });
    expect(withSteps).toBe(Math.round(bmr * 1.7));
    // Ignores the (sedentary) self-report entirely.
    expect(withSteps).toBeGreaterThan(calculateTDEE(stats, baseActivity));
  });

  it('falls back to the static level without step data', () => {
    const bmr = calculateBMR(stats);
    expect(calculateTDEE(stats, baseActivity)).toBe(Math.round(bmr * 1.2));
    expect(calculateTDEE(stats, { ...baseActivity, avgDailySteps: null })).toBe(
      Math.round(bmr * 1.2)
    );
  });

  it('flags the formula estimate as activity-informed for the card subtitle', () => {
    expect(getFormulaTDEE(stats, baseActivity).activityInformed).toBe(false);
    expect(
      getFormulaTDEE(stats, { ...baseActivity, avgDailySteps: 9_000 }).activityInformed
    ).toBe(true);
  });
});

describe('double-count firewall: steps reach the posterior ONLY through the prior', () => {
  // 90 days of complete intake at 2600 kcal and a stable 180 lb weight —
  // high-confidence observed data whose implied TDEE is 2600.
  const DAYS = 90;
  const NOW = '2026-07-13';
  const nowMs = Date.parse(`${NOW}T00:00:00Z`);
  const intakeDays: IntakeDay[] = [];
  const weighIns: WeighIn[] = [];
  for (let i = DAYS; i >= 0; i--) {
    const date = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10);
    intakeDays.push({ date, calories: 2600 });
    if (i % 6 === 0) weighIns.push({ date, weightLb: 180 });
  }

  function posteriorFor(avgDailySteps: number): {
    prior: number;
    posterior: number;
  } {
    const prior = getFormulaTDEE(stats, { ...baseActivity, avgDailySteps });
    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: prior.estimatedTDEE,
      formulaWeightLb: 180,
      currentWeightLb: 180,
      options: { windowDays: DAYS },
    });
    return { prior: prior.estimatedTDEE, posterior: result.estimatedTDEE };
  }

  it('with high-confidence observed data, a steps change moves the posterior <2% while the prior moves >8%', () => {
    const high = posteriorFor(13_000); // multiplier 1.7
    const low = posteriorFor(9_000); // multiplier ~1.55

    const priorShift = Math.abs(high.prior - low.prior) / low.prior;
    const posteriorShift = Math.abs(high.posterior - low.posterior) / low.posterior;

    expect(priorShift).toBeGreaterThan(0.08);
    expect(posteriorShift).toBeLessThan(0.02);

    // And the posterior sits near the observed 2600, not near either prior.
    expect(Math.abs(high.posterior - 2600)).toBeLessThan(150);
  });

  it('on day zero (no observed data) the prior fully drives the estimate', () => {
    const prior = getFormulaTDEE(stats, { ...baseActivity, avgDailySteps: 13_000 });
    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns: [],
      intakeDays: [],
      formulaTDEE: prior.estimatedTDEE,
      formulaWeightLb: 180,
    });
    expect(result.estimatedTDEE).toBe(prior.estimatedTDEE);
    expect(result.source).toBe('formula');
  });
});
