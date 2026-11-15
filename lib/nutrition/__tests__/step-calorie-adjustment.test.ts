import {
  applyAdjustmentToMacros,
  calculateStepAdjustedTarget,
  computeStepBaseline,
  dayFractionElapsed,
  isStepAdjustmentEnabled,
  kcalPerStep,
  PACE_DAY_END_MIN,
  PACE_DAY_START_MIN,
  type StepDay,
} from '../step-calorie-adjustment';

function days(start: string, steps: number[]): StepDay[] {
  return steps.map((s, i) => {
    const d = new Date(start + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), steps: s };
  });
}

const base = { baseCalories: 2200, weightKg: 80, maxDailyAdjustment: 300 };

describe('isStepAdjustmentEnabled (setting gate)', () => {
  it('is off by default and for fixed / legacy deficit_locked', () => {
    expect(isStepAdjustmentEnabled(undefined)).toBe(false);
    expect(isStepAdjustmentEnabled(null)).toBe(false);
    expect(isStepAdjustmentEnabled('fixed')).toBe(false);
    expect(isStepAdjustmentEnabled('deficit_locked')).toBe(false);
  });
  it('is on only for activity_adjusted', () => {
    expect(isStepAdjustmentEnabled('activity_adjusted')).toBe(true);
  });
});

describe('computeStepBaseline', () => {
  it('averages the trailing window, excluding the target day and zero/missing days', () => {
    const history = [
      ...days('2026-11-01', [8000, 0, 10000, 6000, 8000, 9000, 7000, 8000]),
      { date: '2026-11-09', steps: 30000 }, // the target day itself
    ];
    const b = computeStepBaseline(history, '2026-11-09');
    expect(b).not.toBeNull();
    expect(b!.days).toBe(7);
    expect(b!.avgSteps).toBeCloseTo((8000 + 10000 + 6000 + 8000 + 9000 + 7000 + 8000) / 7);
  });

  it('ignores days older than the window', () => {
    const history = [...days('2026-09-01', [50000, 50000]), ...days('2026-11-01', Array(7).fill(5000))];
    expect(computeStepBaseline(history, '2026-11-08')!.avgSteps).toBe(5000);
  });

  it('needs at least 7 days of data', () => {
    expect(computeStepBaseline(days('2026-11-01', Array(6).fill(8000)), '2026-11-07')).toBeNull();
  });
});

describe('kcalPerStep', () => {
  it('scales net cost with body weight and clamps', () => {
    expect(kcalPerStep(80)).toBeCloseTo(0.04);
    expect(kcalPerStep(60)).toBeCloseTo(0.03);
    expect(kcalPerStep(20)).toBe(0.02);
    expect(kcalPerStep(300)).toBe(0.07);
    expect(kcalPerStep(null)).toBe(0.04);
  });
});

describe('dayFractionElapsed', () => {
  it('is 0 before the waking day, 1 after, linear between', () => {
    expect(dayFractionElapsed(PACE_DAY_START_MIN - 60)).toBe(0);
    expect(dayFractionElapsed(PACE_DAY_END_MIN + 60)).toBe(1);
    expect(dayFractionElapsed((PACE_DAY_START_MIN + PACE_DAY_END_MIN) / 2)).toBeCloseTo(0.5);
  });
});

describe('calculateStepAdjustedTarget', () => {
  const baseline = { avgSteps: 8000, days: 14 };

  it('moves the target only by the deviation from the average (completed day)', () => {
    const r = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 11000, isToday: false });
    // +3000 steps × 0.04 kcal = +120
    expect(r.adjustment).toBe(120);
    expect(r.adjustedCalories).toBe(2320);
    expect(r.reason).toMatch(/\+120 kcal: 3,000 steps above your average/);
  });

  it('a day exactly at the average leaves the target unchanged (no double count)', () => {
    const r = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 8000, isToday: false });
    expect(r.adjustment).toBe(0);
    expect(r.adjustedCalories).toBe(2200);
    expect(r.reason).toMatch(/on par/);
  });

  it('lowers the target on a quiet day', () => {
    const r = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 3000, isToday: false });
    expect(r.adjustment).toBe(-200);
    expect(r.reason).toMatch(/-200 kcal: 5,000 steps below your average/);
  });

  it('caps by max_daily_adjustment in both directions', () => {
    const up = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 30000, isToday: false });
    expect(up.adjustment).toBe(300);
    expect(up.capped).toBe(true);
    expect(up.reason).toMatch(/capped/);
    const down = calculateStepAdjustedTarget({
      ...base,
      maxDailyAdjustment: 100,
      baseline,
      daySteps: 1000,
      isToday: false,
    });
    expect(down.adjustment).toBe(-100);
  });

  it('a cap of 0 disables movement', () => {
    const r = calculateStepAdjustedTarget({ ...base, maxDailyAdjustment: 0, baseline, daySteps: 20000, isToday: false });
    expect(r.adjustment).toBe(0);
  });

  it('suppresses noise below 25 kcal', () => {
    const r = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 8500, isToday: false });
    expect(r.adjustment).toBe(0); // +20 kcal
  });

  it('compares today against the usual pace, not the full-day average', () => {
    // Halfway through the waking day: expected 4000 steps.
    const mid = (PACE_DAY_START_MIN + PACE_DAY_END_MIN) / 2;
    const onPace = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 4000, isToday: true, nowMinutes: mid });
    expect(onPace.expectedSteps).toBe(4000);
    expect(onPace.adjustment).toBe(0);
    expect(onPace.reason).toMatch(/usual pace/);

    const ahead = calculateStepAdjustedTarget({ ...base, baseline, daySteps: 7000, isToday: true, nowMinutes: mid });
    expect(ahead.adjustment).toBe(120);
  });

  it('does nothing without a baseline or without data for the day', () => {
    expect(calculateStepAdjustedTarget({ ...base, baseline: null, daySteps: 12000, isToday: false }).adjustment).toBe(0);
    const noData = calculateStepAdjustedTarget({ ...base, baseline, daySteps: null, isToday: true, nowMinutes: 900 });
    expect(noData.adjustment).toBe(0);
    expect(noData.adjustedCalories).toBe(2200);
    expect(noData.reason).toMatch(/No steps synced/);
  });

  it('over the baseline window, uncapped adjustments average to ~0 (weekly intake stays on plan)', () => {
    const steps = [4000, 12000, 7000, 9500, 3000, 15000, 6500, 8000, 10000, 5000, 11000, 6000, 9000, 7500];
    const history = days('2026-11-01', steps);
    const target = '2026-11-15';
    const b = computeStepBaseline(history, target)!;
    const adjustments = history.map(
      (d) =>
        calculateStepAdjustedTarget({
          ...base,
          maxDailyAdjustment: 10000,
          baseline: b,
          daySteps: d.steps,
          isToday: false,
        }).adjustment
    );
    const mean = adjustments.reduce((a, c) => a + c, 0) / adjustments.length;
    // Only per-day 10 kcal rounding / 25 kcal noise floor remain.
    expect(Math.abs(mean)).toBeLessThan(10);
  });
});

describe('applyAdjustmentToMacros', () => {
  const t = { calories: 2200, protein: 180, carbs: 220, fat: 70 };
  it('moves calories via carbs, holding protein and fat', () => {
    const r = applyAdjustmentToMacros(t, 120);
    expect(r).toEqual({ calories: 2320, protein: 180, carbs: 250, fat: 70 });
  });
  it('floors carbs at 0 and only applies what was realised', () => {
    const r = applyAdjustmentToMacros({ ...t, carbs: 20 }, -300);
    expect(r.carbs).toBe(0);
    expect(r.calories).toBe(2120);
  });
  it('is a no-op for 0 and handles null macros', () => {
    expect(applyAdjustmentToMacros(t, 0)).toBe(t);
    expect(applyAdjustmentToMacros({ calories: 2000, carbs: null }, 100).calories).toBe(2100);
    expect(applyAdjustmentToMacros({ calories: null, carbs: 100 }, 100).calories).toBeNull();
  });
});
