import {
  inputWeightToKg,
  convertWeight,
  lbsToKg,
  kgToLbs,
} from '../utils';

describe('Unit Input Handling', () => {
  describe('inputWeightToKg', () => {
    test('returns same value when input unit is kg', () => {
      expect(inputWeightToKg(100, 'kg')).toBe(100);
      expect(inputWeightToKg(62.5, 'kg')).toBe(62.5);
      expect(inputWeightToKg(0, 'kg')).toBe(0);
    });

    test('converts lb input to kg', () => {
      // 220 lbs should convert to ~100kg
      expect(inputWeightToKg(220, 'lb')).toBeCloseTo(99.79, 1);

      // 45 lbs (bar weight) should convert to ~20.4kg
      expect(inputWeightToKg(45, 'lb')).toBeCloseTo(20.41, 1);

      // 135 lbs (1 plate squat) should convert to ~61.2kg
      expect(inputWeightToKg(135, 'lb')).toBeCloseTo(61.23, 1);

      // 225 lbs (2 plate bench) should convert to ~102kg
      expect(inputWeightToKg(225, 'lb')).toBeCloseTo(102.06, 1);

      // 315 lbs (3 plate squat) should convert to ~142.9kg
      expect(inputWeightToKg(315, 'lb')).toBeCloseTo(142.88, 1);
    });

    test('handles zero correctly in lb mode', () => {
      expect(inputWeightToKg(0, 'lb')).toBe(0);
    });

    test('handles decimal lb values', () => {
      expect(inputWeightToKg(132.5, 'lb')).toBeCloseTo(60.1, 1);
    });
  });

  describe('weight input/output round trip', () => {
    test('kg input -> store -> kg display preserves value', () => {
      const userInput = 100; // User enters 100kg
      const stored = inputWeightToKg(userInput, 'kg'); // Store as kg
      const displayed = convertWeight(stored, 'kg', 'kg'); // Display as kg

      expect(displayed).toBe(userInput);
    });

    test('lb input -> store -> lb display preserves value within tolerance', () => {
      const userInput = 225; // User enters 225lb
      const stored = inputWeightToKg(userInput, 'lb'); // Store as kg
      const displayed = convertWeight(stored, 'kg', 'lb'); // Display as lb

      expect(displayed).toBeCloseTo(userInput, 1);
    });

    test('kg input -> store -> lb display converts correctly', () => {
      const userInput = 100; // User enters 100kg
      const stored = inputWeightToKg(userInput, 'kg'); // Store as kg
      const displayed = convertWeight(stored, 'kg', 'lb'); // Display as lb

      expect(displayed).toBeCloseTo(220.46, 1);
    });

    test('lb input -> store -> kg display converts correctly', () => {
      const userInput = 225; // User enters 225lb
      const stored = inputWeightToKg(userInput, 'lb'); // Store as kg
      const displayed = convertWeight(stored, 'kg', 'kg'); // Display as kg

      expect(displayed).toBeCloseTo(102.06, 1);
    });
  });

  describe('typical user workflows', () => {
    test('metric user logs workout in kg', () => {
      // User enters weight in kg
      const input = 60;
      const unit = 'kg' as const;

      // Store in kg (canonical unit)
      const stored = inputWeightToKg(input, unit);
      expect(stored).toBe(60);

      // Display to user in their preferred unit (kg)
      const displayValue = convertWeight(stored, 'kg', 'kg');
      expect(displayValue).toBe(60);
    });

    test('imperial user logs workout in lbs', () => {
      // User enters weight in lbs
      const input = 135;
      const unit = 'lb' as const;

      // Store in kg (canonical unit)
      const stored = inputWeightToKg(input, unit);
      expect(stored).toBeCloseTo(61.23, 1);

      // Display to user in their preferred unit (lbs)
      const displayValue = convertWeight(stored, 'kg', 'lb');
      expect(displayValue).toBeCloseTo(135, 1);
    });

    test('user switches from metric to imperial, sees correct values', () => {
      // User originally logged in kg
      const originalInput = 100;
      const stored = inputWeightToKg(originalInput, 'kg');

      // User switches to imperial
      const displayedInLbs = convertWeight(stored, 'kg', 'lb');
      expect(displayedInLbs).toBeCloseTo(220.46, 1);
    });

    test('user switches from imperial to metric, sees correct values', () => {
      // User originally logged in lbs
      const originalInput = 225;
      const stored = inputWeightToKg(originalInput, 'lb');

      // User switches to metric
      const displayedInKg = convertWeight(stored, 'kg', 'kg');
      expect(displayedInKg).toBeCloseTo(102.06, 1);
    });
  });

  describe('common plate combinations', () => {
    const PLATES_LB = {
      bar: 45,
      onePlate: 135,  // bar + 2x45
      twoPlate: 225,  // bar + 4x45
      threePlate: 315, // bar + 6x45
      fourPlate: 405,  // bar + 8x45
    };

    const PLATES_KG = {
      bar: 20,
      onePlate: 60,   // bar + 2x20
      twoPlate: 100,  // bar + 4x20
      threePlate: 140, // bar + 6x20
      fourPlate: 180,  // bar + 8x20
    };

    test('imperial plate weights convert correctly to storage', () => {
      Object.entries(PLATES_LB).forEach(([name, lbs]) => {
        const kg = inputWeightToKg(lbs, 'lb');
        // Just verify it's a reasonable conversion
        expect(kg).toBeGreaterThan(0);
        expect(kg).toBeLessThan(lbs); // kg should always be less than lbs for same weight
      });
    });

    test('metric plate weights are stored directly', () => {
      Object.entries(PLATES_KG).forEach(([name, kg]) => {
        const stored = inputWeightToKg(kg, 'kg');
        expect(stored).toBe(kg);
      });
    });

    test('plate weights round trip correctly between systems', () => {
      // Test common lb milestones
      [135, 225, 315, 405].forEach(lbs => {
        const kg = lbsToKg(lbs);
        const backToLbs = kgToLbs(kg);
        expect(backToLbs).toBeCloseTo(lbs, 1);
      });

      // Test common kg milestones
      [60, 100, 140, 180].forEach(kg => {
        const lbs = kgToLbs(kg);
        const backToKg = lbsToKg(lbs);
        expect(backToKg).toBeCloseTo(kg, 1);
      });
    });
  });
});
