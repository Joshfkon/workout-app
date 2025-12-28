// Open Food Facts API Service - Free, open-source food database with barcode lookup
// Combined with USDA fallback for better coverage

import { lookupBarcode as lookupBarcodeUSDA } from './usdaService';

/**
 * Parse gram weight from a serving size string
 * Examples: "30g" -> 30, "100g" -> 100, "1 cup (240g)" -> 240, "2 oz" -> 56.7
 */
function parseGramsFromServingSize(servingSize: string): number {
  // Try to find grams pattern like "30g" or "(240g)"
  const gramsMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?/i);
  if (gramsMatch) {
    return parseFloat(gramsMatch[1]);
  }

  // Try to find ounces and convert
  const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (ozMatch) {
    return parseFloat(ozMatch[1]) * 28.3495;
  }

  // Default to 100g if can't parse
  return 100;
}

export interface OpenFoodFactsProduct {
  code: string;
  product_name: string;
  brands?: string;
  serving_size?: string;
  nutriments: {
    'energy-kcal_100g'?: number;
    'energy-kcal_serving'?: number;
    proteins_100g?: number;
    proteins_serving?: number;
    carbohydrates_100g?: number;
    carbohydrates_serving?: number;
    fat_100g?: number;
    fat_serving?: number;
    fiber_100g?: number;
    sugars_100g?: number;
    sodium_100g?: number;
  };
  serving_quantity?: number;
  image_url?: string;
  image_small_url?: string;
}

export interface BarcodeSearchResult {
  found: boolean;
  product?: {
    name: string;
    brand?: string;
    servingSize: string;
    servingQuantity: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
    imageUrl?: string;
    barcode: string;
  };
  error?: string;
}

/**
 * Look up a food product by its barcode
 * Tries Open Food Facts first (better international coverage), then falls back to USDA
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeSearchResult> {
  // Clean the barcode - remove any non-numeric characters
  const cleanBarcode = barcode.replace(/\D/g, '');
  
  if (!cleanBarcode || cleanBarcode.length < 8) {
    return { found: false, error: `Invalid barcode (${cleanBarcode.length} digits) - must be at least 8` };
  }

  let offError: string | undefined;
  let usdaError: string | undefined;

  // Try Open Food Facts first
  try {
    const offResult = await lookupBarcodeOpenFoodFacts(cleanBarcode);
    if (offResult.found && offResult.product) {
      return { ...offResult, error: undefined };
    }
    offError = offResult.error;
  } catch (err) {
    offError = `OFF exception: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Fall back to USDA if not found in Open Food Facts
  try {
    const usdaResult = await lookupBarcodeUSDA(cleanBarcode);

    if (usdaResult.food) {
      // USDA returns nutrition per 100g, but servingSize may differ
      // Parse the actual gram weight and scale nutrition accordingly
      const servingGrams = parseGramsFromServingSize(usdaResult.food.servingSize);
      const scaleFactor = servingGrams / 100;

      return {
        found: true,
        product: {
          name: usdaResult.food.name,
          brand: usdaResult.food.brandName,
          servingSize: usdaResult.food.servingSize,
          servingQuantity: servingGrams,
          // Scale nutrition from per-100g to per-serving
          calories: Math.round(usdaResult.food.calories * scaleFactor),
          protein: Math.round(usdaResult.food.protein * scaleFactor * 10) / 10,
          carbs: Math.round(usdaResult.food.carbs * scaleFactor * 10) / 10,
          fat: Math.round(usdaResult.food.fat * scaleFactor * 10) / 10,
          barcode: cleanBarcode,
        },
      };
    }
    usdaError = usdaResult.error;
  } catch (err) {
    usdaError = `USDA exception: ${err instanceof Error ? err.message : String(err)}`;
  }

  // Neither found it - return detailed error for debugging
  const errorDetails = [
    offError ? `OFF: ${offError}` : 'OFF: not found',
    usdaError ? `USDA: ${usdaError}` : 'USDA: not found',
  ].join(' | ');
  
  return { 
    found: false, 
    error: errorDetails
  };
}

/**
 * Look up a food product by its barcode using Open Food Facts API
 */
async function lookupBarcodeOpenFoodFacts(cleanBarcode: string): Promise<BarcodeSearchResult> {
  try {
    // Note: Can't set User-Agent in browser due to CORS, but Open Food Facts works without it
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${cleanBarcode}.json`
    );

    if (!response.ok) {
      console.error('Open Food Facts API error:', response.status, response.statusText);
      return { found: false, error: `API error: ${response.status}` };
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      // Not an error, just not found in this database
      return { found: false };
    }

    const product: OpenFoodFactsProduct = data.product;
    const nutriments = product.nutriments || {};

    // Calculate per serving or per 100g
    const hasServingData = nutriments['energy-kcal_serving'] !== undefined;
    const servingQuantity = product.serving_quantity || 100;
    
    let calories: number;
    let protein: number;
    let carbs: number;
    let fat: number;
    let fiber: number | undefined;

    if (hasServingData) {
      // Use per-serving values if available
      calories = Math.round(nutriments['energy-kcal_serving'] || 0);
      protein = Math.round((nutriments.proteins_serving || 0) * 10) / 10;
      carbs = Math.round((nutriments.carbohydrates_serving || 0) * 10) / 10;
      fat = Math.round((nutriments.fat_serving || 0) * 10) / 10;
    } else {
      // Calculate from per 100g values
      const factor = servingQuantity / 100;
      calories = Math.round((nutriments['energy-kcal_100g'] || 0) * factor);
      protein = Math.round((nutriments.proteins_100g || 0) * factor * 10) / 10;
      carbs = Math.round((nutriments.carbohydrates_100g || 0) * factor * 10) / 10;
      fat = Math.round((nutriments.fat_100g || 0) * factor * 10) / 10;
      fiber = nutriments.fiber_100g ? Math.round((nutriments.fiber_100g || 0) * factor * 10) / 10 : undefined;
    }

    // Build product name
    let name = product.product_name || 'Unknown Product';
    if (product.brands && !name.toLowerCase().includes(product.brands.toLowerCase())) {
      name = `${product.brands} ${name}`;
    }

    return {
      found: true,
      product: {
        name: name.trim(),
        brand: product.brands,
        servingSize: product.serving_size || `${servingQuantity}g`,
        servingQuantity,
        calories,
        protein,
        carbs,
        fat,
        fiber,
        imageUrl: product.image_small_url || product.image_url,
        barcode: cleanBarcode,
      },
    };
  } catch (error) {
    console.error('Open Food Facts barcode lookup error:', error);
    return { 
      found: false, 
      error: error instanceof Error ? error.message : 'Failed to look up barcode' 
    };
  }
}

/**
 * Search Open Food Facts by product name
 */
export async function searchOpenFoodFacts(query: string, limit: number = 10): Promise<BarcodeSearchResult['product'][]> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${limit}`
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    const products: BarcodeSearchResult['product'][] = [];

    for (const product of data.products || []) {
      const nutriments = product.nutriments || {};
      const servingQuantity = product.serving_quantity || 100;
      const factor = servingQuantity / 100;

      let name = product.product_name || 'Unknown Product';
      if (product.brands && !name.toLowerCase().includes(product.brands.toLowerCase())) {
        name = `${product.brands} ${name}`;
      }

      products.push({
        name: name.trim(),
        brand: product.brands,
        servingSize: product.serving_size || `${servingQuantity}g`,
        servingQuantity,
        calories: Math.round((nutriments['energy-kcal_100g'] || 0) * factor),
        protein: Math.round((nutriments.proteins_100g || 0) * factor * 10) / 10,
        carbs: Math.round((nutriments.carbohydrates_100g || 0) * factor * 10) / 10,
        fat: Math.round((nutriments.fat_100g || 0) * factor * 10) / 10,
        imageUrl: product.image_small_url || product.image_url,
        barcode: product.code,
      });
    }

    return products;
  } catch (error) {
    console.error('Open Food Facts search error:', error);
    return [];
  }
}

