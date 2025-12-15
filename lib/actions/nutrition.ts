'use server';

/**
 * Nutrition API Server Actions
 *
 * Primary: USDA FoodData Central API (free, no IP restrictions)
 * Fallback: FatSecret Platform API (if configured and whitelisted)
 */

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
  dataSource?: 'usda' | 'fatsecret';
  servings?: Array<{
    id: string;
    description: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>;
}

// ============================================================
// USDA FoodData Central API (Primary - No IP Restrictions!)
// ============================================================

interface USDAFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  brandName?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
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

function extractNutrient(nutrients: USDAFood['foodNutrients'], nutrientId: number): number {
  const nutrient = nutrients.find(n => n.nutrientId === nutrientId);
  return nutrient ? Math.round(nutrient.value * 10) / 10 : 0;
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

    // USDA API Key (free, get one at https://fdc.nal.usda.gov/api-key-signup.html)
    const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';

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

    const foods: FoodSearchResult[] = data.foods.map((food) => {
      const calories = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CALORIES);
      const protein = extractNutrient(food.foodNutrients, NUTRIENT_IDS.PROTEIN);
      const carbs = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CARBS);
      const fat = extractNutrient(food.foodNutrients, NUTRIENT_IDS.FAT);

      // Serving size - USDA uses 100g as base, but branded foods have serving sizes
      let servingSize = '100g';
      let servingMultiplier = 1;

      if (food.servingSize && food.servingSizeUnit) {
        servingSize = `${food.servingSize}${food.servingSizeUnit}`;
        servingMultiplier = food.servingSize / 100;
      }

      // Clean up the food name
      let name = food.description;
      if (food.brandName || food.brandOwner) {
        const brand = food.brandName || food.brandOwner;
        // Don't duplicate if brand is already in name
        if (!name.toLowerCase().includes(brand?.toLowerCase() || '')) {
          name = `${name} (${brand})`;
        }
      }

      return {
        name,
        servingSize,
        servingQty: 1,
        calories: Math.round(calories * servingMultiplier),
        protein: Math.round(protein * servingMultiplier * 10) / 10,
        carbs: Math.round(carbs * servingMultiplier * 10) / 10,
        fat: Math.round(fat * servingMultiplier * 10) / 10,
        foodId: food.fdcId.toString(),
        brandName: food.brandName || food.brandOwner,
        dataSource: 'usda',
      };
    });

    return { foods };
  } catch (error) {
    console.error('Error searching foods:', error);
    return {
      foods: [],
      error: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.',
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

    const apiKey = process.env.USDA_API_KEY || 'DEMO_KEY';

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
      return { error: 'Food not found' };
    }

    const food: USDAFood = await response.json();

    const calories = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CALORIES);
    const protein = extractNutrient(food.foodNutrients, NUTRIENT_IDS.PROTEIN);
    const carbs = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CARBS);
    const fat = extractNutrient(food.foodNutrients, NUTRIENT_IDS.FAT);

    let servingSize = '100g';
    let servingMultiplier = 1;

    if (food.servingSize && food.servingSizeUnit) {
      servingSize = `${food.servingSize}${food.servingSizeUnit}`;
      servingMultiplier = food.servingSize / 100;
    }

    // Create serving options
    const servings = [
      {
        id: '100g',
        description: '100g',
        calories: Math.round(calories),
        protein: Math.round(protein * 10) / 10,
        carbs: Math.round(carbs * 10) / 10,
        fat: Math.round(fat * 10) / 10,
      },
    ];

    // Add actual serving size if different from 100g
    if (food.servingSize && food.servingSize !== 100) {
      servings.unshift({
        id: 'serving',
        description: servingSize,
        calories: Math.round(calories * servingMultiplier),
        protein: Math.round(protein * servingMultiplier * 10) / 10,
        carbs: Math.round(carbs * servingMultiplier * 10) / 10,
        fat: Math.round(fat * servingMultiplier * 10) / 10,
      });
    }

    let name = food.description;
    if (food.brandName || food.brandOwner) {
      const brand = food.brandName || food.brandOwner;
      if (!name.toLowerCase().includes(brand?.toLowerCase() || '')) {
        name = `${name} (${brand})`;
      }
    }

    return {
      food: {
        name,
        servingSize: servings[0].description,
        servingQty: 1,
        calories: servings[0].calories,
        protein: servings[0].protein,
        carbs: servings[0].carbs,
        fat: servings[0].fat,
        foodId: food.fdcId.toString(),
        brandName: food.brandName || food.brandOwner,
        dataSource: 'usda',
        servings,
      },
    };
  } catch (error) {
    console.error('Error getting food details:', error);
    return {
      error: error instanceof Error ? error.message : 'Failed to get food details',
    };
  }
}

/**
 * Look up food by barcode/UPC using Open Food Facts (free, no auth)
 */
export async function lookupBarcode(barcode: string): Promise<{
  food?: FoodSearchResult;
  error?: string;
}> {
  try {
    if (!barcode || barcode.trim().length === 0) {
      return { error: 'Invalid barcode' };
    }

    // Use Open Food Facts API (free, no auth required)
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode.trim()}.json`,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'WorkoutApp/1.0',
        },
      }
    );

    if (!response.ok) {
      return { error: 'Product not found. Try searching by name or add manually.' };
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      return { error: 'Product not found. Try searching by name or add manually.' };
    }

    const product = data.product;
    const nutriments = product.nutriments || {};

    // Get serving size
    let servingSize = product.serving_size || '100g';
    let servingMultiplier = 1;

    // Use per-serving values if available, otherwise use per 100g
    const hasServingValues = nutriments['energy-kcal_serving'] !== undefined;

    const calories = hasServingValues
      ? nutriments['energy-kcal_serving'] || 0
      : (nutriments['energy-kcal_100g'] || nutriments['energy-kcal'] || 0);

    const protein = hasServingValues
      ? nutriments['proteins_serving'] || 0
      : (nutriments['proteins_100g'] || nutriments['proteins'] || 0);

    const carbs = hasServingValues
      ? nutriments['carbohydrates_serving'] || 0
      : (nutriments['carbohydrates_100g'] || nutriments['carbohydrates'] || 0);

    const fat = hasServingValues
      ? nutriments['fat_serving'] || 0
      : (nutriments['fat_100g'] || nutriments['fat'] || 0);

    return {
      food: {
        name: product.product_name || 'Unknown Product',
        servingSize: hasServingValues ? servingSize : '100g',
        servingQty: 1,
        calories: Math.round(calories),
        protein: Math.round(protein * 10) / 10,
        carbs: Math.round(carbs * 10) / 10,
        fat: Math.round(fat * 10) / 10,
        foodId: barcode,
        brandName: product.brands,
        dataSource: 'usda', // Using 'usda' for compatibility
      },
    };
  } catch (error) {
    console.error('Error looking up barcode:', error);
    return { error: 'An unexpected error occurred. Please try again.' };
  }
}

/**
 * Get autocomplete suggestions (simple prefix matching from recent search)
 */
export async function getAutocompleteSuggestions(query: string): Promise<{
  suggestions: string[];
  error?: string;
}> {
  // USDA doesn't have autocomplete, so we just return empty
  // The UI can cache recent searches client-side
  return { suggestions: [] };
}
