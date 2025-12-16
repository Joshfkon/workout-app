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

function extractNutrient(nutrients: USDAFood['foodNutrients'], nutrientId: number): number {
  const nutrient = nutrients.find(n => n.nutrientId === nutrientId);
  return nutrient ? Math.round(nutrient.value * 10) / 10 : 0;
}

function extractNutrientFromDetail(nutrients: USDAFoodDetailResponse['foodNutrients'], nutrientId: number): number {
  const nutrient = nutrients.find(n => n.nutrient?.id === nutrientId);
  return nutrient ? Math.round(nutrient.amount * 10) / 10 : 0;
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

    const foods: FoodSearchResult[] = data.foods.map((food) => {
      const calories = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CALORIES);
      const protein = extractNutrient(food.foodNutrients, NUTRIENT_IDS.PROTEIN);
      const carbs = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CARBS);
      const fat = extractNutrient(food.foodNutrients, NUTRIENT_IDS.FAT);

      // Determine serving size
      let servingSize = '100g';
      if (food.servingSize && food.servingSizeUnit) {
        servingSize = `${food.servingSize}${food.servingSizeUnit}`;
      } else if (food.householdServingFullText) {
        servingSize = food.householdServingFullText;
      }

      // Build display name with brand if available
      let displayName = food.description;
      if (food.brandOwner || food.brandName) {
        displayName = `${food.description} (${food.brandOwner || food.brandName})`;
      }

      return {
        name: displayName,
        servingSize,
        servingQty: 1,
        calories: Math.round(calories),
        protein,
        carbs,
        fat,
        foodId: food.fdcId.toString(),
        brandName: food.brandOwner || food.brandName,
        dataSource: 'usda' as const,
      };
    });

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

    const calories = extractNutrientFromDetail(food.foodNutrients, NUTRIENT_IDS.CALORIES);
    const protein = extractNutrientFromDetail(food.foodNutrients, NUTRIENT_IDS.PROTEIN);
    const carbs = extractNutrientFromDetail(food.foodNutrients, NUTRIENT_IDS.CARBS);
    const fat = extractNutrientFromDetail(food.foodNutrients, NUTRIENT_IDS.FAT);

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

    // Default serving size
    let servingSize = '100g';
    if (food.servingSize && food.servingSizeUnit) {
      servingSize = `${food.servingSize}${food.servingSizeUnit}`;
    } else if (food.householdServingFullText) {
      servingSize = food.householdServingFullText;
    }

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
 * Note: USDA has limited barcode data - will search by GTIN/UPC
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

    // Return the first match
    const food = data.foods[0];
    const calories = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CALORIES);
    const protein = extractNutrient(food.foodNutrients, NUTRIENT_IDS.PROTEIN);
    const carbs = extractNutrient(food.foodNutrients, NUTRIENT_IDS.CARBS);
    const fat = extractNutrient(food.foodNutrients, NUTRIENT_IDS.FAT);

    let servingSize = '100g';
    if (food.servingSize && food.servingSizeUnit) {
      servingSize = `${food.servingSize}${food.servingSizeUnit}`;
    }

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
      },
    };
  } catch (error) {
    console.error('USDA barcode error:', error);
    return {
      error: 'Barcode lookup failed. Try searching by name.',
    };
  }
}
