import {
  convertWeight,
  formatWeight,
  formatWeightValue,
  inputWeightToKg,
  kgToLbs,
  lbsToKg,
  roundToIncrement,
  roundToPlateIncrement,
} from '../utils';

describe('Unit Edge Cases', () => {
  describe('very small weights', () => {
    test('displays 0.5 kg correctly in metric', () => {
      const result = formatWeight(0.5, 'kg');
      expect(result).toBe('1.0 kg'); // Rounds to nearest 1 for small weights
    });

    test('displays 0.5 kg correctly in imperial', () => {
      // 0.5kg = 1.1 lbs, rounded to 2.5lb increment
      const result = formatWeight(0.5, 'lb');
      expect(result).toMatch(/0\.0 lbs|2\.5 lbs/);
    });

    test('handles fractional plate weights (1.25kg)', () => {
      const result = formatWeight(1.25, 'kg');
      expect(result).toBe('1.0 kg'); // Rounds to nearest for small weights
    });

    test('handles fractional plate weights (2.5lb)', () => {
      // 2.5lb = 1.13kg
      const stored = inputWeightToKg(2.5, 'lb');
      expect(stored).toBeCloseTo(1.13, 1);
    });
  });

  describe('very large weights', () => {
    test('displays 500kg correctly in metric', () => {
      const result = formatWeight(500, 'kg');
      expect(result).toBe('500.0 kg');
    });

    test('displays 500kg correctly in imperial', () => {
      // 500kg = 1102.3 lbs
      const result = formatWeight(500, 'lb');
      const value = parseFloat(result);
      expect(value).toBeCloseTo(1102.5, 0);
    });

    test('handles world record level weights', () => {
      const eddiehallDeadlift = 500; // kg
      const inLbs = kgToLbs(eddiehallDeadlift);
      expect(inLbs).toBeCloseTo(1102.3, 0);
    });
  });

  describe('floating point precision', () => {
    test('common barbell weights display without floating point errors', () => {
      // Test common plate combinations
      const plateWeightsLb = [45, 90, 135, 180, 225, 270, 315, 360, 405];

      plateWeightsLb.forEach(lbs => {
        const result = formatWeight(inputWeightToKg(lbs, 'lb'), 'lb');
        const parsed = parseFloat(result);
        // Should be close to original without weird decimals like 224.99999
        expect(parsed % 2.5).toBeCloseTo(0, 1);
      });
    });

    test('plate increments produce clean values in kg', () => {
      const plateWeightsKg = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200];

      plateWeightsKg.forEach(kg => {
        const result = formatWeight(kg, 'kg');
        const parsed = parseFloat(result);
        expect(parsed).toBe(kg);
      });
    });

    test('2.5 increment rounding is precise', () => {
      expect(roundToIncrement(100, 2.5)).toBe(100);
      // 101/2.5 = 40.4, rounds to 40, * 2.5 = 100
      expect(roundToIncrement(101, 2.5)).toBe(100);
      // 101.25/2.5 = 40.5, rounds to 41, * 2.5 = 102.5
      expect(roundToIncrement(101.25, 2.5)).toBe(102.5);
      expect(roundToIncrement(101.5, 2.5)).toBe(102.5);
      // 103/2.5 = 41.2, rounds to 41, * 2.5 = 102.5
      expect(roundToIncrement(103, 2.5)).toBe(102.5);
      expect(roundToIncrement(103.75, 2.5)).toBe(105);
    });

    test('no precision loss in conversion chain', () => {
      const testValues = [20, 60, 100, 140, 180, 200, 250];

      testValues.forEach(kg => {
        const lbs = kgToLbs(kg);
        const backToKg = lbsToKg(lbs);
        // Should be equal within floating point tolerance
        expect(Math.abs(backToKg - kg)).toBeLessThan(0.0001);
      });
    });
  });

  describe('zero values', () => {
    test('zero kg formats correctly', () => {
      expect(formatWeight(0, 'kg')).toBe('0.0 kg');
      expect(formatWeightValue(0, 'kg')).toBe(0);
    });

    test('zero lb formats correctly', () => {
      expect(formatWeight(0, 'lb')).toBe('0.0 lbs');
      expect(formatWeightValue(0, 'lb')).toBe(0);
    });

    test('zero converts correctly', () => {
      expect(convertWeight(0, 'kg', 'lb')).toBe(0);
      expect(convertWeight(0, 'lb', 'kg')).toBe(0);
      expect(inputWeightToKg(0, 'kg')).toBe(0);
      expect(inputWeightToKg(0, 'lb')).toBe(0);
    });
  });

  describe('negative values', () => {
    // Negative weights don't make physical sense but should handle gracefully
    test('negative kg converts to negative lb', () => {
      expect(kgToLbs(-10)).toBeCloseTo(-22.05, 1);
    });

    test('negative lb converts to negative kg', () => {
      expect(lbsToKg(-22)).toBeCloseTo(-9.98, 1);
    });
  });

  describe('boundary values', () => {
    test('handles weight at 20kg threshold (rounding rule boundary)', () => {
      // Below 20kg: round to nearest 1
      expect(formatWeightValue(19, 'kg')).toBe(19);
      expect(formatWeightValue(19.4, 'kg')).toBe(19);
      expect(formatWeightValue(19.6, 'kg')).toBe(20);

      // At and above 20kg: round to nearest 2.5
      expect(formatWeightValue(20, 'kg')).toBe(20);
      expect(formatWeightValue(21, 'kg')).toBe(20);
      expect(formatWeightValue(21.5, 'kg')).toBe(22.5);
    });

    test('handles weight at 45lb threshold (light weight boundary)', () => {
      // 45lb = 20.41kg, which is the bar weight
      const barWeight = 45;
      const stored = inputWeightToKg(barWeight, 'lb');
      const displayed = formatWeightValue(stored, 'lb');

      expect(displayed).toBeCloseTo(45, 0);
    });
  });

  describe('common equipment weights', () => {
    test('standard barbell (45lb / 20kg)', () => {
      const barKg = 20;
      const barLb = 45;

      // 20kg bar should display as ~45lb
      expect(kgToLbs(barKg)).toBeCloseTo(44.09, 1);

      // 45lb bar should store as ~20.4kg
      expect(lbsToKg(barLb)).toBeCloseTo(20.41, 1);
    });

    test('Olympic plates (20kg / 45lb)', () => {
      const plateKg = 20;
      const plateLb = 45;

      expect(kgToLbs(plateKg)).toBeCloseTo(44.09, 1);
      expect(lbsToKg(plateLb)).toBeCloseTo(20.41, 1);
    });

    test('micro plates (1.25kg / 2.5lb)', () => {
      const microKg = 1.25;
      const microLb = 2.5;

      expect(kgToLbs(microKg)).toBeCloseTo(2.76, 1);
      expect(lbsToKg(microLb)).toBeCloseTo(1.13, 1);
    });

    test('change plates (2.5kg / 5lb)', () => {
      const changeKg = 2.5;
      const changeLb = 5;

      expect(kgToLbs(changeKg)).toBeCloseTo(5.51, 1);
      expect(lbsToKg(changeLb)).toBeCloseTo(2.27, 1);
    });
  });

  describe('milestone weights', () => {
    // Common gym milestones that should display cleanly
    const METRIC_MILESTONES = [
      { kg: 60, description: '1 plate each side' },
      { kg: 100, description: '2 plates each side' },
      { kg: 140, description: '3 plates each side' },
      { kg: 180, description: '4 plates each side' },
      { kg: 220, description: '5 plates each side' },
    ];

    const IMPERIAL_MILESTONES = [
      { lb: 135, description: '1 plate each side' },
      { lb: 225, description: '2 plates each side' },
      { lb: 315, description: '3 plates each side' },
      { lb: 405, description: '4 plates each side' },
      { lb: 495, description: '5 plates each side' },
    ];

    test('metric milestones display correctly', () => {
      METRIC_MILESTONES.forEach(({ kg, description }) => {
        const displayed = formatWeight(kg, 'kg');
        expect(displayed).toBe(`${kg}.0 kg`);
      });
    });

    test('imperial milestones round-trip correctly', () => {
      IMPERIAL_MILESTONES.forEach(({ lb }) => {
        const stored = inputWeightToKg(lb, 'lb');
        const displayed = convertWeight(stored, 'kg', 'lb');
        expect(displayed).toBeCloseTo(lb, 1);
      });
    });
  });

  describe('plate math accuracy', () => {
    test('standard lb plate math', () => {
      // bar(45) + 2x45 = 135
      const onePlate = 135;
      // bar(45) + 4x45 = 225
      const twoPlate = 225;
      // bar(45) + 6x45 = 315
      const threePlate = 315;

      expect(45 + 2 * 45).toBe(onePlate);
      expect(45 + 4 * 45).toBe(twoPlate);
      expect(45 + 6 * 45).toBe(threePlate);
    });

    test('standard kg plate math', () => {
      // bar(20) + 2x20 = 60
      const onePlate = 60;
      // bar(20) + 4x20 = 100
      const twoPlate = 100;
      // bar(20) + 6x20 = 140
      const threePlate = 140;

      expect(20 + 2 * 20).toBe(onePlate);
      expect(20 + 4 * 20).toBe(twoPlate);
      expect(20 + 6 * 20).toBe(threePlate);
    });
  });

  describe('roundToPlateIncrement edge cases', () => {
    test('handles exact 2.5 multiples in kg', () => {
      expect(roundToPlateIncrement(100, 'kg')).toBe(100);
      expect(roundToPlateIncrement(102.5, 'kg')).toBe(102.5);
      expect(roundToPlateIncrement(105, 'kg')).toBe(105);
    });

    test('handles non-2.5 multiples in kg', () => {
      expect(roundToPlateIncrement(101, 'kg')).toBe(100);
      expect(roundToPlateIncrement(101.5, 'kg')).toBe(102.5);
      expect(roundToPlateIncrement(103, 'kg')).toBe(102.5);
      expect(roundToPlateIncrement(104, 'kg')).toBe(105);
    });

    test('rounds light kg weights to nearest 1', () => {
      expect(roundToPlateIncrement(10, 'kg')).toBe(10);
      expect(roundToPlateIncrement(10.3, 'kg')).toBe(10);
      expect(roundToPlateIncrement(10.6, 'kg')).toBe(11);
    });
  });
});
