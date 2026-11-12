/**
 * USDA serving maths: search hits report nutrients per 100 g, so they must be
 * scaled onto the label serving they are shown with.
 */
import {
  searchFoods,
  getFoodDetails,
  lookupBarcode,
  resolveUsdaServing,
  resolvePer100Nutrition,
  gtinMatches,
} from '../usdaService';

const nutrients = (kcal: number | null, protein: number, carbs: number, fat: number) => [
  ...(kcal === null ? [] : [{ nutrientId: 1008, nutrientName: 'Energy', nutrientNumber: '208', unitName: 'KCAL', value: kcal }]),
  { nutrientId: 1003, nutrientName: 'Protein', nutrientNumber: '203', unitName: 'G', value: protein },
  { nutrientId: 1005, nutrientName: 'Carbs', nutrientNumber: '205', unitName: 'G', value: carbs },
  { nutrientId: 1004, nutrientName: 'Fat', nutrientNumber: '204', unitName: 'G', value: fat },
];

function mockFetchJson(body: unknown, ok = true, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolveUsdaServing', () => {
  it('scales onto a gram or millilitre label serving', () => {
    expect(resolveUsdaServing({ servingSize: 60, servingSizeUnit: 'g' })).toEqual({
      servingSize: '60g',
      factor: 0.6,
      grams: 60,
    });
    expect(resolveUsdaServing({ servingSize: 240, servingSizeUnit: 'MLT' })).toEqual({
      servingSize: '240ml',
      factor: 2.4,
      grams: 240,
    });
  });

  it('falls back to a weight-anchored 100g when the serving has no usable weight', () => {
    expect(resolveUsdaServing({})).toEqual({ servingSize: '100g', factor: 1, grams: 100 });
    expect(resolveUsdaServing({ servingSize: 1, servingSizeUnit: 'bar' })).toEqual({
      servingSize: '100g',
      factor: 1,
      grams: 100,
    });
  });
});

describe('resolvePer100Nutrition', () => {
  it('returns null (no data) rather than a 0-kcal food when nothing is reported', () => {
    expect(resolvePer100Nutrition([])).toBeNull();
    expect(resolvePer100Nutrition([{ id: 1093, value: 120 }])).toBeNull();
  });

  it('keeps an explicit zero (water) as real data', () => {
    expect(resolvePer100Nutrition([{ id: 1008, value: 0 }])).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });

  it('uses Atwater energy when 1008 is missing, else derives energy from macros', () => {
    expect(resolvePer100Nutrition([{ id: 2047, value: 165 }, { id: 1003, value: 31 }])?.calories).toBe(165);
    expect(
      resolvePer100Nutrition([
        { id: 1003, value: 10 },
        { id: 1005, value: 20 },
        { id: 1004, value: 5 },
      ])?.calories
    ).toBe(10 * 4 + 20 * 4 + 5 * 9);
  });
});

describe('gtinMatches', () => {
  it('matches across UPC-A / EAN-13 / GTIN-14 zero padding', () => {
    expect(gtinMatches('00012345678905', '012345678905')).toBe(true);
    expect(gtinMatches('0012345678905', '12345678905')).toBe(true);
  });

  it('rejects a different or missing code', () => {
    expect(gtinMatches('012345678905', '012345678912')).toBe(false);
    expect(gtinMatches(undefined, '012345678905')).toBe(false);
    expect(gtinMatches('', '')).toBe(false);
  });
});

describe('searchFoods', () => {
  it('shows a 60 g protein bar as 240 kcal per 60 g, not 400 kcal', async () => {
    mockFetchJson({
      foods: [
        {
          fdcId: 111,
          description: 'PROTEIN BAR',
          dataType: 'Branded',
          brandOwner: 'Acme',
          servingSize: 60,
          servingSizeUnit: 'g',
          foodNutrients: nutrients(400, 33.3, 40, 13.3),
        },
      ],
    });

    const { foods } = await searchFoods('protein bar');
    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({
      servingSize: '60g',
      servingGrams: 60,
      calories: 240,
      protein: 20,
      carbs: 24,
      fat: 8,
    });
  });

  it('presents a food with no weighed serving as per 100g (chicken breast)', async () => {
    mockFetchJson({
      foods: [
        {
          fdcId: 222,
          description: 'Chicken breast, roasted',
          dataType: 'SR Legacy',
          householdServingFullText: '1 cup, chopped',
          foodNutrients: nutrients(165, 31, 0, 3.6),
        },
      ],
    });

    const { foods } = await searchFoods('chicken breast');
    expect(foods[0]).toMatchObject({ servingSize: '100g', calories: 165, protein: 31 });
  });

  it('drops a hit with no nutrition data instead of listing it as 0 kcal', async () => {
    mockFetchJson({
      foods: [
        { fdcId: 1, description: 'MYSTERY', dataType: 'Branded', foodNutrients: [] },
        {
          fdcId: 2,
          description: 'OATS',
          dataType: 'Branded',
          servingSize: 40,
          servingSizeUnit: 'g',
          foodNutrients: nutrients(375, 12.5, 67.5, 7.5),
        },
      ],
    });

    const { foods } = await searchFoods('oats');
    expect(foods.map((f) => f.foodId)).toEqual(['2']);
    expect(foods[0].calories).toBe(150);
  });
});

describe('getFoodDetails', () => {
  it('keeps per-100g top-level values labelled 100g and offers the label serving as an option', async () => {
    mockFetchJson({
      fdcId: 111,
      description: 'PROTEIN BAR',
      dataType: 'Branded',
      servingSize: 60,
      servingSizeUnit: 'g',
      householdServingFullText: '1 bar',
      foodNutrients: [
        { nutrient: { id: 1008, name: 'Energy', unitName: 'kcal' }, amount: 400 },
        { nutrient: { id: 1003, name: 'Protein', unitName: 'g' }, amount: 33.3 },
        { nutrient: { id: 1005, name: 'Carbs', unitName: 'g' }, amount: 40 },
        { nutrient: { id: 1004, name: 'Fat', unitName: 'g' }, amount: 13.3 },
      ],
    });

    const { food } = await getFoodDetails('111');
    expect(food).toMatchObject({ servingSize: '100g', calories: 400 });
    expect(food?.servings?.[0]).toMatchObject({ description: '100g', calories: 400 });
    expect(food?.servings).toContainEqual(
      expect.objectContaining({ description: '1 bar (60g)', calories: 240 })
    );
  });

  it('reports no data instead of a 0-kcal food', async () => {
    mockFetchJson({ fdcId: 9, description: 'X', dataType: 'Foundation', foodNutrients: [] });
    const result = await getFoodDetails('9');
    expect(result.food).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});

describe('lookupBarcode', () => {
  const soda = {
    fdcId: 333,
    description: 'COLA',
    dataType: 'Branded',
    gtinUpc: '049000028911',
    servingSize: 240,
    servingSizeUnit: 'ml',
    foodNutrients: nutrients(42, 0, 10.6, 0),
  };

  it('returns the product whose GTIN matches, per label serving (240 ml cola = 101 kcal)', async () => {
    mockFetchJson({
      foods: [{ ...soda, fdcId: 999, gtinUpc: '049000000000', description: 'OTHER' }, soda],
    });

    const { food } = await lookupBarcode('0049000028911');
    expect(food).toMatchObject({ foodId: '333', servingSize: '240ml', servingGrams: 240, calories: 101 });
  });

  it('does not return the first full-text hit when no GTIN matches', async () => {
    mockFetchJson({ foods: [{ ...soda, gtinUpc: '049000000000' }] });

    const result = await lookupBarcode('049000028911');
    expect(result.food).toBeUndefined();
    expect(result.error).toMatch(/not found/i);
  });
});
