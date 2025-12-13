'use server';

/**
 * Nutrition API Server Actions
 *
 * Handles integration with Nutritionix API for food search and barcode lookup.
 * API keys are kept server-side for security.
 */

interface NutritionixNutrient {
  food_name: string;
  serving_qty: number;
  serving_unit: string;
  serving_weight_grams?: number;
  nf_calories: number;
  nf_protein: number;
  nf_total_carbohydrate: number;
  nf_total_fat: number;
  nix_item_id?: string;
  upc?: string;
  photo?: {
    thumb?: string;
  };
}

interface NutritionixSearchResponse {
  foods: NutritionixNutrient[];
}

interface NutritionixBarcodeResponse {
  foods: NutritionixNutrient[];
}

export interface FoodSearchResult {
  name: string;
  servingSize: string;
  servingQty: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  nutritionixId?: string;
  photoUrl?: string;
}

/**
 * Search for foods using natural language query
 * Example: "2 eggs and toast"
 */
export async function searchFoods(query: string): Promise<{
  foods: FoodSearchResult[];
  error?: string
}> {
  try {
    if (!query || query.trim().length === 0) {
      return { foods: [], error: 'Please enter a search query' };
    }

    const appId = process.env.NUTRITIONIX_APP_ID;
    const apiKey = process.env.NUTRITIONIX_API_KEY;

    if (!appId || !apiKey) {
      console.error('Nutritionix API credentials not configured');
      return {
        foods: [],
        error: 'Nutrition search is not configured. Please contact support.'
      };
    }

    const response = await fetch('https://trackapi.nutritionix.com/v2/natural/nutrients', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-id': appId,
        'x-app-key': apiKey,
      },
      body: JSON.stringify({ query: query.trim() }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Nutritionix API error:', response.status, errorText);

      if (response.status === 404) {
        return { foods: [], error: 'No foods found matching your search' };
      }

      return {
        foods: [],
        error: 'Unable to search foods. Please try again.'
      };
    }

    const data: NutritionixSearchResponse = await response.json();

    const foods: FoodSearchResult[] = data.foods.map((food) => ({
      name: food.food_name,
      servingSize: `${food.serving_qty} ${food.serving_unit}`,
      servingQty: food.serving_qty,
      calories: Math.round(food.nf_calories),
      protein: Math.round(food.nf_protein * 10) / 10,
      carbs: Math.round(food.nf_total_carbohydrate * 10) / 10,
      fat: Math.round(food.nf_total_fat * 10) / 10,
      nutritionixId: food.nix_item_id,
      photoUrl: food.photo?.thumb,
    }));

    return { foods };
  } catch (error) {
    console.error('Error searching foods:', error);
    return {
      foods: [],
      error: 'An unexpected error occurred. Please try again.'
    };
  }
}

/**
 * Look up food by barcode/UPC
 */
export async function lookupBarcode(barcode: string): Promise<{
  food?: FoodSearchResult;
  error?: string
}> {
  try {
    if (!barcode || barcode.trim().length === 0) {
      return { error: 'Invalid barcode' };
    }

    const appId = process.env.NUTRITIONIX_APP_ID;
    const apiKey = process.env.NUTRITIONIX_API_KEY;

    if (!appId || !apiKey) {
      console.error('Nutritionix API credentials not configured');
      return {
        error: 'Barcode lookup is not configured. Please contact support.'
      };
    }

    const response = await fetch(
      `https://trackapi.nutritionix.com/v2/search/item?upc=${encodeURIComponent(barcode.trim())}`,
      {
        method: 'GET',
        headers: {
          'x-app-id': appId,
          'x-app-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'Product not found. Try searching by name or add manually.' };
      }

      console.error('Nutritionix barcode lookup error:', response.status);
      return { error: 'Unable to lookup barcode. Please try again.' };
    }

    const data: NutritionixBarcodeResponse = await response.json();

    if (!data.foods || data.foods.length === 0) {
      return { error: 'Product not found. Try searching by name or add manually.' };
    }

    const food = data.foods[0];

    return {
      food: {
        name: food.food_name,
        servingSize: `${food.serving_qty} ${food.serving_unit}`,
        servingQty: food.serving_qty,
        calories: Math.round(food.nf_calories),
        protein: Math.round(food.nf_protein * 10) / 10,
        carbs: Math.round(food.nf_total_carbohydrate * 10) / 10,
        fat: Math.round(food.nf_total_fat * 10) / 10,
        nutritionixId: food.nix_item_id,
        photoUrl: food.photo?.thumb,
      },
    };
  } catch (error) {
    console.error('Error looking up barcode:', error);
    return { error: 'An unexpected error occurred. Please try again.' };
  }
}
