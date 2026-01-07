import { type ClassValue, clsx } from 'clsx';

/**
 * Utility for merging class names conditionally
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Get today's date in YYYY-MM-DD format using LOCAL timezone (not UTC)
 * This fixes the issue where toISOString() returns tomorrow's date in the evening
 */
export function getLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format a date to a readable string
 * Handles date strings in YYYY-MM-DD format by parsing as local date (not UTC)
 */
export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  let d: Date;
  if (typeof date === 'string') {
    // If it's a date string in YYYY-MM-DD format, parse it as local date to avoid timezone issues
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split('-').map(Number);
      d = new Date(year, month - 1, day); // month is 0-indexed
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  });
}

/**
 * Format a date as a relative time string (e.g., "2 hours ago", "3 days ago")
 */
export function formatDistanceToNow(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffWeeks < 4) {
    return `${diffWeeks}w ago`;
  } else if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  } else {
    return `${diffYears}y ago`;
  }
}

/**
 * Format time duration in seconds to mm:ss format
 */
export function formatDuration(seconds: number): string {
  // Handle negative, NaN, or invalid values
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convert weight between kg and lb
 */
export function convertWeight(weight: number, from: 'kg' | 'lb', to: 'kg' | 'lb'): number {
  // Handle invalid input values
  if (!Number.isFinite(weight) || weight < 0) {
    return 0;
  }
  if (from === to) return weight;
  if (from === 'kg' && to === 'lb') return weight * 2.20462;
  return weight / 2.20462;
}

/**
 * Convert kg to lbs (convenience function)
 */
export function kgToLbs(kg: number): number {
  return kg * 2.20462;
}

/**
 * Convert lbs to kg (convenience function)
 */
export function lbsToKg(lbs: number): number {
  return lbs / 2.20462;
}

/**
 * Format weight with unit (always stored as kg, displayed in user preference)
 * Rounds to nearest 2.5 increment for cleaner display
 */
export function formatWeight(weightKg: number, unit: 'kg' | 'lb', decimals: number = 1): string {
  if (unit === 'lb') {
    const lbs = convertWeight(weightKg, 'kg', 'lb');
    // Round to nearest 2.5 lbs for cleaner display
    const roundedLbs = Math.round(lbs / 2.5) * 2.5;
    return `${roundedLbs.toFixed(decimals)} lbs`;
  }
  // Round to nearest 2.5 kg
  const roundedKg = weightKg < 20 ? Math.round(weightKg) : Math.round(weightKg / 2.5) * 2.5;
  return `${roundedKg.toFixed(decimals)} kg`;
}

/**
 * Convert weight from kg to display unit without rounding (preserves exact values)
 * Use this for displaying saved/completed set weights to preserve user input
 */
export function convertWeightForDisplay(weightKg: number, unit: 'kg' | 'lb', decimals: number = 1): number {
  if (unit === 'lb') {
    const lbs = convertWeight(weightKg, 'kg', 'lb');
    return parseFloat(lbs.toFixed(decimals));
  }
  return parseFloat(weightKg.toFixed(decimals));
}

/**
 * Format weight value only (no unit suffix), rounded to plate increments
 * - lb: 2.5lb increments (or 1lb for weights < 45lb)
 * - kg: 2.5kg increments (or 1kg for weights < 20kg)
 * 
 * NOTE: Use convertWeightForDisplay() for displaying saved/completed set weights
 * to preserve exact user input. Use this function only for suggestions/calculations.
 */
export function formatWeightValue(weightKg: number, unit: 'kg' | 'lb', decimals: number = 1): number {
  if (unit === 'lb') {
    const lbs = convertWeight(weightKg, 'kg', 'lb');
    // Round to 2.5lb increments
    const rounded = Math.round(lbs / 2.5) * 2.5;
    return parseFloat(rounded.toFixed(decimals));
  }
  // Round to 2.5kg increments (or 1kg for light weights)
  const rounded = weightKg < 20 ? Math.round(weightKg) : Math.round(weightKg / 2.5) * 2.5;
  return parseFloat(rounded.toFixed(decimals));
}

/**
 * Convert user input weight to kg for storage
 */
export function inputWeightToKg(weight: number, fromUnit: 'kg' | 'lb'): number {
  return fromUnit === 'lb' ? convertWeight(weight, 'lb', 'kg') : weight;
}

/**
 * Round to nearest increment (for weights)
 */
export function roundToIncrement(value: number, increment: number): number {
  // Guard against zero or invalid increment to prevent NaN
  if (!Number.isFinite(increment) || increment <= 0) {
    return value;
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value / increment) * increment;
}

/**
 * Round weight to nearest plate increment based on unit
 * In kg mode: 2.5kg increments
 * In lb mode: 2.5lb increments (which is ~1.13kg internally)
 * For light weights (<20kg or <45lb), round to nearest 1
 */
export function roundToPlateIncrement(weightKg: number, unit: 'kg' | 'lb'): number {
  if (unit === 'lb') {
    // Convert to lb, round to 2.5lb increments, convert back
    const lbs = convertWeight(weightKg, 'kg', 'lb');
    const lightThreshold = 45; // 45lb = ~20kg
    
    if (lbs < lightThreshold) {
      // For light weights, round to nearest 2.5lb
      const rounded = Math.round(lbs / 2.5) * 2.5;
      return convertWeight(rounded, 'lb', 'kg');
    }
    
    // Standard 2.5lb increments
    const rounded = Math.round(lbs / 2.5) * 2.5;
    return convertWeight(rounded, 'lb', 'kg');
  }
  
  // kg mode: 2.5kg increments
  if (weightKg < 20) {
    return Math.round(weightKg);
  }
  return Math.round(weightKg / 2.5) * 2.5;
}

/**
 * Calculate RPE from RIR (Reps In Reserve)
 */
export function rirToRpe(rir: number): number {
  return 10 - rir;
}

/**
 * Calculate RIR from RPE
 */
export function rpeToRir(rpe: number): number {
  return 10 - rpe;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Calculate percentage
 */
export function percentage(value: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((value / total) * 100);
}

// ============ PLATE CALCULATOR ============

/**
 * Standard plate weights available (per side)
 */
export const STANDARD_PLATES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
} as const;

/**
 * Common barbell types with their weights
 */
export const BARBELL_WEIGHTS = {
  kg: {
    olympic: { weight: 20, label: 'Olympic Barbell (20kg)' },
    womens: { weight: 15, label: "Women's Olympic (15kg)" },
    ez_curl: { weight: 10, label: 'EZ Curl Bar (10kg)' },
    trap: { weight: 25, label: 'Trap Bar (25kg)' },
  },
  lb: {
    olympic: { weight: 45, label: 'Olympic Barbell (45lb)' },
    womens: { weight: 35, label: "Women's Olympic (35lb)" },
    ez_curl: { weight: 25, label: 'EZ Curl Bar (25lb)' },
    trap: { weight: 55, label: 'Trap Bar (55lb)' },
  },
} as const;

export type BarbellType = keyof typeof BARBELL_WEIGHTS.kg;

/**
 * Result of plate calculation
 */
export interface PlateCalculationResult {
  /** Whether the target weight is achievable with available plates */
  isValid: boolean;
  /** The barbell weight used */
  barbellWeight: number;
  /** Plates needed per side (array of plate weights) */
  platesPerSide: number[];
  /** Total weight per side (sum of plates) */
  weightPerSide: number;
  /** Actual total weight (may differ slightly from target due to rounding) */
  actualTotal: number;
  /** Error message if not valid */
  error?: string;
}

/**
 * Calculate which plates to load on each side of the barbell
 * Uses a greedy algorithm to find the minimal number of plates
 */
export function calculatePlates(
  targetWeight: number,
  barbellWeight: number,
  unit: 'kg' | 'lb',
  availablePlates?: number[],
  startingWeight?: number // Optional starting weight (e.g., machine base weight)
): PlateCalculationResult {
  const plates = availablePlates || [...STANDARD_PLATES[unit]];
  
  // If starting weight is provided, it's a machine (no barbell)
  if (startingWeight !== undefined) {
    // Target weight must be at least the starting weight
    if (targetWeight < startingWeight) {
      return {
        isValid: false,
        barbellWeight: 0, // No barbell for machines
        platesPerSide: [],
        weightPerSide: 0,
        actualTotal: startingWeight,
        error: `Target weight must be at least ${startingWeight}${unit} (starting weight)`,
      };
    }

    // Calculate weight needed per side (target - starting weight, divided by 2)
    const totalPlateWeight = targetWeight - startingWeight;
    let remainingPerSide = totalPlateWeight / 2;

    // Check if the weight is divisible (plates go on both sides)
    if (totalPlateWeight % 2 !== 0 && unit === 'kg') {
      // For kg, we need the plate weight to be divisible by smallest increment
      const smallestPlate = Math.min(...plates);
      if ((totalPlateWeight / 2) % smallestPlate !== 0) {
        // Round to nearest achievable weight
        remainingPerSide = Math.round(remainingPerSide / smallestPlate) * smallestPlate;
      }
    }

    const platesPerSide: number[] = [];

    // Greedy algorithm: use largest plates first
    for (const plate of plates.sort((a, b) => b - a)) {
      while (remainingPerSide >= plate) {
        platesPerSide.push(plate);
        remainingPerSide -= plate;
      }
    }

    // Check if we achieved the target (allowing small rounding errors)
    const weightPerSide = platesPerSide.reduce((sum, p) => sum + p, 0);
    // Actual total for machines: starting weight + plates
    const actualTotal = startingWeight + (weightPerSide * 2);

    if (Math.abs(remainingPerSide) > 0.01) {
      return {
        isValid: false,
        barbellWeight: 0,
        platesPerSide,
        weightPerSide,
        actualTotal,
        error: `Cannot exactly achieve ${targetWeight}${unit}. Closest: ${actualTotal}${unit}`,
      };
    }

    return {
      isValid: true,
      barbellWeight: 0, // No barbell for machines
      platesPerSide,
      weightPerSide,
      actualTotal,
    };
  }

  // Barbell calculation (no starting weight)
  // Target weight must be at least the barbell weight
  if (targetWeight < barbellWeight) {
    return {
      isValid: false,
      barbellWeight,
      platesPerSide: [],
      weightPerSide: 0,
      actualTotal: barbellWeight,
      error: `Target weight must be at least ${barbellWeight}${unit} (barbell weight)`,
    };
  }

  // Calculate weight needed per side
  const totalPlateWeight = targetWeight - barbellWeight;
  let remainingPerSide = totalPlateWeight / 2;

  // Check if the weight is divisible (plates go on both sides)
  if (totalPlateWeight % 2 !== 0 && unit === 'kg') {
    // For kg, we need the plate weight to be divisible by smallest increment
    const smallestPlate = Math.min(...plates);
    if ((totalPlateWeight / 2) % smallestPlate !== 0) {
      // Round to nearest achievable weight
      remainingPerSide = Math.round(remainingPerSide / smallestPlate) * smallestPlate;
    }
  }

  const platesPerSide: number[] = [];

  // Greedy algorithm: use largest plates first
  for (const plate of plates.sort((a, b) => b - a)) {
    while (remainingPerSide >= plate) {
      platesPerSide.push(plate);
      remainingPerSide -= plate;
    }
  }

  // Check if we achieved the target (allowing small rounding errors)
  const weightPerSide = platesPerSide.reduce((sum, p) => sum + p, 0);
  const actualTotal = barbellWeight + (weightPerSide * 2);

  if (Math.abs(remainingPerSide) > 0.01) {
    return {
      isValid: false,
      barbellWeight,
      platesPerSide,
      weightPerSide,
      actualTotal,
      error: `Cannot exactly achieve ${targetWeight}${unit}. Closest: ${actualTotal}${unit}`,
    };
  }

  return {
    isValid: true,
    barbellWeight,
    platesPerSide,
    weightPerSide,
    actualTotal,
  };
}

/**
 * Get barbell weight based on type and unit
 */
export function getBarbellWeight(type: BarbellType, unit: 'kg' | 'lb'): number {
  return BARBELL_WEIGHTS[unit][type].weight;
}

/**
 * Get barbell label based on type and unit
 */
export function getBarbellLabel(type: BarbellType, unit: 'kg' | 'lb'): string {
  return BARBELL_WEIGHTS[unit][type].label;
}

// ============ MEASUREMENT CONVERSION (for body measurements) ============

/**
 * Convert centimeters to inches
 */
export function cmToIn(cm: number): number {
  return cm / 2.54;
}

/**
 * Convert inches to centimeters
 */
export function inToCm(inches: number): number {
  return inches * 2.54;
}

/**
 * Format a body measurement value with the user's preferred unit
 * Always stores in cm, converts to inches for display when needed
 * @param valueCm - The value in centimeters
 * @param unit - The display unit preference ('in' or 'cm')
 * @param decimals - Number of decimal places (default 1)
 * @returns Formatted string with unit suffix
 */
export function formatMeasurement(valueCm: number, unit: 'in' | 'cm', decimals: number = 1): string {
  if (unit === 'in') {
    return `${cmToIn(valueCm).toFixed(decimals)} in`;
  }
  return `${valueCm.toFixed(decimals)} cm`;
}

/**
 * Format a measurement value only (no unit suffix)
 * @param valueCm - The value in centimeters
 * @param unit - The display unit preference ('in' or 'cm')
 * @param decimals - Number of decimal places (default 1)
 * @returns The numeric value in the requested unit
 */
export function formatMeasurementValue(valueCm: number, unit: 'in' | 'cm', decimals: number = 1): number {
  const value = unit === 'in' ? cmToIn(valueCm) : valueCm;
  return parseFloat(value.toFixed(decimals));
}

/**
 * Convert a measurement from user input to cm for storage
 * @param value - The input value
 * @param fromUnit - The unit of the input value
 * @returns The value in centimeters
 */
export function inputMeasurementToCm(value: number, fromUnit: 'in' | 'cm'): number {
  return fromUnit === 'in' ? inToCm(value) : value;
}

/**
 * Format a measurement difference (e.g., for asymmetry display)
 * Converts to appropriate unit and shows sign
 * @param differenceCm - The difference in cm (positive or negative)
 * @param unit - The display unit preference
 * @param decimals - Number of decimal places
 * @returns Formatted string like "+1.2 in" or "-0.5 cm"
 */
export function formatMeasurementDiff(differenceCm: number, unit: 'in' | 'cm', decimals: number = 1): string {
  const value = unit === 'in' ? cmToIn(differenceCm) : differenceCm;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)} ${unit}`;
}

/**
 * Convert height from cm to a readable format
 * @param heightCm - Height in centimeters
 * @param unit - The display unit preference
 * @returns Formatted string like "6'2\"" or "188 cm"
 */
export function formatHeight(heightCm: number, unit: 'in' | 'cm'): string {
  if (unit === 'cm') {
    return `${Math.round(heightCm)} cm`;
  }
  const totalInches = cmToIn(heightCm);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return `${feet}'${inches}"`;
}

/**
 * Get height in inches from cm
 */
export function heightCmToInches(heightCm: number): number {
  return cmToIn(heightCm);
}

/**
 * Get color for a plate based on its weight (follows standard Olympic color coding)
 */
export function getPlateColor(weight: number, unit: 'kg' | 'lb'): string {
  // Convert lb to kg equivalent for color matching
  const kgWeight = unit === 'lb' ? weight / 2.20462 : weight;

  // Olympic plate colors (based on kg plates)
  if (kgWeight >= 24) return '#E53935'; // Red - 25kg
  if (kgWeight >= 19) return '#1E88E5'; // Blue - 20kg
  if (kgWeight >= 14) return '#FDD835'; // Yellow - 15kg
  if (kgWeight >= 9) return '#43A047'; // Green - 10kg
  if (kgWeight >= 4) return '#FFFFFF'; // White - 5kg
  if (kgWeight >= 2) return '#E53935'; // Red - 2.5kg
  return '#9E9E9E'; // Gray - smaller plates
}

// ============ STREAK CALCULATION ============

export interface StreakResult {
  /** Current consecutive day streak (ending today or yesterday) */
  currentStreak: number;
  /** Longest consecutive day streak ever */
  longestStreak: number;
}

/**
 * Calculate workout streaks from an array of workout completion dates.
 * A streak is consecutive days with at least one workout.
 *
 * @param dates - Array of workout completion dates (Date objects or ISO strings)
 * @returns Object with currentStreak and longestStreak
 */
export function calculateStreaks(dates: (Date | string)[]): StreakResult {
  if (dates.length === 0) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  // Convert all dates to YYYY-MM-DD strings in local timezone and get unique dates
  const dateStrings = new Set<string>();
  for (const date of dates) {
    const d = typeof date === 'string' ? new Date(date) : date;
    dateStrings.add(getLocalDateString(d));
  }

  // Sort unique dates in ascending order
  const sortedDates = Array.from(dateStrings).sort();

  // Calculate longest streak
  let longestStreak = 1;
  let currentRunLength = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prevDate = new Date(sortedDates[i - 1] + 'T00:00:00');
    const currDate = new Date(sortedDates[i] + 'T00:00:00');

    // Check if dates are consecutive (difference of 1 day)
    const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentRunLength++;
      longestStreak = Math.max(longestStreak, currentRunLength);
    } else {
      currentRunLength = 1;
    }
  }

  // Calculate current streak (must end today or yesterday)
  const today = getLocalDateString();
  const yesterday = getLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));

  // Check if there's a workout today or yesterday to start counting
  const lastWorkoutDate = sortedDates[sortedDates.length - 1];
  if (lastWorkoutDate !== today && lastWorkoutDate !== yesterday) {
    // No recent workout, current streak is 0
    return { currentStreak: 0, longestStreak };
  }

  // Count backwards from the most recent workout date
  let currentStreak = 1;
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    const currDate = new Date(sortedDates[i + 1] + 'T00:00:00');
    const prevDate = new Date(sortedDates[i] + 'T00:00:00');

    const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      currentStreak++;
    } else {
      break;
    }
  }

  return { currentStreak, longestStreak };
}

