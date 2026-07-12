import {
  OZ_TO_G,
  computeServing,
  scaleMacros,
  parseServingWeight,
  weightBasedModel,
  packagedModel,
  perServingModel,
  customPerRefModel,
  servingOptionsModel,
  modelFromLoggedEntry,
  initialAmountForEntry,
} from '../servingScaling';

describe('scaleMacros', () => {
  it('scales linearly and rounds (calories int, macros 1dp)', () => {
    const per = { calories: 0.78, protein: 0.05, carbs: 0.14, fat: 0.004 };
    expect(scaleMacros(per, 150)).toEqual({
      calories: 117,
      protein: 7.5,
      carbs: 21,
      fat: 0.6,
    });
  });
});

describe('parseServingWeight', () => {
  it('reads grams from a variety of serving_size strings', () => {
    expect(parseServingWeight('150g').grams).toBe(150);
    expect(parseServingWeight('1 portion (85.048 g)').grams).toBeCloseTo(85.048);
    expect(parseServingWeight('0.5 bottle (198g)').grams).toBe(198);
    expect(parseServingWeight('3 oz').grams).toBeCloseTo(3 * OZ_TO_G);
    expect(parseServingWeight('1 serving').grams).toBeNull();
    expect(parseServingWeight(null).grams).toBeNull();
  });
});

describe('weight-based food (per 100g)', () => {
  // PEAS: 78 cal / 100g
  const model = weightBasedModel({ calories: 78, protein: 5.4, carbs: 14, fat: 0.4 });

  it('previews 100g at 78 cal and 150g at 117 cal', () => {
    expect(computeServing(model, 100, 'g').macros.calories).toBe(78);
    expect(computeServing(model, 150, 'g').macros.calories).toBe(117);
  });

  it('logs 150g with a "150g" serving_size and scaled macros', () => {
    const r = computeServing(model, 150, 'g');
    expect(r.servingSize).toBe('150g');
    expect(r.servings).toBe(1); // weight-anchored: portion lives in serving_size
    expect(r.macros).toEqual({ calories: 117, protein: 8.1, carbs: 21, fat: 0.6 });
  });

  it('offers grams + oz units and converts oz correctly', () => {
    expect(model.units.map((u) => u.id)).toEqual(['g', 'oz']);
    // 3.53 oz ~= 100g -> ~78 cal
    const r = computeServing(model, 100 / OZ_TO_G, 'oz');
    expect(r.macros.calories).toBe(78);
  });
});

describe('packaged food (per serving of known grams)', () => {
  // A 397g bottle at ~200 cal
  const model = packagedModel({ calories: 200, protein: 10, carbs: 30, fat: 4 }, 397, 'bottle');

  it('unit selector shows a plain "bottle" label and grams (weight lives in helper text)', () => {
    expect(model.units.find((u) => u.id === 'serving')?.label).toBe('bottle');
    // gram weight is still known on the unit so the editor can show helper text
    expect(model.units.find((u) => u.id === 'serving')?.gramsPerUnit).toBe(397);
    expect(model.units.find((u) => u.id === 'g')?.label).toBe('grams');
  });

  it('0.5 bottle and 198g produce ~equal macros', () => {
    const byBottle = computeServing(model, 0.5, 'serving').macros;
    const byGrams = computeServing(model, 198, 'g').macros;
    expect(byGrams.calories).toBe(byBottle.calories);
    expect(byGrams.protein).toBeCloseTo(byBottle.protein, 0);
    expect(byGrams.carbs).toBeCloseTo(byBottle.carbs, 0);
    expect(byGrams.fat).toBeCloseTo(byBottle.fat, 0);
  });

  it('builds round-trippable serving_size strings', () => {
    expect(computeServing(model, 0.5, 'serving').servingSize).toBe('0.5 bottle (199g)'); // 0.5 × 397 = 198.5
    expect(computeServing(model, 198, 'g').servingSize).toBe('198g');
  });
});

describe('custom per-reference food', () => {
  it('scales from an arbitrary reference amount', () => {
    // 160 cal per 28g
    const model = customPerRefModel({ calories: 160, protein: 6, carbs: 6, fat: 14 }, 28, 'g');
    const r = computeServing(model, 56, 'g'); // double the reference
    expect(r.macros.calories).toBe(320);
    expect(r.servingSize).toBe('56g');
  });
});

describe('perServingModel without grams', () => {
  it('offers only the serving unit and counts servings', () => {
    const model = perServingModel({ calories: 100, protein: 8, carbs: 5, fat: 2 }, 'scoop');
    expect(model.units).toHaveLength(1);
    const r = computeServing(model, 2, 'serving');
    expect(r.servings).toBe(2);
    expect(r.macros.calories).toBe(200);
    expect(r.servingSize).toBe('2 scoop');
  });
});

describe('servingOptionsModel (USDA multi-serving)', () => {
  const model = servingOptionsModel([
    { noun: 'cup', grams: 160, macros: { calories: 120, protein: 8, carbs: 20, fat: 1 } },
    { noun: 'tbsp', grams: 10, macros: { calories: 7.5, protein: 0.5, carbs: 1.25, fat: 0.06 } },
  ]);

  it('exposes every serving option plus a derived grams unit', () => {
    const ids = model.units.map((u) => u.id);
    expect(ids).toContain('srv-0');
    expect(ids).toContain('srv-1');
    expect(ids).toContain('g');
    expect(model.units.find((u) => u.id === 'srv-0')?.label).toBe('cup (160g)');
  });

  it('scales the selected serving option', () => {
    expect(computeServing(model, 2, 'srv-0').macros.calories).toBe(240);
  });
});

describe('modelFromLoggedEntry (edit round-trip)', () => {
  it('recovers per-serving base and grams from a logged weight entry', () => {
    // Logged 150g of PEAS: 117 cal total, servings 1, serving_size "150g"
    const { model, defaultAmount, defaultUnitId } = modelFromLoggedEntry({
      serving_size: '150g',
      servings: 1,
      calories: 117,
      protein: 8.1,
      carbs: 21,
      fat: 0.6,
    });
    expect(defaultUnitId).toBe('serving');
    expect(defaultAmount).toBe(1);
    // A grams unit is available because serving_size carried grams
    expect(model.units.some((u) => u.id === 'g')).toBe(true);
    // Re-logging the same serving reproduces the totals
    const r = computeServing(model, defaultAmount, defaultUnitId);
    expect(r.macros.calories).toBe(117);
    // Switching to 300g doubles it
    expect(computeServing(model, 300, 'g').macros.calories).toBe(234);
  });

  it('handles multi-serving entries (grams reflect whole portion)', () => {
    // Logged 2 servings, whole portion 320g
    const { model } = modelFromLoggedEntry({
      serving_size: '2 cup (320g)',
      servings: 2,
      calories: 240,
      protein: 16,
      carbs: 40,
      fat: 2,
    });
    // per-serving grams = 320 / 2 = 160
    const gUnit = model.units.find((u) => u.id === 'g');
    expect(gUnit).toBeDefined();
    // 160g == 1 serving == 120 cal
    expect(computeServing(model, 160, 'g').macros.calories).toBe(120);
  });
});

describe('initialAmountForEntry (reopen shows amount as entered)', () => {
  it('reopens a grams entry in grams, not a serving fraction', () => {
    // "180 g" was logged against an 85 g serving → servings column ~= 2.1176
    expect(initialAmountForEntry('180g', 180 / 85)).toEqual({ amount: '180', unitId: 'g' });
  });

  it('reopens an oz entry in oz', () => {
    expect(initialAmountForEntry('6oz', 2)).toEqual({ amount: '6', unitId: 'oz' });
  });

  it('reopens a serving entry in servings (rounded to 2dp)', () => {
    expect(initialAmountForEntry('1 serving (85g)', 1)).toEqual({ amount: '1', unitId: 'serving' });
    expect(initialAmountForEntry('180 serving (15300g)', 180)).toEqual({
      amount: '180',
      unitId: 'serving',
    });
    // A messy servings float is not shown raw
    expect(initialAmountForEntry('1 serving (85g)', 2.1176470588235294)).toEqual({
      amount: '2.12',
      unitId: 'serving',
    });
  });

  it('falls back to 1 serving when serving_size is empty', () => {
    expect(initialAmountForEntry(null, 0)).toEqual({ amount: '1', unitId: 'serving' });
  });
});

describe('edit corruption regression: serving reference survives a save→reopen', () => {
  // The Giant Eagle fries: 140 cal / P3 / C21 / F5 per 1 serving (85 g).
  const clean = { calories: 140, protein: 3, carbs: 21, fat: 5 };
  const SERVING_GRAMS = 85;
  const model = packagedModel(clean, SERVING_GRAMS, 'serving');

  /** Simulate persisting a computed portion, then reconstructing the food's
   *  per-serving reference the way the edit sheet does on reopen. */
  function saveThenRecover(amount: number, unitId: string) {
    const r = computeServing(model, amount, unitId);
    const entry = {
      servings: r.servings,
      serving_size: r.servingSize,
      calories: r.macros.calories,
      protein: r.macros.protein,
      carbs: r.macros.carbs,
      fat: r.macros.fat,
    };
    const perServing = {
      calories: entry.calories / entry.servings,
      protein: entry.protein / entry.servings,
      carbs: entry.carbs / entry.servings,
      fat: entry.fat / entry.servings,
    };
    const { grams } = parseServingWeight(entry.serving_size);
    const perServingGrams = grams != null ? grams / entry.servings : null;
    return { entry, perServing, perServingGrams };
  }

  it('mistaken 180-servings save reopens to the same 140 cal / 85 g reference', () => {
    const { perServing, perServingGrams } = saveThenRecover(180, 'serving');
    expect(Math.round(perServing.calories)).toBe(140);
    expect(Math.round(perServing.protein)).toBe(3);
    expect(perServingGrams).toBeCloseTo(85, 5);
  });

  it('180-grams save reopens to the same 140 cal / 85 g reference (grams path is clean)', () => {
    const { entry, perServing, perServingGrams } = saveThenRecover(180, 'g');
    // 180 g of an 85 g/140 cal serving ≈ 296 cal
    expect(entry.calories).toBe(296);
    expect(entry.serving_size).toBe('180g');
    expect(Math.round(perServing.calories)).toBe(140);
    expect(perServingGrams).toBeCloseTo(85, 5);
  });
});
