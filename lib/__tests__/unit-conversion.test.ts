import {
  convertWeight,
  kgToLbs,
  lbsToKg,
} from '../utils';

describe('Unit Conversion Utilities', () => {
  describe('kgToLbs', () => {
    test('converts kg to lbs correctly', () => {
      expect(kgToLbs(100)).toBeCloseTo(220.462, 1);
      expect(kgToLbs(0)).toBe(0);
      expect(kgToLbs(1)).toBeCloseTo(2.205, 2);
    });

    test('converts common gym weights accurately', () => {
      // 20kg plates = 45lb standard weight
      expect(kgToLbs(20)).toBeCloseTo(44.09, 1);
      // 60kg = typical starting bench
      expect(kgToLbs(60)).toBeCloseTo(132.28, 1);
      // 100kg = 2 plate bench
      expect(kgToLbs(100)).toBeCloseTo(220.46, 1);
      // 140kg = 3 plate bench
      expect(kgToLbs(140)).toBeCloseTo(308.65, 1);
    });

    test('handles decimal kg values', () => {
      expect(kgToLbs(2.5)).toBeCloseTo(5.51, 1);
      expect(kgToLbs(1.25)).toBeCloseTo(2.76, 1);
    });

    test('handles negative values', () => {
      // Negative weight should still convert correctly (edge case)
      expect(kgToLbs(-10)).toBeCloseTo(-22.05, 1);
    });
  });

  describe('lbsToKg', () => {
    test('converts lbs to kg correctly', () => {
      expect(lbsToKg(220.46)).toBeCloseTo(100, 1);
      expect(lbsToKg(0)).toBe(0);
      expect(lbsToKg(1)).toBeCloseTo(0.4536, 3);
    });

    test('converts common imperial gym weights accurately', () => {
      // 45lb bar/plate
      expect(lbsToKg(45)).toBeCloseTo(20.41, 1);
      // 135lb = 1 plate squat
      expect(lbsToKg(135)).toBeCloseTo(61.23, 1);
      // 225lb = 2 plate bench
      expect(lbsToKg(225)).toBeCloseTo(102.06, 1);
      // 315lb = 3 plate squat
      expect(lbsToKg(315)).toBeCloseTo(142.88, 1);
      // 405lb = 4 plate deadlift
      expect(lbsToKg(405)).toBeCloseTo(183.70, 1);
    });

    test('handles decimal lbs values', () => {
      expect(lbsToKg(2.5)).toBeCloseTo(1.134, 2);
      expect(lbsToKg(5.5)).toBeCloseTo(2.495, 2);
    });

    test('handles negative values', () => {
      expect(lbsToKg(-22.05)).toBeCloseTo(-10, 1);
    });
  });

  describe('convertWeight', () => {
    test('returns same value when units are the same', () => {
      expect(convertWeight(100, 'kg', 'kg')).toBe(100);
      expect(convertWeight(220, 'lb', 'lb')).toBe(220);
    });

    test('converts kg to lb correctly', () => {
      expect(convertWeight(100, 'kg', 'lb')).toBeCloseTo(220.46, 1);
      expect(convertWeight(50, 'kg', 'lb')).toBeCloseTo(110.23, 1);
    });

    test('converts lb to kg correctly', () => {
      expect(convertWeight(220.46, 'lb', 'kg')).toBeCloseTo(100, 1);
      expect(convertWeight(110, 'lb', 'kg')).toBeCloseTo(49.90, 1);
    });

    test('round trip conversion preserves value within tolerance', () => {
      const originalKg = 85.5;
      const convertedToLb = convertWeight(originalKg, 'kg', 'lb');
      const backToKg = convertWeight(convertedToLb, 'lb', 'kg');
      expect(backToKg).toBeCloseTo(originalKg, 1);
    });

    test('round trip from lbs preserves value within tolerance', () => {
      const originalLb = 185;
      const convertedToKg = convertWeight(originalLb, 'lb', 'kg');
      const backToLb = convertWeight(convertedToKg, 'kg', 'lb');
      expect(backToLb).toBeCloseTo(originalLb, 1);
    });

    test('handles zero correctly', () => {
      expect(convertWeight(0, 'kg', 'lb')).toBe(0);
      expect(convertWeight(0, 'lb', 'kg')).toBe(0);
    });
  });

  describe('conversion consistency', () => {
    test('kgToLbs and convertWeight give same results', () => {
      const testValues = [0, 20, 60, 100, 140, 200];

      testValues.forEach(kg => {
        const viaKgToLbs = kgToLbs(kg);
        const viaConvert = convertWeight(kg, 'kg', 'lb');
        expect(viaKgToLbs).toBeCloseTo(viaConvert, 5);
      });
    });

    test('lbsToKg and convertWeight give same results', () => {
      const testValues = [0, 45, 135, 225, 315, 405];

      testValues.forEach(lb => {
        const viaLbsToKg = lbsToKg(lb);
        const viaConvert = convertWeight(lb, 'lb', 'kg');
        expect(viaLbsToKg).toBeCloseTo(viaConvert, 5);
      });
    });

    test('inverse conversions are consistent', () => {
      // kg -> lb -> kg should equal original
      const kgValues = [20, 60, 100, 140, 200];
      kgValues.forEach(kg => {
        const lb = kgToLbs(kg);
        const backToKg = lbsToKg(lb);
        expect(backToKg).toBeCloseTo(kg, 5);
      });

      // lb -> kg -> lb should equal original
      const lbValues = [45, 135, 225, 315, 405];
      lbValues.forEach(lb => {
        const kg = lbsToKg(lb);
        const backToLb = kgToLbs(kg);
        expect(backToLb).toBeCloseTo(lb, 5);
      });
    });
  });
});
