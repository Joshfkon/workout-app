import {
  defaultPortion,
  stepAmount,
  typicalPortionGramsForSystemFood,
} from '../portionDefaults';
import {
  packagedModel,
  servingOptionsModel,
  weightBasedModel,
  withHouseholdServing,
} from '../servingScaling';

const PER100 = { calories: 165, protein: 31, carbs: 0, fat: 3.6 };

describe('defaultPortion', () => {
  it('uses the last portion logged for the food first', () => {
    const model = weightBasedModel(PER100);
    expect(defaultPortion(model, { lastUsed: { amount: 200, unitId: 'g' }, typicalGrams: 113 })).toEqual({
      amount: 200,
      unitId: 'g',
      reason: 'last',
    });
  });

  it('ignores a last portion in a unit this food does not have', () => {
    const model = weightBasedModel(PER100);
    expect(defaultPortion(model, { lastUsed: { amount: 2, unitId: 'srv-3' }, typicalGrams: 113 })).toMatchObject({
      amount: 113,
      unitId: 'g',
      reason: 'typical',
    });
  });

  it("prefers the food's own household serving over a typical weight", () => {
    const model = withHouseholdServing(weightBasedModel(PER100), { noun: 'large egg', grams: 50 });
    expect(defaultPortion(model, { typicalGrams: 113 })).toEqual({
      amount: 1,
      unitId: 'household',
      reason: 'serving',
    });
  });

  it('keeps a packaged serving ("1 bar") as the default', () => {
    const model = packagedModel(PER100, 60, 'bar');
    expect(defaultPortion(model)).toMatchObject({ amount: 1, unitId: 'serving' });
  });

  it('falls back to the model default when nothing better is known', () => {
    expect(defaultPortion(weightBasedModel(PER100))).toEqual({ amount: 100, unitId: 'g', reason: 'model' });
    const usda = servingOptionsModel([
      { noun: '100g', grams: 100, macros: PER100 },
      { noun: 'large', grams: 50, macros: PER100 },
    ]);
    expect(defaultPortion(usda)).toMatchObject({ amount: 1, unitId: 'srv-1', reason: 'serving' });
  });

  it("uses an explicit fallback (a logged row's own portion) before the model", () => {
    const model = packagedModel(PER100, 150, 'serving');
    expect(defaultPortion(model, { fallback: { amount: 2, unitId: 'serving' } })).toMatchObject({
      amount: 2,
      unitId: 'serving',
    });
  });
});

describe('typicalPortionGramsForSystemFood', () => {
  it('knows a usual portion for weighed foods', () => {
    expect(
      typicalPortionGramsForSystemFood({ name: 'Chicken Breast (grilled, skinless)', category: 'protein', subcategory: 'poultry' })
    ).toBe(113);
    expect(typicalPortionGramsForSystemFood({ name: 'White Rice (cooked)', category: 'carbs', subcategory: 'grains' })).toBe(150);
    expect(typicalPortionGramsForSystemFood({ name: 'Oats (dry/raw)', category: 'carbs', subcategory: 'grains' })).toBe(40);
    expect(typicalPortionGramsForSystemFood({ name: 'Almonds (raw)', category: 'fats', subcategory: 'nuts' })).toBe(28);
    expect(typicalPortionGramsForSystemFood({ name: 'Broccoli', category: 'vegetables', subcategory: 'cruciferous' })).toBe(85);
  });

  it('returns null when it does not know', () => {
    expect(typicalPortionGramsForSystemFood({ name: 'Olive Oil', category: 'fats', subcategory: 'oils' })).toBeNull();
    expect(typicalPortionGramsForSystemFood({ name: 'Mystery' })).toBeNull();
  });
});

describe('stepAmount', () => {
  const g = { id: 'g', kind: 'weight' as const };
  const oz = { id: 'oz', kind: 'weight' as const };
  const serving = { id: 'serving', kind: 'serving' as const };

  it('moves grams by 10, snapping to the grid', () => {
    expect(stepAmount('113', g, 1)).toBe(120);
    expect(stepAmount('113', g, -1)).toBe(110);
    expect(stepAmount('120', g, 1)).toBe(130);
    expect(stepAmount('120', g, -1)).toBe(110);
  });

  it('moves servings and ounces by a half', () => {
    expect(stepAmount('1', serving, 1)).toBe(1.5);
    expect(stepAmount('1', serving, -1)).toBe(0.5);
    expect(stepAmount(4, oz, 1)).toBe(4.5);
  });

  it('never steps to zero, and treats junk as empty', () => {
    expect(stepAmount('0.5', serving, -1)).toBe(0.5);
    expect(stepAmount('10', g, -1)).toBe(10);
    expect(stepAmount('', g, 1)).toBe(10);
    expect(stepAmount('abc', serving, 1)).toBe(0.5);
  });
});
