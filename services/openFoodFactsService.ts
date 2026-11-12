// Open Food Facts API Service - Free, open-source food database with barcode lookup
// Combined with USDA fallback for better coverage

import { lookupBarcode as lookupBarcodeUSDA } from './usdaService';

/**
 * Parse gram weight from a serving size string, or null when the text carries
 * no weight ("240ml", "1 bar", "1 cup").
 * Examples: "30g" -> 30, "1 cup (240g)" -> 240, "2 oz" -> 56.7, "1 bar" -> null
 */
export function parseGramsFromServingSize(servingSize: string): number | null {
  // Try to find grams pattern like "30g" or "(240g)"
  const gramsMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g(?:r|rams?)?\b/i);
  if (gramsMatch) {
    const grams = parseFloat(gramsMatch[1]);
    if (grams > 0) return grams;
  }

  // Try to find ounces and convert (not fluid ounces — that is a volume)
  const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch && !/fl\.?\s*oz/i.test(servingSize)) {
    const oz = parseFloat(ozMatch[1]);
    if (oz > 0) return oz * 28.3495;
  }

  return null;
}

export interface OpenFoodFactsProduct {
  code: string;
  product_name: string;
  brands?: string;
  serving_size?: string;
  // OFF nutriment keys vary by product ("proteins_serving", "proteins_100g",
  // "energy-kcal_serving", ...) and values are sometimes strings.
  nutriments: Record<string, number | string | undefined>;
  serving_quantity?: number | string;
  image_url?: string;
  image_small_url?: string;
}

/** Coerce OFF's number-or-numeric-string values; undefined when not parseable. */
function toFiniteNumber(value: unknown): number | undefined {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined;
}

export interface ExtractedNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

/**
 * Extract per-serving nutrition from an OFF nutriments object.
 *
 * Products frequently have a mix of `_serving` and `_100g` fields (e.g.
 * per-serving calories but only per-100g macros), so each nutrient falls
 * back independently: `<key>_serving` first, then `<key>_100g` scaled by
 * the serving weight. A single "has serving data" switch would zero out
 * whichever macros are missing their `_serving` variant.
 */
export function extractNutritionPerServing(
  nutriments: Record<string, number | string | undefined>,
  servingQuantityGrams: number
): ExtractedNutrition {
  const per100Factor = servingQuantityGrams / 100;

  const pick = (baseKey: string): number | undefined => {
    const perServing = toFiniteNumber(nutriments[`${baseKey}_serving`]);
    if (perServing !== undefined) return perServing;
    const per100 = toFiniteNumber(nutriments[`${baseKey}_100g`]);
    if (per100 !== undefined) return per100 * per100Factor;
    return undefined;
  };

  // Energy: prefer kcal fields; some products only report kJ ("energy_*")
  let calories = pick('energy-kcal');
  if (calories === undefined) {
    const kilojoules = pick('energy');
    if (kilojoules !== undefined) calories = kilojoules / 4.184;
  }

  const fiber = pick('fiber');

  const protein = pick('proteins');
  const carbs = pick('carbohydrates');
  const fat = pick('fat');

  // No energy field at all: derive it from the macros (4/4/9) rather than
  // reporting a 0-kcal food. (hasNutritionData() is the guard for products
  // with neither energy nor macros.)
  if (calories === undefined && (protein !== undefined || carbs !== undefined || fat !== undefined)) {
    calories = (protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9;
  }

  return {
    calories: Math.round(calories ?? 0),
    protein: Math.round((protein ?? 0) * 10) / 10,
    carbs: Math.round((carbs ?? 0) * 10) / 10,
    fat: Math.round((fat ?? 0) * 10) / 10,
    fiber: fiber !== undefined && fiber > 0 ? Math.round(fiber * 10) / 10 : undefined,
  };
}

const NUTRITION_BASE_KEYS = ['energy-kcal', 'energy', 'proteins', 'carbohydrates', 'fat'];

/**
 * True when the product reports energy or at least one macro. A product with
 * none of them has NO nutrition data — it must not be returned as a "found"
 * food with 0 kcal / 0 g (an explicit 0, e.g. water, still counts as data).
 */
export function hasNutritionData(nutriments: Record<string, number | string | undefined>): boolean {
  return NUTRITION_BASE_KEYS.some(
    (key) =>
      toFiniteNumber(nutriments[`${key}_serving`]) !== undefined ||
      toFiniteNumber(nutriments[`${key}_100g`]) !== undefined
  );
}

/**
 * Resolve the serving weight in grams: numeric `serving_quantity` first,
 * then a weight parsed out of the `serving_size` text, else 100g.
 */
export function resolveServingQuantity(product: {
  serving_quantity?: number | string;
  serving_size?: string;
}): number {
  const quantity = toFiniteNumber(product.serving_quantity);
  if (quantity !== undefined && quantity > 0) return quantity;
  if (product.serving_size) return parseGramsFromServingSize(product.serving_size) ?? 100;
  return 100;
}

export interface ResolvedServing {
  /** Serving text shown to the user; always agrees with the returned macros. */
  servingSize: string;
  /** Weight of that serving in grams (ml for liquids). */
  servingQuantity: number;
  nutrition: ExtractedNutrition;
}

/**
 * Resolve the serving a product is presented with, keeping the serving TEXT
 * and the macros on the same basis.
 *
 * - Serving weight known (numeric `serving_quantity`, or grams/oz in the
 *   text): the label serving, with per-serving nutrition.
 * - Serving weight unknown ("1 bar", "1 cup") but the product has `_100g`
 *   data: presented weight-anchored as "100g". Keeping "1 bar" while scaling
 *   the per-100 g values by an assumed 100 g would log 100 g as one bar.
 * - Serving weight unknown and only `_serving` data: the label serving with
 *   its per-serving values (the weight stays a 100 g placeholder).
 */
export function resolveProductServing(product: {
  serving_quantity?: number | string;
  serving_size?: string;
  nutriments?: Record<string, number | string | undefined>;
}): ResolvedServing {
  const nutriments = product.nutriments || {};
  const quantity = toFiniteNumber(product.serving_quantity);
  const knownGrams =
    quantity !== undefined && quantity > 0
      ? quantity
      : product.serving_size
        ? parseGramsFromServingSize(product.serving_size)
        : null;

  if (knownGrams != null) {
    return {
      servingSize: product.serving_size || `${knownGrams}g`,
      servingQuantity: knownGrams,
      nutrition: extractNutritionPerServing(nutriments, knownGrams),
    };
  }

  const per100Only: Record<string, number | string | undefined> = {};
  let hasPer100 = false;
  for (const [key, value] of Object.entries(nutriments)) {
    if (key.endsWith('_100g')) {
      per100Only[key] = value;
      if (NUTRITION_BASE_KEYS.some((base) => key === `${base}_100g`) && toFiniteNumber(value) !== undefined) {
        hasPer100 = true;
      }
    }
  }

  if (hasPer100) {
    return {
      servingSize: '100g',
      servingQuantity: 100,
      nutrition: extractNutritionPerServing(per100Only, 100),
    };
  }

  return {
    servingSize: product.serving_size || '1 serving',
    servingQuantity: 100,
    nutrition: extractNutritionPerServing(nutriments, 100),
  };
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

/** The USDA fallback: resolves a barcode to a PER-SERVING food. */
export type UsdaBarcodeLookup = (barcode: string) => Promise<{
  food?: {
    name: string;
    brandName?: string;
    servingSize: string;
    servingGrams?: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  error?: string;
}>;

export interface BarcodeLookupOptions {
  /**
   * Override the USDA fallback. Called from the browser the default runs
   * without the server-only USDA_API_KEY (i.e. on the shared DEMO_KEY), so
   * client callers should pass a server action that proxies the lookup.
   */
  usdaLookup?: UsdaBarcodeLookup;
}

// Session cache: product data is static, so repeat scans of the same barcode
// (or re-opening the scanner) skip the OFF/USDA round trips entirely.
const barcodeCache = new Map<string, { result: BarcodeSearchResult; expiresAt: number }>();
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
// Short TTL for misses: absorbs duplicate scans without blocking retries
// after a transient network failure (misses and failures look the same here).
const NOT_FOUND_TTL_MS = 30 * 1000;

/**
 * Look up a food product by its barcode
 * Tries Open Food Facts first (better international coverage), then falls back to USDA
 */
export async function lookupBarcode(
  barcode: string,
  options: BarcodeLookupOptions = {}
): Promise<BarcodeSearchResult> {
  // Clean the barcode - remove any non-numeric characters
  const cleanBarcode = barcode.replace(/\D/g, '');

  if (!cleanBarcode || cleanBarcode.length < 8) {
    return { found: false, error: `Invalid barcode (${cleanBarcode.length} digits) - must be at least 8` };
  }

  const cached = barcodeCache.get(cleanBarcode);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const result = await lookupBarcodeUncached(cleanBarcode, options.usdaLookup ?? lookupBarcodeUSDA);
  barcodeCache.set(cleanBarcode, {
    result,
    expiresAt: Date.now() + (result.found ? FOUND_TTL_MS : NOT_FOUND_TTL_MS),
  });
  return result;
}

async function lookupBarcodeUncached(
  cleanBarcode: string,
  usdaLookup: UsdaBarcodeLookup
): Promise<BarcodeSearchResult> {

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
    const usdaResult = await usdaLookup(cleanBarcode);

    if (usdaResult.food) {
      // The USDA lookup already returns per-serving values on a serving whose
      // text and weight agree (it falls back to "100g" when the label serving
      // has no usable weight), and only for a product whose GTIN matches.
      const servingGrams =
        usdaResult.food.servingGrams ??
        parseGramsFromServingSize(usdaResult.food.servingSize) ??
        100;

      return {
        found: true,
        product: {
          name: usdaResult.food.name,
          brand: usdaResult.food.brandName,
          servingSize: usdaResult.food.servingSize,
          servingQuantity: servingGrams,
          calories: usdaResult.food.calories,
          protein: usdaResult.food.protein,
          carbs: usdaResult.food.carbs,
          fat: usdaResult.food.fat,
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

    // A product page with no nutrition facts is not a usable food: report it
    // as not found (so the USDA fallback / "create custom food" path runs)
    // instead of a "found" 0-kcal item.
    if (!hasNutritionData(nutriments)) {
      return { found: false, error: 'Product has no nutrition data' };
    }

    const { servingSize, servingQuantity, nutrition } = resolveProductServing(product);
    const { calories, protein, carbs, fat, fiber } = nutrition;

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
        servingSize,
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
      if (!hasNutritionData(nutriments)) continue; // no data ≠ 0 kcal
      const { servingSize, servingQuantity, nutrition } = resolveProductServing(product);
      const { calories, protein, carbs, fat } = nutrition;

      let name = product.product_name || 'Unknown Product';
      if (product.brands && !name.toLowerCase().includes(product.brands.toLowerCase())) {
        name = `${product.brands} ${name}`;
      }

      products.push({
        name: name.trim(),
        brand: product.brands,
        servingSize,
        servingQuantity,
        calories,
        protein,
        carbs,
        fat,
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

