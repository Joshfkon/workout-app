import {
  checkFoodRecordSanity,
  MAX_PLAUSIBLE_CALORIES_PER_SERVING,
} from '../foodRecordSanity';

describe('checkFoodRecordSanity', () => {
  it('passes a normal record', () => {
    const r = checkFoodRecordSanity({
      food_name: 'Giant Eagle French Fried Potatoes',
      serving_size: '1 serving (85g)',
      calories: 140,
      protein: 3,
      carbs: 21,
      fat: 5,
    });
    expect(r.implausible).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it('flags the observed corrupted fries record', () => {
    const r = checkFoodRecordSanity({
      food_name: 'Giant Eagle French Fried Potatoes',
      serving_size: '180g',
      calories: 26640,
      protein: 576,
      carbs: 3996,
      fat: 954,
    });
    expect(r.implausible).toBe(true);
    // both the calorie ceiling and the macro-mass check should fire
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('flags per-serving calories over the ceiling', () => {
    const r = checkFoodRecordSanity({
      serving_size: '1 serving',
      calories: MAX_PLAUSIBLE_CALORIES_PER_SERVING + 1,
    });
    expect(r.implausible).toBe(true);
  });

  it('flags macro grams exceeding serving weight', () => {
    const r = checkFoodRecordSanity({
      serving_size: '100g',
      calories: 300,
      protein: 60,
      carbs: 60,
      fat: 30, // 150g of macros in a 100g serving
    });
    expect(r.implausible).toBe(true);
    expect(r.reasons.some((x) => /exceed serving weight/.test(x))).toBe(true);
  });

  it('does not flag macro mass when the serving weight is unknown', () => {
    const r = checkFoodRecordSanity({
      serving_size: '1 serving', // no grams
      calories: 300,
      protein: 60,
      carbs: 60,
      fat: 30,
    });
    expect(r.implausible).toBe(false);
  });

  it('flags negative values', () => {
    const r = checkFoodRecordSanity({ serving_size: '100g', calories: -5 });
    expect(r.implausible).toBe(true);
  });
});
