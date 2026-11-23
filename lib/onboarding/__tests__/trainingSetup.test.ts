import {
  EMPTY_TRAINING_SETUP,
  formatRatePercent,
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
    expect(trainingPreferencesPatch({ daysPerWeek: 5, split: 'ppl', rate: 'slow_bulk' })).toEqual({
      trainingDaysPerWeek: 5,
      currentSplit: 'ppl',
    });
    expect(trainingPreferencesPatch({ daysPerWeek: 9, split: null, rate: null })).toEqual({});
  });

  it('restores saved answers, ignoring anything malformed', () => {
    expect(trainingSetupFromPreferences({ trainingDaysPerWeek: 4, currentSplit: 'upper_lower' })).toEqual({
      daysPerWeek: 4,
      split: 'upper_lower',
      rate: null,
    });
    expect(trainingSetupFromPreferences({ trainingDaysPerWeek: '4', currentSplit: 'bro' })).toEqual(EMPTY_TRAINING_SETUP);
    expect(trainingSetupFromPreferences(null)).toEqual(EMPTY_TRAINING_SETUP);
  });
});
