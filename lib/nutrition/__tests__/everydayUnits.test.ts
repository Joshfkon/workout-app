/**
 * Everyday units next to grams (panel r19, Vince: "113 g isn't weighed in
 * grams the way I'd log it"): a weighed food offers an everyday measure
 * without changing its default, and a weight shows "Same as …" equivalents.
 */

import {
  computeServing,
  equivalentAmounts,
  weightBasedModel,
  withEverydayUnit,
  withHouseholdServing,
  EVERYDAY_UNIT_ID,
} from '../servingScaling';
import { everydayUnitForSystemFood } from '../portionDefaults';

const chicken = weightBasedModel({ calories: 165, protein: 31, carbs: 0, fat: 3.6 }, 113);

describe('withEverydayUnit', () => {
  it('adds the measure alongside grams and keeps the default a weight', () => {
    const model = withEverydayUnit(chicken, { noun: 'palm-size portion', grams: 113 });
    expect(model.defaultUnitId).toBe('g');
    expect(model.defaultAmount).toBe(113);
    expect(model.units.map((u) => u.id)).toEqual(['g', 'oz', EVERYDAY_UNIT_ID]);
    expect(model.units[2].label).toBe('palm-size portion (113 g)');
  });

  it('logs exactly what the same grams would', () => {
    const model = withEverydayUnit(chicken, { noun: 'palm-size portion', grams: 113 });
    const byPortion = computeServing(model, 1, EVERYDAY_UNIT_ID);
    const byGrams = computeServing(model, 113, 'g');
    expect(byPortion.macros).toEqual(byGrams.macros);
    expect(byPortion.servingSize).toBe('1 palm-size portion (113g)');
    expect(byPortion.servings).toBe(1);
  });

  it('is a no-op without a measure', () => {
    expect(withEverydayUnit(chicken, null)).toBe(chicken);
  });
});

describe('equivalentAmounts', () => {
  const model = withEverydayUnit(chicken, { noun: 'palm-size portion', grams: 113 });

  it('gives the same amount in ounces and the everyday measure', () => {
    expect(equivalentAmounts(model, '113', 'g')).toEqual([
      { unitId: 'oz', amount: 4, label: '4 oz' },
      { unitId: EVERYDAY_UNIT_ID, amount: 1, label: '1 palm-size portion' },
    ]);
  });

  it('rounds to amounts people use', () => {
    expect(equivalentAmounts(model, 170, 'g')).toEqual([
      { unitId: 'oz', amount: 6, label: '6 oz' },
      { unitId: EVERYDAY_UNIT_ID, amount: 1.5, label: '1.5 palm-size portion' },
    ]);
    expect(equivalentAmounts(model, 6, 'oz')[0]).toEqual({ unitId: 'g', amount: 170, label: '170 g' });
  });

  it('shows the household unit for a counted food weighed in grams', () => {
    const eggs = withHouseholdServing(
      weightBasedModel({ calories: 155, protein: 13, carbs: 1, fat: 11 }),
      { noun: 'large egg', grams: 50 }
    );
    expect(equivalentAmounts(eggs, 100, 'g')).toContainEqual({ unitId: 'household', amount: 2, label: '2 large egg' });
  });

  it('says nothing from a serving unit, for an empty amount, or under a quarter serving', () => {
    expect(equivalentAmounts(model, 1, EVERYDAY_UNIT_ID)).toEqual([]);
    expect(equivalentAmounts(model, '', 'g')).toEqual([]);
    expect(equivalentAmounts(model, 10, 'g').map((e) => e.unitId)).toEqual(['oz']);
  });
});

describe('everydayUnitForSystemFood', () => {
  it('meat and fish: a palm-size portion; nuts: a small handful; powder: a scoop', () => {
    expect(everydayUnitForSystemFood({ name: 'Chicken Breast (grilled)', subcategory: 'poultry' })).toEqual({
      noun: 'palm-size portion',
      grams: 113,
    });
    expect(everydayUnitForSystemFood({ name: 'Salmon', subcategory: 'fish' })?.noun).toBe('palm-size portion');
    expect(everydayUnitForSystemFood({ name: 'Almonds', subcategory: 'nuts' })).toEqual({ noun: 'small handful', grams: 28 });
    expect(everydayUnitForSystemFood({ name: 'Whey', subcategory: 'protein_powder' })).toEqual({ noun: 'scoop', grams: 30 });
  });

  it('none for grains, name-specific portions, or unknown foods', () => {
    expect(everydayUnitForSystemFood({ name: 'White Rice (cooked)', subcategory: 'grains' })).toBeNull();
    expect(everydayUnitForSystemFood({ name: 'Turkey Breast (deli sliced)', subcategory: 'poultry' })).toBeNull();
    expect(everydayUnitForSystemFood({ name: 'Mystery', subcategory: null })).toBeNull();
  });
});
