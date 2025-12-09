import { type ClassValue, clsx } from 'clsx';

/**
 * Utility for merging class names conditionally
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Format a date to a readable string
 */
export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === 'string' ? new Date(date) : date;
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
 * Format weight with unit (always stored as kg, displayed in user preference)
 */
export function formatWeight(weightKg: number, unit: 'kg' | 'lb', decimals: number = 1): string {
  if (unit === 'lb') {
    const lbs = convertWeight(weightKg, 'kg', 'lb');
    return `${lbs.toFixed(decimals)} lbs`;
  }
  return `${weightKg.toFixed(decimals)} kg`;
}

/**
 * Format weight value only (no unit suffix)
 */
export function formatWeightValue(weightKg: number, unit: 'kg' | 'lb', decimals: number = 1): number {
  if (unit === 'lb') {
    return parseFloat(convertWeight(weightKg, 'kg', 'lb').toFixed(decimals));
  }
  return parseFloat(weightKg.toFixed(decimals));
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

