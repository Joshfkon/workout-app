import {
  extractNutritionPerServing,
  resolveServingQuantity,
} from '../openFoodFactsService';

describe('extractNutritionPerServing', () => {
  it('falls back to scaled _100g macros when only per-serving calories exist (Belvita case)', () => {
    // Real-world shape: OFF has energy-kcal_serving but no *_serving macros.
    // The old parser keyed everything off energy-kcal_serving and returned
    // P/C/F = 0 for entries like UPC 044000031923.
    const nutriments = {
      'energy-kcal_serving': 220,
      proteins_100g: 8,
      carbohydrates_100g: 70,
      fat_100g: 14,
    };

    const result = extractNutritionPerServing(nutriments, 50);

    expect(result.calories).toBe(220);
    expect(result.protein).toBe(4); // 8 * 0.5
    expect(result.carbs).toBe(35); // 70 * 0.5
    expect(result.fat).toBe(7); // 14 * 0.5
  });

  it('prefers per-serving values when present', () => {
    const nutriments = {
      'energy-kcal_serving': 220,
      'energy-kcal_100g': 440,
      proteins_serving: 4,
      proteins_100g: 8,
      carbohydrates_serving: 36,
      carbohydrates_100g: 72,
      fat_serving: 7,
      fat_100g: 14,
    };

    const result = extractNutritionPerServing(nutriments, 50);

    expect(result).toMatchObject({ calories: 220, protein: 4, carbs: 36, fat: 7 });
  });

  it('scales all _100g values by the serving quantity when no _serving fields exist', () => {
    const nutriments = {
      'energy-kcal_100g': 400,
      proteins_100g: 10,
      carbohydrates_100g: 50,
      fat_100g: 20,
      fiber_100g: 5,
    };

    const result = extractNutritionPerServing(nutriments, 30);

    expect(result).toMatchObject({
      calories: 120,
      protein: 3,
      carbs: 15,
      fat: 6,
      fiber: 1.5,
    });
  });

  it('coerces numeric strings (OFF returns strings for some products)', () => {
    const nutriments = {
      'energy-kcal_serving': '220',
      proteins_100g: '8.5',
      carbohydrates_100g: '70',
      fat_100g: '14',
    };

    const result = extractNutritionPerServing(nutriments, 100);

    expect(result).toMatchObject({ calories: 220, protein: 8.5, carbs: 70, fat: 14 });
  });

  it('derives calories from kJ energy fields when kcal is missing', () => {
    const nutriments = {
      energy_100g: 1674, // kJ; 1674 / 4.184 = ~400 kcal per 100g
      proteins_100g: 10,
    };

    const result = extractNutritionPerServing(nutriments, 100);

    expect(result.calories).toBe(400);
    expect(result.protein).toBe(10);
  });

  it('returns zeros (not NaN) when nutriments are empty or garbage', () => {
    expect(extractNutritionPerServing({}, 100)).toMatchObject({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });

    expect(
      extractNutritionPerServing({ proteins_100g: 'not-a-number' as unknown as string }, 100)
    ).toMatchObject({ protein: 0 });
  });
});

describe('resolveServingQuantity', () => {
  it('uses numeric serving_quantity when present', () => {
    expect(resolveServingQuantity({ serving_quantity: 50 })).toBe(50);
  });

  it('coerces string serving_quantity', () => {
    expect(resolveServingQuantity({ serving_quantity: '50.2' })).toBe(50.2);
  });

  it('parses grams out of serving_size text when serving_quantity is missing', () => {
    expect(resolveServingQuantity({ serving_size: '4 biscuits (50g)' })).toBe(50);
    expect(resolveServingQuantity({ serving_size: '2 oz' })).toBeCloseTo(56.7, 1);
  });

  it('defaults to 100g when nothing is parseable', () => {
    expect(resolveServingQuantity({})).toBe(100);
    expect(resolveServingQuantity({ serving_quantity: 0 })).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Serving basis + missing nutriments (nutrition review findings 5 and 6)
// ---------------------------------------------------------------------------

import {
  parseGramsFromServingSize,
  resolveProductServing,
  hasNutritionData,
  lookupBarcode,
} from '../openFoodFactsService';

describe('parseGramsFromServingSize', () => {
  it('parses grams and ounces', () => {
    expect(parseGramsFromServingSize('30g')).toBe(30);
    expect(parseGramsFromServingSize('1 cup (240 g)')).toBe(240);
    expect(parseGramsFromServingSize('2 oz')).toBeCloseTo(56.7, 1);
  });

  it('returns null (not 100) when the text carries no weight', () => {
    expect(parseGramsFromServingSize('240ml')).toBeNull();
    expect(parseGramsFromServingSize('1 bar')).toBeNull();
    expect(parseGramsFromServingSize('1 cup')).toBeNull();
    expect(parseGramsFromServingSize('8 fl oz')).toBeNull();
    expect(parseGramsFromServingSize('500mg')).toBeNull();
  });
});

describe('resolveProductServing', () => {
  it('presents a "1 bar" product with only per-100g data as 100g, not as one bar', () => {
    const serving = resolveProductServing({
      serving_size: '1 bar',
      nutriments: {
        'energy-kcal_100g': 400,
        proteins_100g: 30,
        carbohydrates_100g: 40,
        fat_100g: 13,
      },
    });
    expect(serving.servingSize).toBe('100g');
    expect(serving.servingQuantity).toBe(100);
    expect(serving.nutrition).toMatchObject({ calories: 400, protein: 30 });
  });

  it('keeps the label serving when its weight is known (60 g bar = 240 kcal)', () => {
    const serving = resolveProductServing({
      serving_size: '1 bar (60g)',
      nutriments: { 'energy-kcal_100g': 400, proteins_100g: 30 },
    });
    expect(serving).toMatchObject({ servingSize: '1 bar (60g)', servingQuantity: 60 });
    expect(serving.nutrition).toMatchObject({ calories: 240, protein: 18 });
  });

  it('scales a 240 ml drink by its numeric serving_quantity (42 kcal/100ml -> 101 kcal)', () => {
    const serving = resolveProductServing({
      serving_size: '240ml',
      serving_quantity: 240,
      nutriments: { 'energy-kcal_100g': 42, carbohydrates_100g: 10.6 },
    });
    expect(serving).toMatchObject({ servingSize: '240ml', servingQuantity: 240 });
    expect(serving.nutrition.calories).toBe(101);
  });

  it('keeps the label serving when only per-serving values exist', () => {
    const serving = resolveProductServing({
      serving_size: '1 bar',
      nutriments: { 'energy-kcal_serving': 210, proteins_serving: 20 },
    });
    expect(serving.servingSize).toBe('1 bar');
    expect(serving.nutrition).toMatchObject({ calories: 210, protein: 20 });
  });
});

describe('missing nutriments', () => {
  it('hasNutritionData distinguishes "no data" from an explicit zero', () => {
    expect(hasNutritionData({})).toBe(false);
    expect(hasNutritionData({ salt_100g: 1.2 })).toBe(false);
    expect(hasNutritionData({ 'energy-kcal_100g': 0 })).toBe(true);
    expect(hasNutritionData({ proteins_serving: '12' })).toBe(true);
  });

  it('derives calories from macros when no energy field exists', () => {
    expect(
      extractNutritionPerServing({ proteins_100g: 10, carbohydrates_100g: 20, fat_100g: 5 }, 100).calories
    ).toBe(165);
  });
});

describe('lookupBarcode', () => {
  const offResponse = (product: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ status: 1, product }),
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not return a product without nutriments as a found 0-kcal food', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(offResponse({ code: '11111111', product_name: 'Empty', nutriments: {} })) as unknown as typeof fetch;
    const usdaLookup = jest.fn().mockResolvedValue({ error: 'Product not found.' });

    const result = await lookupBarcode('11111111', { usdaLookup });
    expect(result.found).toBe(false);
    expect(result.product).toBeUndefined();
    expect(usdaLookup).toHaveBeenCalledWith('11111111');
  });

  it('uses the per-serving USDA fallback as-is (no second scaling by an assumed 100 g)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 0 }),
    }) as unknown as typeof fetch;
    const usdaLookup = jest.fn().mockResolvedValue({
      food: {
        name: 'COLA',
        servingSize: '240ml',
        servingGrams: 240,
        calories: 101,
        protein: 0,
        carbs: 25.4,
        fat: 0,
      },
    });

    const result = await lookupBarcode('22222222', { usdaLookup });
    expect(result.found).toBe(true);
    expect(result.product).toMatchObject({
      servingSize: '240ml',
      servingQuantity: 240,
      calories: 101,
      barcode: '22222222',
    });
  });

  it('returns an OFF product with a "1 bar" serving on a 100g basis', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      offResponse({
        code: '33333333',
        product_name: 'Bar',
        serving_size: '1 bar',
        nutriments: { 'energy-kcal_100g': 400, proteins_100g: 30, carbohydrates_100g: 40, fat_100g: 13 },
      })
    ) as unknown as typeof fetch;

    const result = await lookupBarcode('33333333', { usdaLookup: jest.fn() });
    expect(result.product).toMatchObject({ servingSize: '100g', servingQuantity: 100, calories: 400 });
  });
});
