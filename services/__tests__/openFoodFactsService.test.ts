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
