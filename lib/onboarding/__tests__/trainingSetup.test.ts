import {
  EMPTY_TRAINING_SETUP,
  customChangeForGoal,
  formatRatePercent,
  formatWeeklyChange,
  nearestRateForChange,
  parseCustomRate,
  percentOfBodyWeight,
  rateAmountPerWeek,
  rateForGoal,
  rateOptionsForGoal,
  trainingPreferencesPatch,
  trainingSetupFromPreferences,
} from '../trainingSetup';

describe('onboarding training step (pure)', () => {
  it('offers the macro calculator’s own pace levels, slowest first, per direction', () => {
    expect(rateOptionsForGoal('bulk')).toEqual([
      { value: 'slow_bulk', name: 'Lean bulk', percentBW: 0.25 },
      { value: 'moderate_bulk', name: 'Moderate bulk', percentBW: 0.5 },
      { value: 'aggressive_bulk', name: 'Aggressive bulk', percentBW: 0.75 },
    ]);
    expect(rateOptionsForGoal('cut').map((r) => r.value)).toEqual(['slow_cut', 'moderate_cut', 'aggressive_cut']);
    expect(rateOptionsForGoal('maintenance')).toEqual([]);
    expect(rateOptionsForGoal(null)).toEqual([]);
  });

  it('phrases a pace as % of body weight and as an amount at this weight', () => {
    expect(formatRatePercent(0.25)).toBe('+0.25% of body weight a week');
    expect(formatRatePercent(-0.5)).toBe('−0.5% of body weight a week');
    expect(rateAmountPerWeek(0.25, 80, 'kg')).toBe('about +0.2 kg a week');
    expect(rateAmountPerWeek(-0.5, 90, 'lb')).toBe('about −0.99 lb a week');
    expect(rateAmountPerWeek(0.25, 0, 'kg')).toBeNull();
  });

  it('never keeps a pace that runs against the goal', () => {
    expect(rateForGoal('bulk', 'moderate_bulk')).toBe('moderate_bulk');
    expect(rateForGoal('bulk', 'slow_cut')).toBeNull();
    expect(rateForGoal('maintenance', 'slow_bulk')).toBeNull();
    expect(rateForGoal('cut', null)).toBeNull();
  });

  it('writes only answered keys to users.preferences', () => {
    expect(trainingPreferencesPatch(EMPTY_TRAINING_SETUP)).toEqual({});
    expect(trainingPreferencesPatch({ daysPerWeek: 5, split: 'ppl', rate: 'slow_bulk', weeklyChangeKg: null })).toEqual({
      trainingDaysPerWeek: 5,
      currentSplit: 'ppl',
    });
    expect(trainingPreferencesPatch({ daysPerWeek: 9, split: null, rate: null, weeklyChangeKg: 0.25 })).toEqual({});
  });

  it('restores saved answers, ignoring anything malformed', () => {
    expect(trainingSetupFromPreferences({ trainingDaysPerWeek: 4, currentSplit: 'upper_lower' })).toEqual({
      daysPerWeek: 4,
      split: 'upper_lower',
      rate: null,
      weeklyChangeKg: null,
    });
    expect(trainingSetupFromPreferences({ trainingDaysPerWeek: '4', currentSplit: 'bro' })).toEqual(EMPTY_TRAINING_SETUP);
    expect(trainingSetupFromPreferences(null)).toEqual(EMPTY_TRAINING_SETUP);
  });

  describe('a pace typed in kg or lb a week (UX round 21: "I wanted 0.25 kg/wk")', () => {
    it('reads the amount in the user unit, signs it by the goal, and gives the % alongside', () => {
      expect(parseCustomRate('0.25', 'kg', 'bulk', 80)).toEqual({ ok: true, weeklyChangeKg: 0.25, percentBW: 0.31 });
      expect(parseCustomRate('0,5', 'kg', 'cut', 80)).toEqual({ ok: true, weeklyChangeKg: -0.5, percentBW: 0.63 });
      const lb = parseCustomRate('0.5', 'lb', 'bulk', 80);
      expect(lb.ok && lb.weeklyChangeKg).toBeCloseTo(0.227, 3);
    });

    it('treats an empty field as no custom pace, and explains a bad or too-fast one', () => {
      expect(parseCustomRate('', 'kg', 'bulk', 80)).toEqual({ ok: false, error: null });
      expect(parseCustomRate('0.3', 'kg', 'maintenance', 80)).toEqual({ ok: false, error: null });
      const bad = parseCustomRate('abc', 'kg', 'bulk', 80);
      expect(bad.ok).toBe(false);
      expect(!bad.ok && bad.error).toMatch(/kg a week/);
      const tooFast = parseCustomRate('1.2', 'kg', 'bulk', 80);
      expect(!tooFast.ok && tooFast.error).toMatch(/over 1% of your body weight.*0\.8 kg or less/);
    });

    it('names the nearest calculator level, and drops a pace that runs against the goal', () => {
      expect(nearestRateForChange('bulk', 0.25, 80)).toBe('slow_bulk');
      expect(nearestRateForChange('bulk', 0.5, 80)).toBe('moderate_bulk');
      expect(nearestRateForChange('bulk', 0.6, 80)).toBe('aggressive_bulk');
      expect(nearestRateForChange('cut', -0.4, 80)).toBe('moderate_cut');
      expect(nearestRateForChange('maintenance', 0.2, 80)).toBeNull();
      expect(customChangeForGoal('bulk', 0.25)).toBe(0.25);
      expect(customChangeForGoal('cut', 0.25)).toBeNull();
      expect(customChangeForGoal('maintenance', -0.3)).toBeNull();
    });

    it('formats the pace in the user unit', () => {
      expect(formatWeeklyChange(0.25, 'kg')).toBe('+0.25 kg a week');
      expect(formatWeeklyChange(-0.5, 'lb')).toBe('−1.1 lb a week');
      expect(percentOfBodyWeight(0.25, 80)).toBe(0.31);
      expect(percentOfBodyWeight(0.25, 0)).toBeNull();
    });
  });
});
