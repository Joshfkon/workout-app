/**
 * Extended tests for lib/utils.ts
 * Covers: date utilities, RPE/RIR conversion, formatting, and utility functions
 */

import {
  getLocalDateString,
  formatDate,
  formatDuration,
  formatWeight,
  formatWeightValue,
  inputWeightToKg,
  roundToIncrement,
  roundToPlateIncrement,
  rirToRpe,
  rpeToRir,
  generateId,
  clamp,
  percentage,
  cn,
} from '../utils';

describe('Date Utilities', () => {
  describe('getLocalDateString', () => {
    it('formats current date as YYYY-MM-DD', () => {
      const result = getLocalDateString();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('formats a specific date correctly', () => {
      const date = new Date(2024, 0, 15); // January 15, 2024
      expect(getLocalDateString(date)).toBe('2024-01-15');
    });

    it('pads single-digit months and days', () => {
      const date = new Date(2024, 4, 5); // May 5, 2024
      expect(getLocalDateString(date)).toBe('2024-05-05');
    });

    it('handles end of year correctly', () => {
      const date = new Date(2024, 11, 31); // December 31, 2024
      expect(getLocalDateString(date)).toBe('2024-12-31');
    });

    it('handles start of year correctly', () => {
      const date = new Date(2024, 0, 1); // January 1, 2024
      expect(getLocalDateString(date)).toBe('2024-01-01');
    });
  });

  describe('formatDate', () => {
    it('formats YYYY-MM-DD string as local date', () => {
      const result = formatDate('2024-01-15');
      expect(result).toContain('Jan');
      expect(result).toContain('15');
      expect(result).toContain('2024');
    });

    it('formats Date object correctly', () => {
      const date = new Date(2024, 0, 15);
      const result = formatDate(date);
      expect(result).toContain('Jan');
      expect(result).toContain('15');
    });

    it('respects custom format options', () => {
      const result = formatDate('2024-01-15', { weekday: 'long' });
      expect(result).toBeTruthy();
    });

    it('handles ISO date strings', () => {
      const result = formatDate('2024-01-15T12:00:00Z');
      expect(result).toContain('2024');
    });
  });

  describe('formatDuration', () => {
    it('formats seconds to mm:ss', () => {
      expect(formatDuration(90)).toBe('1:30');
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(60)).toBe('1:00');
    });

    it('pads single-digit seconds', () => {
      expect(formatDuration(65)).toBe('1:05');
      expect(formatDuration(5)).toBe('0:05');
    });

    it('handles large durations', () => {
      expect(formatDuration(3600)).toBe('60:00');
      expect(formatDuration(3665)).toBe('61:05');
    });
  });
});

describe('RPE/RIR Conversion', () => {
  describe('rirToRpe', () => {
    it('converts RIR to RPE correctly', () => {
      expect(rirToRpe(0)).toBe(10);
      expect(rirToRpe(1)).toBe(9);
      expect(rirToRpe(2)).toBe(8);
      expect(rirToRpe(3)).toBe(7);
      expect(rirToRpe(4)).toBe(6);
      expect(rirToRpe(5)).toBe(5);
    });

    it('handles decimal RIR values', () => {
      expect(rirToRpe(1.5)).toBe(8.5);
      expect(rirToRpe(0.5)).toBe(9.5);
    });
  });

  describe('rpeToRir', () => {
    it('converts RPE to RIR correctly', () => {
      expect(rpeToRir(10)).toBe(0);
      expect(rpeToRir(9)).toBe(1);
      expect(rpeToRir(8)).toBe(2);
      expect(rpeToRir(7)).toBe(3);
      expect(rpeToRir(6)).toBe(4);
    });

    it('handles decimal RPE values', () => {
      expect(rpeToRir(8.5)).toBe(1.5);
      expect(rpeToRir(7.5)).toBe(2.5);
    });
  });

  describe('round trip conversion', () => {
    it('rirToRpe and rpeToRir are inverses', () => {
      for (let rir = 0; rir <= 5; rir++) {
        expect(rpeToRir(rirToRpe(rir))).toBe(rir);
      }
      for (let rpe = 5; rpe <= 10; rpe++) {
        expect(rirToRpe(rpeToRir(rpe))).toBe(rpe);
      }
    });
  });
});

describe('Weight Formatting', () => {
  describe('formatWeight', () => {
    it('formats kg weights with rounding', () => {
      expect(formatWeight(100, 'kg')).toBe('100.0 kg');
      expect(formatWeight(102.5, 'kg')).toBe('102.5 kg');
    });

    it('formats lb weights with conversion and rounding', () => {
      const result = formatWeight(100, 'lb');
      expect(result).toContain('lbs');
      expect(parseFloat(result)).toBeCloseTo(220, 0);
    });

    it('rounds light kg weights to nearest 1kg', () => {
      expect(formatWeight(15.3, 'kg')).toBe('15.0 kg');
      expect(formatWeight(18.7, 'kg')).toBe('19.0 kg');
    });

    it('rounds heavier kg weights to nearest 2.5kg', () => {
      expect(formatWeight(23, 'kg')).toBe('22.5 kg');
      expect(formatWeight(26, 'kg')).toBe('25.0 kg');
    });

    it('handles custom decimal places', () => {
      expect(formatWeight(100, 'kg', 2)).toBe('100.00 kg');
    });
  });

  describe('formatWeightValue', () => {
    it('returns numeric value without unit', () => {
      expect(formatWeightValue(100, 'kg')).toBe(100);
      expect(typeof formatWeightValue(100, 'kg')).toBe('number');
    });

    it('rounds to plate increments in kg', () => {
      expect(formatWeightValue(23, 'kg')).toBe(22.5);
      expect(formatWeightValue(26, 'kg')).toBe(25);
    });

    it('converts and rounds for lb', () => {
      const result = formatWeightValue(100, 'lb');
      expect(result).toBeCloseTo(220, 0);
    });
  });

  describe('inputWeightToKg', () => {
    it('returns same value for kg input', () => {
      expect(inputWeightToKg(100, 'kg')).toBe(100);
      expect(inputWeightToKg(50.5, 'kg')).toBe(50.5);
    });

    it('converts lb to kg', () => {
      expect(inputWeightToKg(220.46, 'lb')).toBeCloseTo(100, 0);
      expect(inputWeightToKg(135, 'lb')).toBeCloseTo(61.2, 0);
    });
  });
});

describe('Rounding Utilities', () => {
  describe('roundToIncrement', () => {
    it('rounds to specified increment', () => {
      expect(roundToIncrement(23, 2.5)).toBe(22.5);
      expect(roundToIncrement(26, 2.5)).toBe(25);
      expect(roundToIncrement(27.5, 2.5)).toBe(27.5);
    });

    it('rounds to 1kg increment', () => {
      expect(roundToIncrement(15.3, 1)).toBe(15);
      expect(roundToIncrement(15.7, 1)).toBe(16);
    });

    it('rounds to 5kg increment', () => {
      expect(roundToIncrement(23, 5)).toBe(25);
      expect(roundToIncrement(22, 5)).toBe(20);
    });
  });

  describe('roundToPlateIncrement', () => {
    it('rounds kg weights to 2.5kg increments for heavy weights', () => {
      expect(roundToPlateIncrement(23, 'kg')).toBe(22.5);
      expect(roundToPlateIncrement(26, 'kg')).toBe(25);
    });

    it('rounds light kg weights to nearest 1kg', () => {
      expect(roundToPlateIncrement(15.3, 'kg')).toBe(15);
      expect(roundToPlateIncrement(18.7, 'kg')).toBe(19);
    });

    it('handles lb unit by converting internally', () => {
      // 100kg = 220.46lb, round to 2.5lb = 220lb, back to kg
      const result = roundToPlateIncrement(100, 'lb');
      expect(result).toBeGreaterThan(99);
      expect(result).toBeLessThan(101);
    });
  });
});

describe('Utility Functions', () => {
  describe('generateId', () => {
    it('generates unique IDs', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).not.toBe(id2);
    });

    it('generates IDs with timestamp prefix', () => {
      const id = generateId();
      const parts = id.split('-');
      expect(parts.length).toBe(2);
      expect(parseInt(parts[0])).toBeGreaterThan(0);
    });
  });

  describe('clamp', () => {
    it('clamps value within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('handles edge cases', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });

    it('works with negative ranges', () => {
      expect(clamp(0, -10, -5)).toBe(-5);
      expect(clamp(-15, -10, -5)).toBe(-10);
    });
  });

  describe('percentage', () => {
    it('calculates percentage correctly', () => {
      expect(percentage(25, 100)).toBe(25);
      expect(percentage(1, 2)).toBe(50);
      expect(percentage(1, 3)).toBe(33);
    });

    it('handles zero total', () => {
      expect(percentage(5, 0)).toBe(0);
    });

    it('handles values greater than total', () => {
      expect(percentage(150, 100)).toBe(150);
    });
  });

  describe('cn (classnames)', () => {
    it('merges class names', () => {
      expect(cn('foo', 'bar')).toBe('foo bar');
    });

    it('handles conditional classes', () => {
      expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz');
      expect(cn('foo', true && 'bar')).toBe('foo bar');
    });

    it('handles undefined and null', () => {
      expect(cn('foo', undefined, null, 'bar')).toBe('foo bar');
    });

    it('handles empty input', () => {
      expect(cn()).toBe('');
    });
  });
});
