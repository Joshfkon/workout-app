/**
 * Input validation utilities for HyperTrack
 *
 * Provides validation for workout data, user input, and form fields.
 * All validation functions return a Result type for explicit error handling.
 */

import { ValidationError } from './errors';

// ============================================
// VALIDATION RESULT TYPE
// ============================================

export type ValidationResult<T> =
  | { valid: true; value: T }
  | { valid: false; error: string; field?: string };

// ============================================
// WORKOUT DATA VALIDATION
// ============================================

/** Valid range for reps in a set */
export const REPS_RANGE = { min: 1, max: 100 } as const;

/** Valid range for weight in kg */
export const WEIGHT_RANGE = { min: 0, max: 1000 } as const;

/** Valid range for RPE (Rate of Perceived Exertion) */
export const RPE_RANGE = { min: 1, max: 10 } as const;

/** Valid range for RIR (Reps In Reserve) */
export const RIR_RANGE = { min: 0, max: 5 } as const;

/** Valid range for rest time in seconds */
export const REST_RANGE = { min: 0, max: 600 } as const;

/** Valid range for number of sets */
export const SETS_RANGE = { min: 1, max: 20 } as const;

/**
 * Validate reps value
 */
export function validateReps(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null || !Number.isInteger(num)) {
    return { valid: false, error: 'Reps must be a whole number', field: 'reps' };
  }

  if (num < REPS_RANGE.min || num > REPS_RANGE.max) {
    return {
      valid: false,
      error: `Reps must be between ${REPS_RANGE.min} and ${REPS_RANGE.max}`,
      field: 'reps',
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate weight value (in kg)
 */
export function validateWeight(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null) {
    return { valid: false, error: 'Weight must be a number', field: 'weight' };
  }

  if (num < WEIGHT_RANGE.min || num > WEIGHT_RANGE.max) {
    return {
      valid: false,
      error: `Weight must be between ${WEIGHT_RANGE.min} and ${WEIGHT_RANGE.max} kg`,
      field: 'weight',
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate RPE value
 */
export function validateRPE(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null) {
    return { valid: false, error: 'RPE must be a number', field: 'rpe' };
  }

  if (num < RPE_RANGE.min || num > RPE_RANGE.max) {
    return {
      valid: false,
      error: `RPE must be between ${RPE_RANGE.min} and ${RPE_RANGE.max}`,
      field: 'rpe',
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate RIR value
 */
export function validateRIR(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null || !Number.isInteger(num)) {
    return { valid: false, error: 'RIR must be a whole number', field: 'rir' };
  }

  if (num < RIR_RANGE.min || num > RIR_RANGE.max) {
    return {
      valid: false,
      error: `RIR must be between ${RIR_RANGE.min} and ${RIR_RANGE.max}`,
      field: 'rir',
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate rest time in seconds
 */
export function validateRestSeconds(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null || !Number.isInteger(num)) {
    return { valid: false, error: 'Rest time must be a whole number', field: 'restSeconds' };
  }

  if (num < REST_RANGE.min || num > REST_RANGE.max) {
    return {
      valid: false,
      error: `Rest time must be between ${REST_RANGE.min} and ${REST_RANGE.max} seconds`,
      field: 'restSeconds',
    };
  }

  return { valid: true, value: num };
}

/**
 * Validate number of sets
 */
export function validateSets(value: unknown): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null || !Number.isInteger(num)) {
    return { valid: false, error: 'Sets must be a whole number', field: 'sets' };
  }

  if (num < SETS_RANGE.min || num > SETS_RANGE.max) {
    return {
      valid: false,
      error: `Sets must be between ${SETS_RANGE.min} and ${SETS_RANGE.max}`,
      field: 'sets',
    };
  }

  return { valid: true, value: num };
}

// ============================================
// SET LOG VALIDATION
// ============================================

export interface SetLogInput {
  reps: unknown;
  weightKg: unknown;
  rpe?: unknown;
  restSeconds?: unknown;
}

export interface ValidatedSetLog {
  reps: number;
  weightKg: number;
  rpe: number;
  restSeconds: number | null;
}

/**
 * Validate a complete set log entry
 */
export function validateSetLog(input: SetLogInput): ValidationResult<ValidatedSetLog> {
  // Validate reps
  const repsResult = validateReps(input.reps);
  if (!repsResult.valid) {
    return repsResult;
  }

  // Validate weight
  const weightResult = validateWeight(input.weightKg);
  if (!weightResult.valid) {
    return weightResult;
  }

  // Validate RPE (optional, defaults to 8)
  let rpe = 8;
  if (input.rpe !== undefined && input.rpe !== null && input.rpe !== '') {
    const rpeResult = validateRPE(input.rpe);
    if (!rpeResult.valid) {
      return rpeResult;
    }
    rpe = rpeResult.value;
  }

  // Validate rest (optional)
  let restSeconds: number | null = null;
  if (input.restSeconds !== undefined && input.restSeconds !== null && input.restSeconds !== '') {
    const restResult = validateRestSeconds(input.restSeconds);
    if (!restResult.valid) {
      return restResult;
    }
    restSeconds = restResult.value;
  }

  return {
    valid: true,
    value: {
      reps: repsResult.value,
      weightKg: weightResult.value,
      rpe,
      restSeconds,
    },
  };
}

// ============================================
// USER INPUT VALIDATION
// ============================================

/**
 * Validate a required string field
 */
export function validateRequiredString(
  value: unknown,
  fieldName: string,
  maxLength = 500
): ValidationResult<string> {
  if (value === null || value === undefined) {
    return { valid: false, error: `${fieldName} is required`, field: fieldName };
  }

  const str = String(value).trim();

  if (str.length === 0) {
    return { valid: false, error: `${fieldName} cannot be empty`, field: fieldName };
  }

  if (str.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be ${maxLength} characters or less`,
      field: fieldName,
    };
  }

  return { valid: true, value: str };
}

/**
 * Validate an optional string field
 */
export function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLength = 500
): ValidationResult<string | null> {
  if (value === null || value === undefined || value === '') {
    return { valid: true, value: null };
  }

  const str = String(value).trim();

  if (str.length > maxLength) {
    return {
      valid: false,
      error: `${fieldName} must be ${maxLength} characters or less`,
      field: fieldName,
    };
  }

  return { valid: true, value: str };
}

/**
 * Validate a positive number
 */
export function validatePositiveNumber(
  value: unknown,
  fieldName: string
): ValidationResult<number> {
  const num = toNumber(value);

  if (num === null) {
    return { valid: false, error: `${fieldName} must be a number`, field: fieldName };
  }

  if (num <= 0) {
    return { valid: false, error: `${fieldName} must be greater than 0`, field: fieldName };
  }

  return { valid: true, value: num };
}

// ============================================
// SANITIZATION
// ============================================

/**
 * Sanitize a string for safe storage/display
 * - Trims whitespace
 * - Removes control characters
 * - Limits length
 */
export function sanitizeString(value: string, maxLength = 500): string {
  return value
    .trim()
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .slice(0, maxLength);
}

/**
 * Sanitize user notes (allows more characters)
 */
export function sanitizeNotes(value: string): string {
  return sanitizeString(value, 2000);
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Safely convert a value to a number, returning null if invalid
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Throw a ValidationError if validation fails
 */
export function assertValid<T>(result: ValidationResult<T>): T {
  if (!result.valid) {
    throw new ValidationError(result.error, {
      field: result.field,
      userMessage: result.error,
    });
  }
  return result.value;
}

/**
 * Collect all validation errors from multiple fields
 */
export function collectErrors(
  ...results: ValidationResult<unknown>[]
): Record<string, string> | null {
  const errors: Record<string, string> = {};

  for (const result of results) {
    if (!result.valid && result.field) {
      errors[result.field] = result.error;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
