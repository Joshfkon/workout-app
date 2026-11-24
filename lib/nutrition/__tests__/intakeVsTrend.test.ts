import { explainIntakeVsTrend, expectedWeeklyChange } from '../intakeVsTrend';

describe('expectedWeeklyChange', () => {
  it('uses 7700 kcal per kg and 3500 per lb', () => {
    expect(expectedWeeklyChange(-1100, 'kg')).toBeCloseTo(-1);
    expect(expectedWeeklyChange(-500, 'lb')).toBeCloseTo(-1);
  });
});

describe('explainIntakeVsTrend', () => {
  // Priya (r19): ~750 under a 1,872 goal, slow 0.3 kg/wk loss.
  const priya = {
    avgIntakeKcal: 1122,
    daysLogged: 12,
    goalKcal: 1872,
    burnKcal: 2300,
    burnSettling: true,
    observedPerWeek: -0.3,
    unit: 'kg' as const,
  };

  it('says the under-goal figure is logged intake vs the goal, on top of the planned deficit', () => {
    const out = explainIntakeVsTrend(priya);
    expect(out.goalLine).toBe(
      'On the 12 days you logged, you averaged 1,122 kcal a day: 750 under your 1,872 kcal goal. ' +
        'Your goal is already set below your burn, so that gap is on top of the planned deficit.'
    );
  });

  it('turns intake vs estimated burn into an expected weekly change', () => {
    const out = explainIntakeVsTrend(priya);
    // (1122 − 2300) × 7 / 7700 ≈ −1.07
    expect(out.expectedPerWeek).toBeCloseTo(-1.07, 2);
    expect(out.burnLine).toBe(
      'Against your estimated burn of 2,300 kcal a day, your logged intake is 1,178 kcal a day under it, ' +
        'which would mean about −1.1 kg a week.'
    );
  });

  it('explains a slower loss than predicted: unlogged food or a settling burn estimate', () => {
    const out = explainIntakeVsTrend(priya);
    expect(out.trendLine).toContain('Your weight trend shows −0.3 kg a week: a slower loss than that.');
    expect(out.trendLine).toContain("some food or drinks aren't getting logged");
    expect(out.trendLine).toContain('Yours is still settling');
  });

  it('leaves out the settling note once the estimate is stable', () => {
    const out = explainIntakeVsTrend({ ...priya, burnSettling: false });
    expect(out.trendLine).not.toContain('Yours is still settling');
  });

  it('says when the trend matches', () => {
    const out = explainIntakeVsTrend({ ...priya, observedPerWeek: -1.0 });
    expect(out.trendLine).toBe('Your weight trend shows −1.0 kg a week, which matches.');
  });

  it('a faster loss than predicted points at the burn estimate or water, not logging', () => {
    const out = explainIntakeVsTrend({ ...priya, avgIntakeKcal: 2200, observedPerWeek: -0.8 });
    expect(out.trendLine).toContain('less on the scale than that predicts');
    expect(out.trendLine).not.toContain('logged');
  });

  it('works in pounds', () => {
    const out = explainIntakeVsTrend({ ...priya, unit: 'lb', observedPerWeek: -0.7 });
    // (1122 − 2300) × 7 / 3500 ≈ −2.36 lb
    expect(out.burnLine).toContain('about −2.4 lb a week');
  });

  it('without a burn estimate, only the goal line', () => {
    const out = explainIntakeVsTrend({ ...priya, burnKcal: null });
    expect(out.goalLine).not.toBeNull();
    expect(out.goalLine).not.toContain('planned deficit');
    expect(out.burnLine).toBeNull();
    expect(out.trendLine).toBeNull();
  });

  it('over goal, and no goal set', () => {
    expect(explainIntakeVsTrend({ ...priya, avgIntakeKcal: 2000 }).goalLine).toBe(
      'On the 12 days you logged, you averaged 2,000 kcal a day: 128 over your 1,872 kcal goal.'
    );
    expect(explainIntakeVsTrend({ ...priya, goalKcal: null }).goalLine).toBeNull();
  });
});
