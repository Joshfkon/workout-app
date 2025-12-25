/**
 * Tests for lib/validation.ts
 */

import {
  validateReps,
  validateWeight,
  validateRPE,
  validateRIR,
  validateRestSeconds,
  validateSets,
  validateSetLog,
  validateRequiredString,
  validateOptionalString,
  validatePositiveNumber,
  sanitizeString,
  sanitizeNotes,
  assertValid,
  collectErrors,
  REPS_RANGE,
  WEIGHT_RANGE,
  RPE_RANGE,
  RIR_RANGE,
} from '../validation';
import { ValidationError } from '../errors';

// ============================================
// REPS VALIDATION
// ============================================

describe('validateReps', () => {
  it('accepts valid integer reps', () => {
    expect(validateReps(8)).toEqual({ valid: true, value: 8 });
    expect(validateReps('10')).toEqual({ valid: true, value: 10 });
    expect(validateReps(1)).toEqual({ valid: true, value: 1 });
    expect(validateReps(100)).toEqual({ valid: true, value: 100 });
  });

  it('rejects non-integer reps', () => {
    const result = validateReps(8.5);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('whole number');
    }
  });

  it('rejects out of range reps', () => {
    expect(validateReps(0).valid).toBe(false);
    expect(validateReps(-1).valid).toBe(false);
    expect(validateReps(101).valid).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(validateReps('abc').valid).toBe(false);
    expect(validateReps(null).valid).toBe(false);
    expect(validateReps(undefined).valid).toBe(false);
  });
});

// ============================================
// WEIGHT VALIDATION
// ============================================

describe('validateWeight', () => {
  it('accepts valid weights', () => {
    expect(validateWeight(100)).toEqual({ valid: true, value: 100 });
    expect(validateWeight('50.5')).toEqual({ valid: true, value: 50.5 });
    expect(validateWeight(0)).toEqual({ valid: true, value: 0 }); // Bodyweight exercises
  });

  it('rejects out of range weights', () => {
    expect(validateWeight(-1).valid).toBe(false);
    expect(validateWeight(1001).valid).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(validateWeight('heavy').valid).toBe(false);
  });
});

// ============================================
// RPE VALIDATION
// ============================================

describe('validateRPE', () => {
  it('accepts valid RPE values', () => {
    expect(validateRPE(7)).toEqual({ valid: true, value: 7 });
    expect(validateRPE(8.5)).toEqual({ valid: true, value: 8.5 });
    expect(validateRPE('9')).toEqual({ valid: true, value: 9 });
  });

  it('rejects out of range RPE', () => {
    expect(validateRPE(0).valid).toBe(false);
    expect(validateRPE(11).valid).toBe(false);
  });
});

// ============================================
// RIR VALIDATION
// ============================================

describe('validateRIR', () => {
  it('accepts valid RIR values', () => {
    expect(validateRIR(0)).toEqual({ valid: true, value: 0 });
    expect(validateRIR(2)).toEqual({ valid: true, value: 2 });
    expect(validateRIR(5)).toEqual({ valid: true, value: 5 });
  });

  it('rejects non-integer RIR', () => {
    expect(validateRIR(1.5).valid).toBe(false);
  });

  it('rejects out of range RIR', () => {
    expect(validateRIR(-1).valid).toBe(false);
    expect(validateRIR(6).valid).toBe(false);
  });
});

// ============================================
// REST SECONDS VALIDATION
// ============================================

describe('validateRestSeconds', () => {
  it('accepts valid rest times', () => {
    expect(validateRestSeconds(60)).toEqual({ valid: true, value: 60 });
    expect(validateRestSeconds(180)).toEqual({ valid: true, value: 180 });
    expect(validateRestSeconds(0)).toEqual({ valid: true, value: 0 });
  });

  it('rejects out of range rest times', () => {
    expect(validateRestSeconds(-1).valid).toBe(false);
    expect(validateRestSeconds(601).valid).toBe(false);
  });
});

// ============================================
// SETS VALIDATION
// ============================================

describe('validateSets', () => {
  it('accepts valid set counts', () => {
    expect(validateSets(3)).toEqual({ valid: true, value: 3 });
    expect(validateSets(1)).toEqual({ valid: true, value: 1 });
    expect(validateSets(20)).toEqual({ valid: true, value: 20 });
  });

  it('rejects out of range sets', () => {
    expect(validateSets(0).valid).toBe(false);
    expect(validateSets(21).valid).toBe(false);
  });
});

// ============================================
// SET LOG VALIDATION
// ============================================

describe('validateSetLog', () => {
  it('validates complete set log', () => {
    const result = validateSetLog({
      reps: 8,
      weightKg: 100,
      rpe: 8,
      restSeconds: 120,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        reps: 8,
        weightKg: 100,
        rpe: 8,
        restSeconds: 120,
      });
    }
  });

  it('uses defaults for optional fields', () => {
    const result = validateSetLog({
      reps: 10,
      weightKg: 50,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.rpe).toBe(8); // Default RPE
      expect(result.value.restSeconds).toBeNull();
    }
  });

  it('returns first validation error', () => {
    const result = validateSetLog({
      reps: -1, // Invalid
      weightKg: 100,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.field).toBe('reps');
    }
  });

  it('handles empty optional fields', () => {
    const result = validateSetLog({
      reps: 8,
      weightKg: 100,
      rpe: '',
      restSeconds: null,
    });

    expect(result.valid).toBe(true);
  });
});

// ============================================
// STRING VALIDATION
// ============================================

describe('validateRequiredString', () => {
  it('accepts valid strings', () => {
    expect(validateRequiredString('hello', 'name')).toEqual({
      valid: true,
      value: 'hello',
    });
  });

  it('trims whitespace', () => {
    const result = validateRequiredString('  hello  ', 'name');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toBe('hello');
    }
  });

  it('rejects empty strings', () => {
    expect(validateRequiredString('', 'name').valid).toBe(false);
    expect(validateRequiredString('   ', 'name').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validateRequiredString(null, 'name').valid).toBe(false);
    expect(validateRequiredString(undefined, 'name').valid).toBe(false);
  });

  it('enforces max length', () => {
    const longString = 'a'.repeat(501);
    expect(validateRequiredString(longString, 'name').valid).toBe(false);
  });
});

describe('validateOptionalString', () => {
  it('accepts empty values as null', () => {
    expect(validateOptionalString(null, 'notes')).toEqual({ valid: true, value: null });
    expect(validateOptionalString('', 'notes')).toEqual({ valid: true, value: null });
  });

  it('validates non-empty values', () => {
    expect(validateOptionalString('hello', 'notes')).toEqual({
      valid: true,
      value: 'hello',
    });
  });
});

describe('validatePositiveNumber', () => {
  it('accepts positive numbers', () => {
    expect(validatePositiveNumber(5, 'count')).toEqual({ valid: true, value: 5 });
    expect(validatePositiveNumber(0.5, 'ratio')).toEqual({ valid: true, value: 0.5 });
  });

  it('rejects zero and negative', () => {
    expect(validatePositiveNumber(0, 'count').valid).toBe(false);
    expect(validatePositiveNumber(-5, 'count').valid).toBe(false);
  });
});

// ============================================
// SANITIZATION
// ============================================

describe('sanitizeString', () => {
  it('trims whitespace', () => {
    expect(sanitizeString('  hello  ')).toBe('hello');
  });

  it('removes control characters', () => {
    expect(sanitizeString('hello\x00world')).toBe('helloworld');
    expect(sanitizeString('test\x1Fvalue')).toBe('testvalue');
  });

  it('limits length', () => {
    const long = 'a'.repeat(600);
    expect(sanitizeString(long).length).toBe(500);
  });
});

describe('sanitizeNotes', () => {
  it('allows longer content', () => {
    const long = 'a'.repeat(1500);
    expect(sanitizeNotes(long).length).toBe(1500);
  });

  it('limits to 2000 chars', () => {
    const long = 'a'.repeat(2500);
    expect(sanitizeNotes(long).length).toBe(2000);
  });
});

// ============================================
// HELPER FUNCTIONS
// ============================================

describe('assertValid', () => {
  it('returns value for valid result', () => {
    const result = validateReps(8);
    expect(assertValid(result)).toBe(8);
  });

  it('throws ValidationError for invalid result', () => {
    const result = validateReps(-1);
    expect(() => assertValid(result)).toThrow(ValidationError);
  });
});

describe('collectErrors', () => {
  it('returns null for all valid', () => {
    const errors = collectErrors(
      validateReps(8),
      validateWeight(100),
      validateRPE(8)
    );
    expect(errors).toBeNull();
  });

  it('collects all errors', () => {
    const errors = collectErrors(
      validateReps(-1),
      validateWeight(100),
      validateRPE(15)
    );

    expect(errors).toEqual({
      reps: expect.any(String),
      rpe: expect.any(String),
    });
  });
});
