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
 * Format time duration in seconds to mm:ss format
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Convert weight between kg and lb
 */
export function convertWeight(weight: number, from: 'kg' | 'lb', to: 'kg' | 'lb'): number {
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
 * Format weight value only (no unit suffix), rounded to plate increments
 * - lb: 2.5lb increments (or 1lb for weights < 45lb)
 * - kg: 2.5kg increments (or 1kg for weights < 20kg)
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
export function debounce<T extends (...args: unknown[]) => unknown>(
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

