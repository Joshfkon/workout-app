import {
  formatWeight,
  formatWeightValue,
  roundToPlateIncrement,
  roundToIncrement,
} from '../utils';

describe('Unit Display Formatting', () => {
  describe('formatWeight', () => {
    describe('with kg preference', () => {
      test('displays kg when user prefers metric', () => {
        expect(formatWeight(100, 'kg')).toBe('100.0 kg');
        expect(formatWeight(60, 'kg')).toBe('60.0 kg');
      });

      test('rounds to 2.5kg increments for weights >= 20kg', () => {
        expect(formatWeight(100, 'kg')).toBe('100.0 kg');
        expect(formatWeight(101, 'kg')).toBe('100.0 kg'); // rounds down
        expect(formatWeight(101.5, 'kg')).toBe('102.5 kg'); // rounds up
        expect(formatWeight(62.5, 'kg')).toBe('62.5 kg');
      });

      test('rounds to nearest kg for weights < 20kg', () => {
        expect(formatWeight(15, 'kg')).toBe('15.0 kg');
        expect(formatWeight(15.4, 'kg')).toBe('15.0 kg');
        expect(formatWeight(15.6, 'kg')).toBe('16.0 kg');
      });

      test('handles zero correctly', () => {
        expect(formatWeight(0, 'kg')).toBe('0.0 kg');
      });
    });

    describe('with lb preference', () => {
      test('converts and displays lbs when user prefers imperial', () => {
        // 100kg = ~220.46 lbs, rounded to 2.5 = 220
        expect(formatWeight(100, 'lb')).toBe('220.0 lbs');
      });

      test('rounds to 2.5lb increments', () => {
        // 45kg = 99.2 lbs -> 100 lbs (rounded to 2.5)
        expect(formatWeight(45, 'lb')).toBe('100.0 lbs');

        // 60kg = 132.3 lbs -> 132.5 lbs
        expect(formatWeight(60, 'lb')).toBe('132.5 lbs');
      });

      test('handles common plate weights', () => {
        // 20kg = ~44 lbs -> 45 lbs
        expect(formatWeight(20, 'lb')).toBe('45.0 lbs');

        // 140kg = ~308 lbs -> 307.5 or 310 lbs
        const result = formatWeight(140, 'lb');
        expect(result).toMatch(/\d+\.\d lbs/);
      });

      test('handles zero correctly', () => {
        expect(formatWeight(0, 'lb')).toBe('0.0 lbs');
      });
    });

    describe('with custom decimal places', () => {
      test('respects decimals parameter', () => {
        expect(formatWeight(100, 'kg', 0)).toBe('100 kg');
        expect(formatWeight(100, 'kg', 2)).toBe('100.00 kg');
        expect(formatWeight(62.5, 'kg', 1)).toBe('62.5 kg');
      });
    });
  });

  describe('formatWeightValue', () => {
    describe('with kg preference', () => {
      test('returns numeric value without unit suffix', () => {
        expect(formatWeightValue(100, 'kg')).toBe(100);
        expect(formatWeightValue(62.5, 'kg')).toBe(62.5);
      });

      test('rounds to 2.5kg increments for weights >= 20kg', () => {
        expect(formatWeightValue(101, 'kg')).toBe(100);
        expect(formatWeightValue(101.5, 'kg')).toBe(102.5);
      });

      test('rounds to nearest kg for weights < 20kg', () => {
        expect(formatWeightValue(15.4, 'kg')).toBe(15);
        expect(formatWeightValue(15.6, 'kg')).toBe(16);
      });
    });

    describe('with lb preference', () => {
      test('converts and returns numeric value in lbs', () => {
        // 100kg = ~220.46 lbs, rounded to 2.5 = 220
        expect(formatWeightValue(100, 'lb')).toBe(220);
      });

      test('rounds to 2.5lb increments', () => {
        const result = formatWeightValue(45, 'lb');
        expect(result % 2.5).toBe(0);
      });
    });

    describe('with custom decimal places', () => {
      test('respects decimals parameter', () => {
        expect(formatWeightValue(62.5, 'kg', 0)).toBe(63);
        expect(formatWeightValue(62.5, 'kg', 1)).toBe(62.5);
      });
    });
  });

  describe('roundToPlateIncrement', () => {
    describe('with kg preference', () => {
      test('rounds to 2.5kg increments for weights >= 20kg', () => {
        expect(roundToPlateIncrement(100, 'kg')).toBe(100);
        expect(roundToPlateIncrement(101, 'kg')).toBe(100);
        expect(roundToPlateIncrement(101.5, 'kg')).toBe(102.5);
        expect(roundToPlateIncrement(98.75, 'kg')).toBe(100);
      });

      test('rounds to nearest kg for weights < 20kg', () => {
        expect(roundToPlateIncrement(15, 'kg')).toBe(15);
        expect(roundToPlateIncrement(15.4, 'kg')).toBe(15);
        expect(roundToPlateIncrement(15.6, 'kg')).toBe(16);
      });

      test('handles edge case at 20kg threshold', () => {
        expect(roundToPlateIncrement(19.9, 'kg')).toBe(20);
        expect(roundToPlateIncrement(20, 'kg')).toBe(20);
        expect(roundToPlateIncrement(21, 'kg')).toBe(20);
      });
    });

    describe('with lb preference', () => {
      test('rounds to 2.5lb increments and converts back to kg', () => {
        // Input is in kg, rounds in lb space, returns kg
        const result = roundToPlateIncrement(100, 'lb');
        // 100kg = 220.46 lbs -> 220 lbs -> ~99.79 kg
        expect(result).toBeCloseTo(99.79, 0);
      });

      test('handles common imperial weights', () => {
        // 20.41kg = 45lb (bar weight)
        const barWeight = roundToPlateIncrement(20.41, 'lb');
        // Should round to 45lb = 20.41kg
        expect(barWeight).toBeCloseTo(20.41, 0);
      });
    });
  });

  describe('roundToIncrement', () => {
    test('rounds to specified increment using standard rounding', () => {
      expect(roundToIncrement(100, 2.5)).toBe(100);
      // Math.round(101/2.5) = Math.round(40.4) = 40, * 2.5 = 100
      expect(roundToIncrement(101, 2.5)).toBe(100);
      // Math.round(101.25/2.5) = Math.round(40.5) = 41, * 2.5 = 102.5 (rounds up at .5)
      expect(roundToIncrement(101.25, 2.5)).toBe(102.5);
      expect(roundToIncrement(101.5, 2.5)).toBe(102.5);
    });

    test('handles 1kg increments', () => {
      expect(roundToIncrement(15.4, 1)).toBe(15);
      expect(roundToIncrement(15.5, 1)).toBe(16);
      expect(roundToIncrement(15.6, 1)).toBe(16);
    });

    test('handles 5kg increments', () => {
      expect(roundToIncrement(97, 5)).toBe(95);
      expect(roundToIncrement(98, 5)).toBe(100);
      expect(roundToIncrement(102, 5)).toBe(100);
    });

    test('handles zero correctly', () => {
      expect(roundToIncrement(0, 2.5)).toBe(0);
      expect(roundToIncrement(0, 5)).toBe(0);
    });
  });
});
