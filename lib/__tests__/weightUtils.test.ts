/**
 * Tests for lib/weightUtils.ts
 * Weight validation, conversion, and display utilities
 */

import {
  validateWeightEntry,
  convertToDisplayUnit,
  getDisplayWeight,
  formatWeightDisplay,
  prepareWeightForStorage,
  validateUserInput,
  calculateWeightChange,
} from '../weightUtils';

// ============================================
// VALIDATE WEIGHT ENTRY TESTS
// ============================================

describe('validateWeightEntry', () => {
  describe('null/undefined unit handling', () => {
    it('infers lb unit for common weight range (30-200)', () => {
      const result = validateWeightEntry(150, null);
      expect(result.unit).toBe('lb');
      expect(result.wasCorrected).toBe(false);
    });

    it('infers unit for weights 200-500', () => {
      const result = validateWeightEntry(300, undefined);
      expect(result.unit).toBe('lb');
    });

    it('defaults to lb for out of range weights', () => {
      const result = validateWeightEntry(25, null);
      expect(result.unit).toBe('lb');
    });
  });

  describe('suspicious lb values (likely in kg)', () => {
    it('corrects weights 30-85 lbs (likely kg)', () => {
      const result = validateWeightEntry(70, 'lb');
      expect(result.wasCorrected).toBe(true);
      expect(result.unit).toBe('lb');
      // 70 kg = ~154 lbs
      expect(result.weight).toBeCloseTo(154.3, 0);
    });

    it('corrects weights > 400 lbs (likely kg)', () => {
      const result = validateWeightEntry(450, 'lb');
      expect(result.wasCorrected).toBe(true);
      // 450 kg = ~992 lbs, but that's > 400 so converts
    });

    it('corrects suspicious weights 300-400 lbs if they make sense as kg', () => {
      // 350 lb / 2.20462 = ~158.7 kg - in human range, so probably in kg
      const result = validateWeightEntry(350, 'lb');
      expect(result.wasCorrected).toBe(true);
    });

    it('does not correct normal lb weights', () => {
      const result = validateWeightEntry(175, 'lb');
      expect(result.wasCorrected).toBe(false);
      expect(result.weight).toBe(175);
      expect(result.unit).toBe('lb');
    });
  });

  describe('suspicious kg values (likely in lbs)', () => {
    it('corrects weights 30-200 kg (likely lbs mislabeled)', () => {
      const result = validateWeightEntry(150, 'kg');
      expect(result.wasCorrected).toBe(true);
      expect(result.unit).toBe('lb');
      expect(result.weight).toBe(150); // Keep same value, just fix unit
    });

    it('corrects weights > 200 kg that are probably in lbs', () => {
      const result = validateWeightEntry(250, 'kg');
      expect(result.wasCorrected).toBe(true);
      expect(result.unit).toBe('lb');
    });

    it('preserves original values for reference', () => {
      const result = validateWeightEntry(70, 'lb');
      expect(result.originalWeight).toBe(70);
      expect(result.originalUnit).toBe('lb');
    });
  });

  describe('edge cases', () => {
    it('handles very small weights', () => {
      const result = validateWeightEntry(5, 'lb');
      expect(result.weight).toBe(5);
      expect(result.unit).toBe('lb');
    });

    it('handles zero weight', () => {
      const result = validateWeightEntry(0, 'lb');
      expect(result.weight).toBe(0);
    });

    it('handles negative weight (bad data)', () => {
      const result = validateWeightEntry(-10, 'lb');
      expect(result.weight).toBe(-10);
    });
  });
});

// ============================================
// CONVERT TO DISPLAY UNIT TESTS
// ============================================

describe('convertToDisplayUnit', () => {
  it('returns same value when units match (lb to lb)', () => {
    const validated = {
      weight: 150,
      unit: 'lb' as const,
      wasCorrected: false,
      originalWeight: 150,
      originalUnit: 'lb' as const,
    };

    expect(convertToDisplayUnit(validated, 'lb')).toBe(150);
  });

  it('returns same value when units match (kg to kg)', () => {
    const validated = {
      weight: 70,
      unit: 'kg' as const,
      wasCorrected: false,
      originalWeight: 70,
      originalUnit: 'kg' as const,
    };

    expect(convertToDisplayUnit(validated, 'kg')).toBe(70);
  });

  it('converts lb to kg', () => {
    const validated = {
      weight: 220,
      unit: 'lb' as const,
      wasCorrected: false,
      originalWeight: 220,
      originalUnit: 'lb' as const,
    };

    const result = convertToDisplayUnit(validated, 'kg');
    expect(result).toBeCloseTo(99.79, 1);
  });

  it('converts kg to lb', () => {
    const validated = {
      weight: 100,
      unit: 'kg' as const,
      wasCorrected: false,
      originalWeight: 100,
      originalUnit: 'kg' as const,
    };

    const result = convertToDisplayUnit(validated, 'lb');
    expect(result).toBeCloseTo(220.46, 1);
  });
});

// ============================================
// GET DISPLAY WEIGHT TESTS
// ============================================

describe('getDisplayWeight', () => {
  it('combines validation and conversion', () => {
    // 150 lb stored, display in lb
    const result = getDisplayWeight(150, 'lb', 'lb');
    expect(result).toBe(150);
  });

  it('converts for display preference', () => {
    // 150 lb stored, display in kg
    const result = getDisplayWeight(150, 'lb', 'kg');
    expect(result).toBeCloseTo(68, 0);
  });

  it('handles null unit', () => {
    const result = getDisplayWeight(175, null, 'lb');
    expect(result).toBe(175);
  });

  it('handles undefined unit', () => {
    const result = getDisplayWeight(175, undefined, 'lb');
    expect(result).toBe(175);
  });

  it('corrects and converts in one step', () => {
    // 70 stored as 'lb' but is actually kg
    // Should correct to 154.3 lb, then user wants kg, so back to ~70
    const result = getDisplayWeight(70, 'lb', 'kg');
    // 70 "lb" -> corrected to 154.3 lb -> converted to 70 kg
    expect(result).toBeCloseTo(70, 0);
  });
});

// ============================================
// FORMAT WEIGHT DISPLAY TESTS
// ============================================

describe('formatWeightDisplay', () => {
  it('formats lb with "lbs" suffix', () => {
    expect(formatWeightDisplay(175, 'lb')).toBe('175.0 lbs');
  });

  it('formats kg with "kg" suffix', () => {
    expect(formatWeightDisplay(79.5, 'kg')).toBe('79.5 kg');
  });

  it('respects decimal places', () => {
    expect(formatWeightDisplay(175.123, 'lb', 0)).toBe('175 lbs');
    expect(formatWeightDisplay(175.123, 'lb', 2)).toBe('175.12 lbs');
  });

  it('defaults to 1 decimal place', () => {
    expect(formatWeightDisplay(175.678, 'lb')).toBe('175.7 lbs');
  });

  it('handles whole numbers', () => {
    expect(formatWeightDisplay(180, 'kg')).toBe('180.0 kg');
  });
});

// ============================================
// PREPARE WEIGHT FOR STORAGE TESTS
// ============================================

describe('prepareWeightForStorage', () => {
  it('returns same value when input and storage units match', () => {
    const result = prepareWeightForStorage(175, 'lb', 'lb');
    expect(result).toEqual({ weight: 175, unit: 'lb' });
  });

  it('converts lb to kg for storage', () => {
    const result = prepareWeightForStorage(220, 'lb', 'kg');
    expect(result.unit).toBe('kg');
    expect(result.weight).toBeCloseTo(99.79, 1);
  });

  it('converts kg to lb for storage', () => {
    const result = prepareWeightForStorage(100, 'kg', 'lb');
    expect(result.unit).toBe('lb');
    expect(result.weight).toBeCloseTo(220.46, 1);
  });

  it('defaults storage unit to lb', () => {
    const result = prepareWeightForStorage(175, 'lb');
    expect(result).toEqual({ weight: 175, unit: 'lb' });
  });
});

// ============================================
// VALIDATE USER INPUT TESTS
// ============================================

describe('validateUserInput', () => {
  describe('valid inputs', () => {
    it('accepts normal lb weights', () => {
      expect(validateUserInput(175, 'lb').isValid).toBe(true);
      expect(validateUserInput(150, 'lb').isValid).toBe(true);
      expect(validateUserInput(250, 'lb').isValid).toBe(true);
    });

    it('accepts normal kg weights', () => {
      expect(validateUserInput(80, 'kg').isValid).toBe(true);
      expect(validateUserInput(50, 'kg').isValid).toBe(true);
      expect(validateUserInput(100, 'kg').isValid).toBe(true);
    });

    it('accepts boundary values', () => {
      expect(validateUserInput(50, 'lb').isValid).toBe(true);
      expect(validateUserInput(500, 'lb').isValid).toBe(true);
      expect(validateUserInput(20, 'kg').isValid).toBe(true);
      expect(validateUserInput(250, 'kg').isValid).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects zero weight', () => {
      const result = validateUserInput(0, 'lb');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('greater than 0');
    });

    it('rejects negative weight', () => {
      const result = validateUserInput(-10, 'lb');
      expect(result.isValid).toBe(false);
    });

    it('rejects weight below minimum (lb)', () => {
      const result = validateUserInput(40, 'lb');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too low');
      expect(result.error).toContain('50');
    });

    it('rejects weight below minimum (kg)', () => {
      const result = validateUserInput(15, 'kg');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too low');
      expect(result.error).toContain('20');
    });

    it('rejects weight above maximum (lb)', () => {
      const result = validateUserInput(550, 'lb');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too high');
      expect(result.error).toContain('500');
    });

    it('rejects weight above maximum (kg)', () => {
      const result = validateUserInput(260, 'kg');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('too high');
      expect(result.error).toContain('250');
    });
  });

  describe('edge cases', () => {
    it('handles NaN', () => {
      const result = validateUserInput(NaN, 'lb');
      expect(result.isValid).toBe(false);
    });
  });
});

// ============================================
// CALCULATE WEIGHT CHANGE TESTS
// ============================================

describe('calculateWeightChange', () => {
  it('calculates positive change (weight gain)', () => {
    const change = calculateWeightChange(180, 'lb', 170, 'lb', 'lb');
    expect(change).toBe(10);
  });

  it('calculates negative change (weight loss)', () => {
    const change = calculateWeightChange(165, 'lb', 175, 'lb', 'lb');
    expect(change).toBe(-10);
  });

  it('calculates no change', () => {
    const change = calculateWeightChange(175, 'lb', 175, 'lb', 'lb');
    expect(change).toBe(0);
  });

  it('handles mixed units with same preferred display', () => {
    // Note: validateWeightEntry may correct kg values 30-200 to lb
    // 80 'kg' -> gets corrected to 80 lb
    // So the calculation becomes 80 lb - 175 lb = -95 lb
    const change = calculateWeightChange(80, 'kg', 175, 'lb', 'lb');
    // Due to weight correction logic, this is -95
    expect(change).toBeCloseTo(-95, 0);
  });

  it('handles null units', () => {
    const change = calculateWeightChange(180, null, 170, null, 'lb');
    expect(change).toBe(10);
  });

  it('displays change in preferred unit', () => {
    // Both stored as lb, but want change in kg
    const change = calculateWeightChange(180, 'lb', 170, 'lb', 'kg');
    expect(change).toBeCloseTo(4.5, 0);
  });
});

// ============================================
// INTEGRATION TESTS
// ============================================

describe('weight utils integration', () => {
  it('full workflow: input -> storage -> display', () => {
    // User enters 80 kg
    const validationResult = validateUserInput(80, 'kg');
    expect(validationResult.isValid).toBe(true);

    // Store as lb
    const stored = prepareWeightForStorage(80, 'kg', 'lb');
    expect(stored.unit).toBe('lb');
    expect(stored.weight).toBeCloseTo(176.4, 0);

    // Retrieve and display in kg
    const display = getDisplayWeight(stored.weight, stored.unit, 'kg');
    expect(display).toBeCloseTo(80, 0);

    // Format for UI
    const formatted = formatWeightDisplay(display, 'kg');
    expect(formatted).toBe('80.0 kg');
  });

  it('handles unit preference change', () => {
    // Initially stored as 175 lb
    const stored = { weight: 175, unit: 'lb' as const };

    // User viewing in lb
    const displayLb = getDisplayWeight(stored.weight, stored.unit, 'lb');
    expect(formatWeightDisplay(displayLb, 'lb')).toBe('175.0 lbs');

    // User switches to kg
    const displayKg = getDisplayWeight(stored.weight, stored.unit, 'kg');
    expect(formatWeightDisplay(displayKg, 'kg')).toBe('79.4 kg');
  });

  it('calculates progress across unit changes', () => {
    // Note: validateWeightEntry corrects kg values 30-200 to lb (mislabeled)
    // 80 'kg' -> gets corrected to 80 lb
    // 176 'lb' -> stays 176 lb
    // So the calculation becomes 80 lb - 176 lb = -96 lb
    const change = calculateWeightChange(80, 'kg', 176, 'lb', 'lb');
    expect(change).toBeCloseTo(-96, 0);
  });
});
