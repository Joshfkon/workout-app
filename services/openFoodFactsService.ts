// Open Food Facts API Service - Free, open-source food database with barcode lookup
// Combined with USDA fallback for better coverage

import { lookupBarcode as lookupBarcodeUSDA } from './usdaService';

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
    return { found: false, error: 'Invalid barcode - must be at least 8 digits' };
  }

  // Try Open Food Facts first
  const offResult = await lookupBarcodeOpenFoodFacts(cleanBarcode);
  if (offResult.found && offResult.product) {
    return offResult;
  }

  // Fall back to USDA if not found in Open Food Facts
  console.log('Product not found in Open Food Facts, trying USDA...');
  const usdaResult = await lookupBarcodeUSDA(cleanBarcode);
  
  if (usdaResult.food) {
    return {
      found: true,
      product: {
        name: usdaResult.food.name,
        brand: usdaResult.food.brandName,
        servingSize: usdaResult.food.servingSize,
        servingQuantity: 100,
        calories: usdaResult.food.calories,
        protein: usdaResult.food.protein,
        carbs: usdaResult.food.carbs,
        fat: usdaResult.food.fat,
        barcode: cleanBarcode,
      },
    };
  }

  // Neither found it
  return { 
    found: false, 
    error: 'Product not found in our databases. Try searching by name instead.' 
  };
}

/**
 * Look up a food product by its barcode using Open Food Facts API
 */
async function lookupBarcodeOpenFoodFacts(cleanBarcode: string): Promise<BarcodeSearchResult> {
  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${cleanBarcode}.json`,
      {
        headers: {
          'User-Agent': 'HyperTrack-App/1.0 (https://hypertrack.app)',
        },
      }
    );

    if (!response.ok) {
      return { found: false, error: 'Failed to fetch product data' };
    }

    const data = await response.json();

    if (data.status !== 1 || !data.product) {
      return { found: false, error: 'Product not found in Open Food Facts' };
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
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${limit}`,
      {
        headers: {
          'User-Agent': 'HyperTrack-App/1.0 (https://hypertrack.app)',
        },
      }
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

