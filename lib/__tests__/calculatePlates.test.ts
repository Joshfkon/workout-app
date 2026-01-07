/**
 * Tests for calculatePlates function in lib/utils.ts
 *
 * Regression test for: Unit mismatch bug where machine starting weight
 * was converted to kg while target weight remained in display units (lb),
 * causing incorrect plate calculations.
 */

import { calculatePlates } from '../utils';

describe('calculatePlates', () => {
  describe('barbell calculations (no starting weight)', () => {
    it('calculates plates for standard Olympic bar in kg', () => {
      // 100kg total: 20kg bar + 40kg per side
      const result = calculatePlates(100, 20, 'kg');

      expect(result.isValid).toBe(true);
      expect(result.barbellWeight).toBe(20);
      expect(result.weightPerSide).toBe(40);
      expect(result.actualTotal).toBe(100);
      // Greedy algorithm: 25 + 15 = 40kg per side (standard kg plates: 25, 20, 15, 10, 5, 2.5, 1.25)
      expect(result.platesPerSide).toEqual([25, 15]);
    });

    it('calculates plates for standard Olympic bar in lb', () => {
      // 225lb total: 45lb bar + 90lb per side
      const result = calculatePlates(225, 45, 'lb');

      expect(result.isValid).toBe(true);
      expect(result.barbellWeight).toBe(45);
      expect(result.weightPerSide).toBe(90);
      expect(result.actualTotal).toBe(225);
      expect(result.platesPerSide).toEqual([45, 45]); // 2x45lb per side
    });

    it('returns error when target is less than barbell weight', () => {
      const result = calculatePlates(30, 45, 'lb');

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('at least 45lb');
    });
  });

  describe('machine calculations (with starting weight)', () => {
    it('calculates plates for machine with starting weight in kg', () => {
      // Target 100kg, machine starts at 25kg
      // Needs 75kg of plates = 37.5kg per side
      const result = calculatePlates(100, 0, 'kg', undefined, 25);

      expect(result.isValid).toBe(true);
      expect(result.barbellWeight).toBe(0);
      expect(result.actualTotal).toBe(100);
      // 37.5kg per side = 25 + 10 + 2.5
      expect(result.platesPerSide).toEqual([25, 10, 2.5]);
      expect(result.weightPerSide).toBe(37.5);
    });

    it('calculates plates for machine with starting weight in lb', () => {
      // Target 295lb, machine starts at 54lb
      // Needs 241lb of plates = 120.5lb per side
      // Closest achievable: 120lb per side = 240lb plates
      // Total: 54 + 240 = 294lb
      const result = calculatePlates(295, 0, 'lb', undefined, 54);

      expect(result.isValid).toBe(false); // Can't exactly hit 295
      expect(result.barbellWeight).toBe(0);
      expect(result.actualTotal).toBe(294);
      // 120lb per side = 45 + 45 + 25 + 5
      expect(result.platesPerSide).toEqual([45, 45, 25, 5]);
      expect(result.weightPerSide).toBe(120);
      expect(result.error).toContain('Closest: 294lb');
    });

    /**
     * REGRESSION TEST: Unit mismatch bug
     *
     * Previously, the PlateCalculator component converted startingWeight to kg
     * before passing to calculatePlates, while targetWeight remained in lb.
     * This caused the function to subtract kg from lb, producing wrong results.
     *
     * Bug scenario: Target 295lb with 54lb starting weight
     * - Buggy: 295 - (54/2.20462) = 295 - 24.49 = 270.51 → 135lb/side → 3x45
     * - Fixed: 295 - 54 = 241 → 120.5lb/side → 2x45 + 25 + 5
     */
    it('REGRESSION: does not mix units when calculating machine plates in lb', () => {
      // This is the exact scenario from the bug report
      const result = calculatePlates(295, 0, 'lb', undefined, 54);

      // The buggy calculation would give ~135lb per side (3x45 plates = incorrect)
      // The correct calculation gives 120lb per side (2x45 + 25 + 5)
      expect(result.weightPerSide).toBe(120);

      // Should have exactly 2x45 plates, NOT 3x45 (which the bug produced)
      const count45Plates = result.platesPerSide.filter(p => p === 45).length;
      expect(count45Plates).toBe(2);
      expect(count45Plates).not.toBe(3); // This is what the bug produced

      // Actual total should be 294 (integer), not ~294.49 (float from mixed units)
      expect(result.actualTotal).toBe(294);
      expect(Number.isInteger(result.actualTotal)).toBe(true);
    });

    it('calculates exact match for machine in lb', () => {
      // Target 304lb, machine starts at 54lb
      // Needs 250lb of plates = 125lb per side
      // 125 = 45 + 45 + 35
      const result = calculatePlates(304, 0, 'lb', undefined, 54);

      expect(result.isValid).toBe(true);
      expect(result.actualTotal).toBe(304);
      expect(result.weightPerSide).toBe(125);
      expect(result.platesPerSide).toEqual([45, 45, 35]);
    });

    it('returns error when target is less than starting weight', () => {
      const result = calculatePlates(40, 0, 'lb', undefined, 54);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('at least 54lb');
    });

    it('handles zero plate weight needed', () => {
      // Target equals starting weight - no plates needed
      const result = calculatePlates(54, 0, 'lb', undefined, 54);

      expect(result.isValid).toBe(true);
      expect(result.actualTotal).toBe(54);
      expect(result.platesPerSide).toEqual([]);
      expect(result.weightPerSide).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles custom plate availability', () => {
      // Only have 45lb and 10lb plates
      const result = calculatePlates(225, 45, 'lb', [45, 10]);

      expect(result.isValid).toBe(true);
      expect(result.platesPerSide).toEqual([45, 45]); // 90lb per side
    });

    it('returns closest achievable when exact match impossible', () => {
      // Target 227lb with 45lb bar = 182lb plates = 91lb per side
      // With standard lb plates, closest is 90lb per side
      const result = calculatePlates(227, 45, 'lb');

      expect(result.isValid).toBe(false);
      expect(result.actualTotal).toBe(225); // 45 + 90*2
      expect(result.error).toContain('Closest: 225lb');
    });
  });
});
