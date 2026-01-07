/**
 * Unified Weight Utility Service
 * 
 * This is the SINGLE SOURCE OF TRUTH for all weight operations in the app.
 * All weight validation, conversion, and formatting should use these functions.
 * 
 * Database Storage Policy:
 * - Weights are stored in the database with a `weight` value and `unit` field ('lb' or 'kg')
 * - The `weight` value should be the actual weight in the specified unit
 * - This utility validates and corrects unit errors when reading from the database
 */

// Correct naming: 1 kg = 2.20462 lbs, so KG_TO_LBS = 2.20462
const KG_TO_LBS = 2.20462;
// 1 lb = ~0.453592 kg, so LBS_TO_KG = 1 / 2.20462
const LBS_TO_KG = 1 / KG_TO_LBS;

/**
 * Weight validation and correction rules:
 * - Weights 30-85 lbs labeled as 'lb' are likely in kg (common human weight range)
 * - Weights > 300 lbs labeled as 'lb' are suspicious (check if dividing by 2.20462 gives reasonable kg)
 * - Weights 30-150 kg labeled as 'kg' are likely in lbs (common human weight range)
 * - Weights > 200 kg labeled as 'kg' are suspicious
 */

interface ValidatedWeight {
  /** The corrected weight value in the original unit */
  weight: number;
  /** The corrected unit */
  unit: 'lb' | 'kg';
  /** Whether the weight was corrected */
  wasCorrected: boolean;
  /** The original weight before correction */
  originalWeight: number;
  /** The original unit before correction */
  originalUnit: 'lb' | 'kg' | null;
}

/**
 * Validates and corrects a weight entry from the database.
 * This function detects common unit errors and corrects them.
 * 
 * @param weight - The weight value from the database
 * @param unit - The unit from the database ('lb', 'kg', or null)
 * @returns Validated weight with corrected value and unit
 */
export function validateWeightEntry(
  weight: number,
  unit: 'lb' | 'kg' | null | undefined
): ValidatedWeight {
  const originalWeight = weight;
  const originalUnit = (unit || 'lb') as 'lb' | 'kg';
  let correctedWeight = weight;
  let correctedUnit = originalUnit;
  let wasCorrected = false;

  // Handle null/undefined unit
  if (!unit) {
    // If no unit specified, try to infer from weight value
    if (weight >= 30 && weight <= 200) {
      // Likely in lbs (common human weight range)
      correctedUnit = 'lb';
    } else if (weight > 200 && weight < 500) {
      // Could be either - check if converting lbs to kg gives reasonable value
      const asKg = weight * LBS_TO_KG;
      if (asKg >= 100 && asKg <= 200) {
        // Treating as kg gives reasonable value, so it's probably in kg
        correctedUnit = 'kg';
        wasCorrected = true;
      } else {
        correctedUnit = 'lb';
      }
    } else {
      correctedUnit = 'lb';
    }
  }

  // Validate weights labeled as 'lb'
  if (correctedUnit === 'lb') {
    if (weight > 400) {
      // Weight > 400 lbs is probably in kg, convert kg to lbs
      correctedWeight = weight * KG_TO_LBS;
      correctedUnit = 'lb'; // Keep as lb after conversion
      wasCorrected = true;
    } else if (weight > 300) {
      // Weight 300-400 lbs is suspicious - check if treating as kg makes sense
      const asKg = weight * LBS_TO_KG;
      if (asKg >= 100 && asKg <= 200) {
        // If treating as kg gives reasonable human weight, it's probably in kg
        correctedWeight = weight * KG_TO_LBS;
        correctedUnit = 'lb'; // Keep as lb after conversion
        wasCorrected = true;
      }
    } else if (weight <= 85 && weight >= 30) {
      // Weight 30-85 lbs when labeled as 'lb' is suspicious - likely in kg
      correctedWeight = weight * KG_TO_LBS;
      correctedUnit = 'lb'; // Keep as lb after conversion
      wasCorrected = true;
    }
  }

  // Validate weights labeled as 'kg'
  if (correctedUnit === 'kg') {
    if (weight >= 30 && weight <= 200) {
      // Common weights 30-200 kg are likely human weights in lbs, mislabeled as kg
      // Most people weigh 100-400 lbs (45-181 kg), so values in this range
      // labeled as 'kg' are very suspicious - likely lb values with wrong unit
      correctedWeight = weight; // Already in lbs, just mislabeled
      correctedUnit = 'lb'; // Correct the unit
      wasCorrected = true;
    } else if (weight > 200) {
      // Weight > 200 kg is suspicious - check if it's actually in lbs
      const asLbs = weight * KG_TO_LBS;
      if (asLbs > 500) {
        // If converting to lbs gives > 500, it's probably already in lbs
        correctedWeight = weight;
        correctedUnit = 'lb';
        wasCorrected = true;
      }
    }
  }

  return {
    weight: correctedWeight,
    unit: correctedUnit,
    wasCorrected,
    originalWeight,
    originalUnit,
  };
}

/**
 * Converts a validated weight to the user's preferred display unit.
 * 
 * @param validatedWeight - The validated weight from validateWeightEntry
 * @param preferredUnit - The user's preferred display unit ('lb' or 'kg')
 * @returns The weight value in the preferred unit
 */
export function convertToDisplayUnit(
  validatedWeight: ValidatedWeight,
  preferredUnit: 'lb' | 'kg'
): number {
  if (validatedWeight.unit === preferredUnit) {
    return validatedWeight.weight;
  }

  if (validatedWeight.unit === 'lb' && preferredUnit === 'kg') {
    return validatedWeight.weight * LBS_TO_KG;
  }

  if (validatedWeight.unit === 'kg' && preferredUnit === 'lb') {
    return validatedWeight.weight * KG_TO_LBS;
  }

  return validatedWeight.weight;
}

/**
 * Gets the display weight for a weight entry from the database.
 * This is the main function to use when displaying weights in the UI.
 * 
 * @param weight - The weight value from the database
 * @param unit - The unit from the database ('lb', 'kg', or null)
 * @param preferredUnit - The user's preferred display unit ('lb' or 'kg')
 * @returns The weight value in the preferred unit, with unit errors corrected
 */
export function getDisplayWeight(
  weight: number,
  unit: 'lb' | 'kg' | null | undefined,
  preferredUnit: 'lb' | 'kg'
): number {
  const validated = validateWeightEntry(weight, unit);
  return convertToDisplayUnit(validated, preferredUnit);
}

/**
 * Formats a weight value for display with unit suffix.
 * 
 * @param weight - The weight value in the display unit
 * @param unit - The display unit ('lb' or 'kg')
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted string like "175.3 lbs" or "79.5 kg"
 */
export function formatWeightDisplay(
  weight: number,
  unit: 'lb' | 'kg',
  decimals: number = 1
): string {
  return `${weight.toFixed(decimals)} ${unit === 'kg' ? 'kg' : 'lbs'}`;
}

/**
 * Prepares a weight value for storage in the database.
 * Converts from user's input unit to the storage unit.
 * 
 * @param weight - The weight value entered by the user
 * @param inputUnit - The unit the user entered ('lb' or 'kg')
 * @param storageUnit - The unit to store in the database ('lb' or 'kg')
 * @returns The weight value in the storage unit
 */
export function prepareWeightForStorage(
  weight: number,
  inputUnit: 'lb' | 'kg',
  storageUnit: 'lb' | 'kg' = 'lb'
): { weight: number; unit: 'lb' | 'kg' } {
  if (inputUnit === storageUnit) {
    return { weight, unit: storageUnit };
  }

  if (inputUnit === 'lb' && storageUnit === 'kg') {
    return { weight: weight * LBS_TO_KG, unit: 'kg' };
  }

  if (inputUnit === 'kg' && storageUnit === 'lb') {
    return { weight: weight * KG_TO_LBS, unit: 'lb' };
  }

  return { weight, unit: storageUnit };
}

/**
 * Validates a weight value entered by the user.
 * 
 * @param weight - The weight value to validate
 * @param unit - The unit of the weight
 * @returns Object with isValid flag and error message if invalid
 */
export function validateUserInput(
  weight: number,
  unit: 'lb' | 'kg'
): { isValid: boolean; error?: string } {
  if (!weight || weight <= 0) {
    return { isValid: false, error: 'Weight must be greater than 0' };
  }

  // Reasonable human weight ranges
  const minWeight = unit === 'lb' ? 50 : 20; // 50 lbs / 20 kg minimum
  const maxWeight = unit === 'lb' ? 500 : 250; // 500 lbs / 250 kg maximum

  if (weight < minWeight) {
    return {
      isValid: false,
      error: `Weight seems too low. Minimum: ${minWeight} ${unit}`,
    };
  }

  if (weight > maxWeight) {
    return {
      isValid: false,
      error: `Weight seems too high. Maximum: ${maxWeight} ${unit}`,
    };
  }

  return { isValid: true };
}

/**
 * Calculates the change between two weight entries.
 * 
 * @param currentWeight - Current weight value
 * @param currentUnit - Current weight unit
 * @param previousWeight - Previous weight value
 * @param previousUnit - Previous weight unit
 * @param preferredUnit - Display unit for the result
 * @returns The change in the preferred unit (positive = gain, negative = loss)
 */
export function calculateWeightChange(
  currentWeight: number,
  currentUnit: 'lb' | 'kg' | null | undefined,
  previousWeight: number,
  previousUnit: 'lb' | 'kg' | null | undefined,
  preferredUnit: 'lb' | 'kg'
): number {
  const currentDisplay = getDisplayWeight(currentWeight, currentUnit, preferredUnit);
  const previousDisplay = getDisplayWeight(previousWeight, previousUnit, preferredUnit);
  return currentDisplay - previousDisplay;
}

