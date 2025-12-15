/**
 * FatSecret API Service
 * 
 * Handles OAuth 2.0 authentication and food search using FatSecret Platform API.
 * Uses Client Credentials Grant for server-to-server authentication.
 */

interface FatSecretTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export interface FatSecretServing {
  serving_id: string;
  serving_description: string;
  serving_url: string;
  metric_serving_amount?: string;
  metric_serving_unit?: string;
  number_of_units?: string;
  measurement_description?: string;
  calories?: string;
  carbohydrate?: string;
  protein?: string;
  fat?: string;
  saturated_fat?: string;
  polyunsaturated_fat?: string;
  monounsaturated_fat?: string;
  cholesterol?: string;
  sodium?: string;
  potassium?: string;
  fiber?: string;
  sugar?: string;
}

// Parsed serving for UI use
export interface ParsedServing {
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface FatSecretFood {
  food_id: string;
  food_name: string;
  food_type: string;
  brand_name?: string;
  food_url: string;
  food_description?: string;
  servings?: {
    serving: FatSecretServing | FatSecretServing[];
  };
}

interface FatSecretSearchResult {
  foods?: {
    food: FatSecretFood | FatSecretFood[];
    max_results: string;
    page_number: string;
    total_results: string;
  };
}

interface FatSecretFoodResponse {
  food: FatSecretFood;
}

// Token cache
let cachedToken: {
  accessToken: string;
  expiresAt: number;
} | null = null;

/**
 * Get access token using Client Credentials Grant
 */
async function getAccessToken(): Promise<string> {
  // Check if we have a valid cached token (with 5 min buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 300000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.FATSECRET_CLIENT_ID;
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('FatSecret API credentials not configured');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('FatSecret token error:', response.status, errorText);
    throw new Error('Failed to authenticate with FatSecret');
  }

  const data: FatSecretTokenResponse = await response.json();

  // Cache the token
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  return data.access_token;
}

/**
 * Make authenticated API request to FatSecret
 */
async function fatSecretRequest<T>(
  method: string,
  params: Record<string, string> = {}
): Promise<T> {
  const accessToken = await getAccessToken();

  const searchParams = new URLSearchParams({
    method,
    format: 'json',
    ...params,
  });

  const response = await fetch('https://platform.fatsecret.com/rest/server.api', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: searchParams.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('FatSecret API error:', response.status, errorText);
    throw new Error(`FatSecret API error: ${response.status}`);
  }

  return response.json();
}

export interface FoodSearchResult {
  name: string;
  servingSize: string;
  servingQty: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foodId: string;
  brandName?: string;
  photoUrl?: string;
  dataSource?: 'fatsecret' | 'usda' | 'nutritionix';
}

// Extended version with serving options (returned by getFoodDetails)
export interface FoodSearchResultWithServings extends FoodSearchResult {
  servings: ParsedServing[];
}

/**
 * Search for foods by name
 */
export async function searchFoods(
  query: string,
  pageNumber: number = 0,
  maxResults: number = 20
): Promise<{
  foods: FoodSearchResult[];
  totalResults: number;
  error?: string;
}> {
  try {
    if (!query || query.trim().length === 0) {
      return { foods: [], totalResults: 0, error: 'Please enter a search query' };
    }

    const data = await fatSecretRequest<FatSecretSearchResult>('foods.search', {
      search_expression: query.trim(),
      page_number: pageNumber.toString(),
      max_results: maxResults.toString(),
    });

    if (!data.foods || !data.foods.food) {
      return { foods: [], totalResults: 0 };
    }

    // Handle single result vs array
    const foodsArray = Array.isArray(data.foods.food) 
      ? data.foods.food 
      : [data.foods.food];

    const foods: FoodSearchResult[] = foodsArray.map((food) => {
      // Parse the food_description to extract nutrition info
      // Format: "Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g"
      const desc = food.food_description || '';
      const servingMatch = desc.match(/^Per (.+?) -/);
      const caloriesMatch = desc.match(/Calories:\s*([\d.]+)/);
      const fatMatch = desc.match(/Fat:\s*([\d.]+)/);
      const carbsMatch = desc.match(/Carbs:\s*([\d.]+)/);
      const proteinMatch = desc.match(/Protein:\s*([\d.]+)/);

      return {
        name: food.brand_name 
          ? `${food.food_name} (${food.brand_name})`
          : food.food_name,
        servingSize: servingMatch ? servingMatch[1] : '1 serving',
        servingQty: 1,
        calories: caloriesMatch ? Math.round(parseFloat(caloriesMatch[1])) : 0,
        protein: proteinMatch ? Math.round(parseFloat(proteinMatch[1]) * 10) / 10 : 0,
        carbs: carbsMatch ? Math.round(parseFloat(carbsMatch[1]) * 10) / 10 : 0,
        fat: fatMatch ? Math.round(parseFloat(fatMatch[1]) * 10) / 10 : 0,
        foodId: food.food_id,
        brandName: food.brand_name,
      };
    });

    return {
      foods,
      totalResults: parseInt(data.foods.total_results || '0', 10),
    };
  } catch (error) {
    console.error('Error searching foods:', error);
    return {
      foods: [],
      totalResults: 0,
      error: error instanceof Error ? error.message : 'Search failed',
    };
  }
}

/**
 * Get detailed food information by ID
 */
export async function getFoodDetails(
  foodId: string
): Promise<{
  food?: FoodSearchResultWithServings;
  error?: string;
}> {
  try {
    if (!foodId) {
      return { error: 'Invalid food ID' };
    }

    const data = await fatSecretRequest<FatSecretFoodResponse>('food.get.v4', {
      food_id: foodId,
    });

    if (!data.food) {
      return { error: 'Food not found' };
    }

    const food = data.food;
    const servingsArray = food.servings?.serving
      ? (Array.isArray(food.servings.serving) 
          ? food.servings.serving 
          : [food.servings.serving])
      : [];

    // Parse servings into a simpler format
    const parsedServings: ParsedServing[] = servingsArray.map((s) => ({
      description: s.serving_description || '1 serving',
      calories: Math.round(parseFloat(s.calories || '0')),
      protein: Math.round(parseFloat(s.protein || '0') * 10) / 10,
      carbs: Math.round(parseFloat(s.carbohydrate || '0') * 10) / 10,
      fat: Math.round(parseFloat(s.fat || '0') * 10) / 10,
    }));

    // Get the first serving for default values
    const defaultServing = parsedServings[0];

    return {
      food: {
        name: food.brand_name 
          ? `${food.food_name} (${food.brand_name})`
          : food.food_name,
        servingSize: defaultServing?.description || '1 serving',
        servingQty: 1,
        calories: defaultServing?.calories || 0,
        protein: defaultServing?.protein || 0,
        carbs: defaultServing?.carbs || 0,
        fat: defaultServing?.fat || 0,
        foodId: food.food_id,
        brandName: food.brand_name,
        servings: parsedServings,
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
 * Search for foods by barcode/UPC
 */
export async function lookupBarcode(
  barcode: string
): Promise<{
  food?: FoodSearchResult;
  error?: string;
}> {
  try {
    if (!barcode || barcode.trim().length === 0) {
      return { error: 'Invalid barcode' };
    }

    const data = await fatSecretRequest<FatSecretFoodResponse>('food.find_id_for_barcode', {
      barcode: barcode.trim(),
    });

    if (!data.food) {
      return { error: 'Product not found. Try searching by name or add manually.' };
    }

    // Get full food details
    return getFoodDetails(data.food.food_id);
  } catch (error) {
    console.error('Error looking up barcode:', error);
    return {
      error: error instanceof Error ? error.message : 'Barcode lookup failed',
    };
  }
}

/**
 * Get autocomplete suggestions for food search
 */
export async function getAutocompleteSuggestions(
  query: string,
  maxResults: number = 10
): Promise<{
  suggestions: string[];
  error?: string;
}> {
  try {
    if (!query || query.trim().length < 2) {
      return { suggestions: [] };
    }

    const data = await fatSecretRequest<{ suggestions?: { suggestion: string[] } }>('foods.autocomplete', {
      expression: query.trim(),
      max_results: maxResults.toString(),
    });

    return {
      suggestions: data.suggestions?.suggestion || [],
    };
  } catch (error) {
    console.error('Error getting autocomplete suggestions:', error);
    return {
      suggestions: [],
      error: error instanceof Error ? error.message : 'Autocomplete failed',
    };
  }
}

