/**
 * USDA FoodData Central API Service
 * 
 * Primary food database - free, no IP restrictions
 * API Key: Get one at https://fdc.nal.usda.gov/api-key-signup.html
 */

// Parsed serving for UI use
export interface ParsedServing {
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodSearchResult {
  name: string;
  servingSize: string;
  servingQty: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foodId?: string;
  brandName?: string;
  dataSource?: 'usda' | 'fatsecret' | 'nutritionix';
  servings?: ParsedServing[];
  /** Weight (g, or ml for liquids) of `servingSize` when known. */
  servingGrams?: number;
}

// Extended version with serving options (returned by getFoodDetails)
export interface FoodSearchResultWithServings extends FoodSearchResult {
  servings: ParsedServing[];
}

interface USDAFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  gtinUpc?: string;
  foodNutrients: Array<{
    nutrientId: number;
    nutrientName: string;
    nutrientNumber: string;
    unitName: string;
    value: number;
  }>;
}

interface USDASearchResponse {
  foods: USDAFood[];
  totalHits: number;
  currentPage: number;
  totalPages: number;
}

interface USDAFoodDetailResponse {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients: Array<{
    nutrient: {
      id: number;
      name: string;
      unitName: string;
    };
    amount: number;
  }>;
  foodPortions?: Array<{
    id: number;
    gramWeight: number;
    amount: number;
    measureUnit?: {
      name: string;
    };
    modifier?: string;
    portionDescription?: string;
  }>;
}

// Nutrient IDs in USDA database
const NUTRIENT_IDS = {
  CALORIES: 1008,      // Energy (kcal)
  PROTEIN: 1003,       // Protein
  FAT: 1004,           // Total lipid (fat)
  CARBS: 1005,         // Carbohydrate, by difference
  FIBER: 1079,         // Fiber, total dietary
  SUGAR: 2000,         // Sugars, total
  SODIUM: 1093,        // Sodium
};

// Foundation foods often omit 1008 and report Atwater energy instead.
const ENERGY_NUTRIENT_IDS = [NUTRIENT_IDS.CALORIES, 2047, 2048];

export interface Per100Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Per-100g nutrition from a list of (nutrientId, value) pairs, or null when
 * the food carries no usable nutrition at all. A missing energy value is
 * derived from the macros (4/4/9) rather than silently becoming 0 kcal; a
 * food with neither energy nor macros is "no data", not a 0-calorie food.
 */
export function resolvePer100Nutrition(
  nutrients: Array<{ id: number | undefined; value: number | undefined }>
): Per100Nutrition | null {
  const find = (id: number): number | undefined => {
    const hit = nutrients.find((n) => n.id === id);
    return hit && typeof hit.value === 'number' && Number.isFinite(hit.value) ? hit.value : undefined;
  };

  let energy: number | undefined;
  for (const id of ENERGY_NUTRIENT_IDS) {
    energy = find(id);
    if (energy !== undefined) break;
  }
  const protein = find(NUTRIENT_IDS.PROTEIN);
  const carbs = find(NUTRIENT_IDS.CARBS);
  const fat = find(NUTRIENT_IDS.FAT);

  if (energy === undefined) {
    if (protein === undefined && carbs === undefined && fat === undefined) return null;
    energy = (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9;
  }

  return {
    calories: energy,
    protein: protein ?? 0,
    carbs: carbs ?? 0,
    fat: fat ?? 0,
  };
}

/**
 * The serving a search hit should be presented with.
 *
 * USDA search results report nutrients per 100 g (per 100 ml for liquids),
 * NOT per label serving. When the label serving has a known weight/volume we
 * return it with the factor that scales the per-100 values onto it; when it
 * doesn't (household text only, or an unknown unit) the food is presented
 * weight-anchored as "100g" so the text and the numbers always agree.
 */
export function resolveUsdaServing(food: {
  servingSize?: number;
  servingSizeUnit?: string;
}): { servingSize: string; factor: number; grams: number } {
  const size = typeof food.servingSize === 'number' ? food.servingSize : NaN;
  const unit = (food.servingSizeUnit || '').trim().toLowerCase();
  if (Number.isFinite(size) && size > 0) {
    if (unit === 'g' || unit === 'grm' || unit === 'gram' || unit === 'grams') {
      return { servingSize: `${size}g`, factor: size / 100, grams: size };
    }
    if (unit === 'ml' || unit === 'mlt' || unit === 'milliliter' || unit === 'milliliters') {
      return { servingSize: `${size}ml`, factor: size / 100, grams: size };
    }
  }
  return { servingSize: '100g', factor: 1, grams: 100 };
}

/** GTIN/UPC equality ignoring non-digits and zero padding (UPC-A vs EAN-13 vs GTIN-14). */
export function gtinMatches(a: string | undefined | null, b: string | undefined | null): boolean {
  const norm = (v: string | undefined | null) => (v || '').replace(/\D/g, '').replace(/^0+/, '');
  const na = norm(a);
  const nb = norm(b);
  return na.length >= 6 && na === nb;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Map a USDA search hit to a per-serving result, or null when it has no nutrition data. */
function mapSearchFood(food: USDAFood): FoodSearchResult | null {
  const per100 = resolvePer100Nutrition(
    (food.foodNutrients || []).map((n) => ({ id: n.nutrientId, value: n.value }))
  );
  if (!per100) return null;

  const serving = resolveUsdaServing(food);

  // Build display name with brand if available
  let displayName = food.description;
  if (food.brandOwner || food.brandName) {
    displayName = `${food.description} (${food.brandOwner || food.brandName})`;
  }

  return {
    name: displayName,
    servingSize: serving.servingSize,
    servingQty: 1,
    calories: Math.round(per100.calories * serving.factor),
    protein: round1(per100.protein * serving.factor),
    carbs: round1(per100.carbs * serving.factor),
    fat: round1(per100.fat * serving.factor),
    foodId: food.fdcId.toString(),
    brandName: food.brandOwner || food.brandName,
    dataSource: 'usda' as const,
    servingGrams: serving.grams,
  };
}

/**
 * Get USDA API key from environment
 */
function getApiKey(): string {
  return process.env.USDA_API_KEY || 'DEMO_KEY';
}

/**
 * Search for foods using USDA FoodData Central API
 */
export async function searchFoods(query: string): Promise<{
  foods: FoodSearchResult[];
  error?: string;
}> {
  try {
    if (!query || query.trim().length === 0) {
      return { foods: [], error: 'Please enter a search query' };
    }

    const apiKey = getApiKey();

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          pageSize: 25,
          pageNumber: 1,
          sortBy: 'dataType.keyword',
          sortOrder: 'asc',
          dataType: ['Branded', 'Survey (FNDDS)', 'Foundation', 'SR Legacy'],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('USDA API error:', response.status, errorText);

      if (response.status === 429) {
        return { foods: [], error: 'Rate limit exceeded. Please wait a moment and try again.' };
      }

      return { foods: [], error: 'Unable to search foods. Please try again.' };
    }

    const data: USDASearchResponse = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return { foods: [], error: 'No foods found matching your search' };
    }

    // Search hits are per 100 g; mapSearchFood scales them onto the label
    // serving and drops hits that carry no nutrition data at all.
    const foods: FoodSearchResult[] = data.foods
      .map(mapSearchFood)
      .filter((food): food is FoodSearchResult => food !== null);

    if (foods.length === 0) {
      return { foods: [], error: 'No foods found matching your search' };
    }

    return { foods };
  } catch (error) {
    console.error('USDA search error:', error);
    return {
      foods: [],
      error: 'Failed to search foods. Please try again.',
    };
  }
}

/**
 * Get detailed food information by USDA FDC ID
 */
export async function getFoodDetails(foodId: string): Promise<{
  food?: FoodSearchResult;
  error?: string;
}> {
  try {
    if (!foodId) {
      return { error: 'Invalid food ID' };
    }

    const apiKey = getApiKey();

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/food/${foodId}?api_key=${apiKey}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('USDA detail error:', response.status);
      return { error: 'Unable to get food details' };
    }

    const food: USDAFoodDetailResponse = await response.json();

    const per100 = resolvePer100Nutrition(
      (food.foodNutrients || []).map((n) => ({ id: n.nutrient?.id, value: n.amount }))
    );
    if (!per100) {
      // No energy and no macros: not a 0-calorie food, just no data.
      return { error: 'No nutrition data available for this food' };
    }
    const calories = round1(per100.calories);
    const protein = round1(per100.protein);
    const carbs = round1(per100.carbs);
    const fat = round1(per100.fat);

    // Build serving options from food portions
    const servings: ParsedServing[] = [];
    
    // Add 100g as default
    servings.push({
      description: '100g',
      calories: Math.round(calories),
      protein,
      carbs,
      fat,
    });

    // Add other portion options if available
    if (food.foodPortions) {
      food.foodPortions.forEach((portion) => {
        const gramWeight = portion.gramWeight || 100;
        const ratio = gramWeight / 100;
        
        let description = portion.portionDescription || portion.modifier || '';
        if (portion.measureUnit?.name) {
          description = `${portion.amount || 1} ${portion.measureUnit.name}`;
          if (portion.modifier) {
            description += ` (${portion.modifier})`;
          }
        }
        
        if (description && description !== '100g') {
          servings.push({
            description: `${description} (${Math.round(gramWeight)}g)`,
            calories: Math.round(calories * ratio),
            protein: Math.round(protein * ratio * 10) / 10,
            carbs: Math.round(carbs * ratio * 10) / 10,
            fat: Math.round(fat * ratio * 10) / 10,
          });
        }
      });
    }

    // The label serving (branded foods have no foodPortions) as an option.
    const labelServing = resolveUsdaServing(food);
    if (labelServing.servingSize !== '100g') {
      const household = food.householdServingFullText?.trim();
      const description = household
        ? `${household} (${labelServing.servingSize})`
        : labelServing.servingSize;
      if (!servings.some((s) => s.description === description)) {
        servings.push({
          description,
          calories: Math.round(calories * labelServing.factor),
          protein: round1(protein * labelServing.factor),
          carbs: round1(carbs * labelServing.factor),
          fat: round1(fat * labelServing.factor),
        });
      }
    }

    // The top-level macros below are per 100 g, so the serving text is too.
    const servingSize = '100g';

    let displayName = food.description;
    if (food.brandOwner || food.brandName) {
      displayName = `${food.description} (${food.brandOwner || food.brandName})`;
    }

    return {
      food: {
        name: displayName,
        servingSize,
        servingQty: 1,
        calories: Math.round(calories),
        protein,
        carbs,
        fat,
        foodId: food.fdcId.toString(),
        brandName: food.brandOwner || food.brandName,
        dataSource: 'usda',
        servings,
      },
    };
  } catch (error) {
    console.error('USDA detail error:', error);
    return {
      error: 'Failed to get food details',
    };
  }
}

/**
 * Lookup food by barcode/UPC using USDA API
 * Note: USDA has limited barcode data - will search by GTIN/UPC.
 * The result is PER SERVING (`servingSize` / `servingGrams`), like searchFoods.
 */
export async function lookupBarcode(barcode: string): Promise<{
  food?: FoodSearchResult;
  error?: string;
}> {
  try {
    if (!barcode || barcode.trim().length === 0) {
      return { error: 'Invalid barcode' };
    }

    const apiKey = getApiKey();

    // Search for the barcode in USDA (they store it as gtinUpc)
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: barcode.trim(),
          pageSize: 5,
          dataType: ['Branded'],
        }),
      }
    );

    if (!response.ok) {
      return { error: 'Unable to lookup barcode' };
    }

    const data: USDASearchResponse = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return { error: 'Product not found. Try searching by name.' };
    }

    // The search is full-text, so the first hit is not necessarily this
    // product: only accept a hit whose GTIN/UPC actually is the scanned code.
    const match = data.foods.find((f) => gtinMatches(f.gtinUpc, barcode));
    if (!match) {
      return { error: 'Product not found. Try searching by name.' };
    }

    const food = mapSearchFood(match);
    if (!food) {
      return { error: 'Product has no nutrition data. Try searching by name.' };
    }

    return { food };
  } catch (error) {
    console.error('USDA barcode error:', error);
    return {
      error: 'Barcode lookup failed. Try searching by name.',
    };
  }
}
