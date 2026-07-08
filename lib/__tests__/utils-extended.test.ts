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
  rirToRpeLinear,
  rpeToRirLinear,
  generateId,
  clamp,
  percentage,
  cn,
  calculateStreaks,
  formatDistanceToNow,
  estimateE1RM,
  debounce,
  getBarbellWeight,
  getBarbellLabel,
  cmToIn,
  inToCm,
  formatMeasurement,
  formatMeasurementValue,
  inputMeasurementToCm,
  formatMeasurementDiff,
  formatHeight,
  heightCmToInches,
  getPlateColor,
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
  // Canonical mapping is the non-linear / discrete one from types/schema.ts,
  // re-exported by lib/utils. RIR 2 -> RPE 7.5 (not 8). The continuous 1:1
  // mapping is preserved separately as rirToRpeLinear / rpeToRirLinear.
  describe('rirToRpe (canonical, non-linear)', () => {
    it('converts RIR to RPE using the discrete training mapping', () => {
      expect(rirToRpe(0)).toBe(10);
      expect(rirToRpe(1)).toBe(9);
      expect(rirToRpe(2)).toBe(7.5);
      expect(rirToRpe(3)).toBe(7); // default 10 - rir
      expect(rirToRpe(4)).toBe(6);
      expect(rirToRpe(5)).toBe(5); // default 10 - rir
    });
  });

  describe('rpeToRir (canonical, bucketed)', () => {
    it('converts RPE to RIR using the discrete training buckets', () => {
      expect(rpeToRir(10)).toBe(0);
      expect(rpeToRir(9)).toBe(1);
      expect(rpeToRir(8)).toBe(2);
      expect(rpeToRir(7.5)).toBe(2);
      expect(rpeToRir(7)).toBe(3);
      expect(rpeToRir(6)).toBe(4);
    });

    it('round-trips every loggable RIR through rirToRpe', () => {
      // A logged RIR must survive RIR -> stored RPE -> displayed RIR; a
      // missing RIR-3 bucket previously showed a logged 3 as 2.
      for (const rir of [0, 1, 2, 3, 4] as const) {
        expect(rpeToRir(rirToRpe(rir))).toBe(rir);
      }
    });
  });

  describe('linear variants', () => {
    it('rirToRpeLinear is a continuous 10 - rir mapping', () => {
      expect(rirToRpeLinear(0)).toBe(10);
      expect(rirToRpeLinear(2)).toBe(8);
      expect(rirToRpeLinear(1.5)).toBe(8.5);
      expect(rirToRpeLinear(0.5)).toBe(9.5);
    });

    it('rpeToRirLinear is the inverse of rirToRpeLinear', () => {
      expect(rpeToRirLinear(8)).toBe(2);
      expect(rpeToRirLinear(8.5)).toBe(1.5);
      for (let rir = 0; rir <= 5; rir++) {
        expect(rpeToRirLinear(rirToRpeLinear(rir))).toBe(rir);
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

describe('Streak Calculation', () => {
  describe('calculateStreaks', () => {
    it('returns zeros for empty array', () => {
      const result = calculateStreaks([]);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
    });

    it('calculates a single workout as streak of 1', () => {
      const today = getLocalDateString();
      const result = calculateStreaks([today]);
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
    });

    it('calculates consecutive days correctly', () => {
      const today = new Date();
      const dates = [
        new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000), // yesterday
        today, // today
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
    });

    it('breaks streak when there is a gap', () => {
      const today = new Date();
      const dates = [
        new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        new Date(today.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
        // 3 day gap
        today, // today
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(2);
    });

    it('handles multiple workouts on the same day', () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const dates = [
        yesterday,
        yesterday, // same day
        today,
        today, // same day
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });

    it('accepts ISO date strings', () => {
      const today = getLocalDateString();
      const yesterday = getLocalDateString(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const dates = [yesterday + 'T10:00:00Z', today + 'T15:30:00Z'];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });

    it('current streak is 0 if last workout was more than 1 day ago', () => {
      const dates = [
        new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        new Date(Date.now() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
        new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(3);
    });

    it('current streak starts from yesterday if no workout today', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const dates = [twoDaysAgo, yesterday];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(2);
    });

    it('handles unsorted dates', () => {
      const today = new Date();
      const dates = [
        today, // out of order
        new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
        new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
    });

    it('identifies longest streak when it is not the most recent', () => {
      const today = new Date();
      const dates = [
        // Old 5-day streak
        new Date(today.getTime() - 20 * 24 * 60 * 60 * 1000),
        new Date(today.getTime() - 19 * 24 * 60 * 60 * 1000),
        new Date(today.getTime() - 18 * 24 * 60 * 60 * 1000),
        new Date(today.getTime() - 17 * 24 * 60 * 60 * 1000),
        new Date(today.getTime() - 16 * 24 * 60 * 60 * 1000),
        // Gap
        // Recent 2-day streak
        new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
        today,
      ];
      const result = calculateStreaks(dates);
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(5);
    });
  });
});

describe('formatDistanceToNow', () => {
  const NOW = new Date('2024-06-15T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns "just now" for < 60 seconds', () => {
    expect(formatDistanceToNow(new Date(NOW - 30 * 1000))).toBe('just now');
    expect(formatDistanceToNow(new Date(NOW - 0))).toBe('just now');
  });

  it('returns minutes ago for < 60 minutes', () => {
    expect(formatDistanceToNow(new Date(NOW - 5 * 60 * 1000))).toBe('5m ago');
    expect(formatDistanceToNow(new Date(NOW - 59 * 60 * 1000))).toBe('59m ago');
  });

  it('returns hours ago for < 24 hours', () => {
    expect(formatDistanceToNow(new Date(NOW - 2 * 60 * 60 * 1000))).toBe('2h ago');
    expect(formatDistanceToNow(new Date(NOW - 23 * 60 * 60 * 1000))).toBe('23h ago');
  });

  it('returns days ago for < 7 days', () => {
    expect(formatDistanceToNow(new Date(NOW - 3 * 24 * 60 * 60 * 1000))).toBe('3d ago');
    expect(formatDistanceToNow(new Date(NOW - 6 * 24 * 60 * 60 * 1000))).toBe('6d ago');
  });

  it('returns weeks ago for < 4 weeks', () => {
    expect(formatDistanceToNow(new Date(NOW - 10 * 24 * 60 * 60 * 1000))).toBe('1w ago');
    expect(formatDistanceToNow(new Date(NOW - 21 * 24 * 60 * 60 * 1000))).toBe('3w ago');
  });

  it('returns months ago for < 12 months', () => {
    expect(formatDistanceToNow(new Date(NOW - 60 * 24 * 60 * 60 * 1000))).toBe('2mo ago');
    expect(formatDistanceToNow(new Date(NOW - 300 * 24 * 60 * 60 * 1000))).toBe('10mo ago');
  });

  it('returns years ago for >= 12 months', () => {
    expect(formatDistanceToNow(new Date(NOW - 400 * 24 * 60 * 60 * 1000))).toBe('1y ago');
    expect(formatDistanceToNow(new Date(NOW - 800 * 24 * 60 * 60 * 1000))).toBe('2y ago');
  });

  it('accepts ISO string input', () => {
    expect(formatDistanceToNow(new Date(NOW - 5 * 60 * 1000).toISOString())).toBe('5m ago');
  });
});

describe('estimateE1RM', () => {
  it('returns 0 for non-positive reps or weight', () => {
    expect(estimateE1RM(100, 0)).toBe(0);
    expect(estimateE1RM(100, -2)).toBe(0);
    expect(estimateE1RM(0, 5)).toBe(0);
    expect(estimateE1RM(-50, 5)).toBe(0);
  });

  it('returns the weight directly for a true single (1 rep, 0 rir)', () => {
    expect(estimateE1RM(100, 1)).toBe(100);
    expect(estimateE1RM(100, 1, 0)).toBe(100);
  });

  it('applies Epley formula for normal rep ranges', () => {
    // 100 * (1 + 5/30) = 116.666... -> 116.67
    expect(estimateE1RM(100, 5)).toBeCloseTo(116.67, 2);
  });

  it('adds rir to effective reps', () => {
    // reps 3 + rir 2 = 5 effective -> same as 5 reps at rir 0
    expect(estimateE1RM(100, 3, 2)).toBeCloseTo(116.67, 2);
  });

  it('clamps a negative rir up to zero', () => {
    // rir clamped to 0, so effective reps = 5
    expect(estimateE1RM(100, 5, -3)).toBeCloseTo(116.67, 2);
  });

  it('clamps very high effective reps to a ceiling of 12', () => {
    // reps 20 -> clamped to 12: 100 * (1 + 12/30) = 140
    expect(estimateE1RM(100, 20)).toBeCloseTo(140, 2);
    // reps 10 + rir 8 = 18 -> clamped to 12 -> 140
    expect(estimateE1RM(100, 10, 8)).toBeCloseTo(140, 2);
  });

  it('treats effectiveReps of 1 from reps+rir as the weight itself', () => {
    // reps 1, rir 0 already covered; ensure path where effectiveReps===1
    expect(estimateE1RM(80, 1)).toBe(80);
  });
});

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('invokes the function only once after the wait period', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 200);
    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes through the latest arguments', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced('a');
    debounced('b');
    jest.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('resets the timer on each call (clearTimeout branch)', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 100);
    debounced();
    jest.advanceTimersByTime(50);
    debounced(); // should clear the pending timeout and restart
    jest.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Barbell helpers', () => {
  const types = ['olympic', 'womens', 'ez_curl', 'trap'] as const;

  it('returns kg barbell weights for each type', () => {
    expect(getBarbellWeight('olympic', 'kg')).toBe(20);
    expect(getBarbellWeight('womens', 'kg')).toBe(15);
    expect(getBarbellWeight('ez_curl', 'kg')).toBe(10);
    expect(getBarbellWeight('trap', 'kg')).toBe(25);
  });

  it('returns lb barbell weights for each type', () => {
    expect(getBarbellWeight('olympic', 'lb')).toBe(45);
    expect(getBarbellWeight('womens', 'lb')).toBe(35);
    expect(getBarbellWeight('ez_curl', 'lb')).toBe(25);
    expect(getBarbellWeight('trap', 'lb')).toBe(55);
  });

  it('returns kg labels for each type', () => {
    expect(getBarbellLabel('olympic', 'kg')).toBe('Olympic Barbell (20kg)');
    expect(getBarbellLabel('womens', 'kg')).toBe("Women's Olympic (15kg)");
    expect(getBarbellLabel('ez_curl', 'kg')).toBe('EZ Curl Bar (10kg)');
    expect(getBarbellLabel('trap', 'kg')).toBe('Trap Bar (25kg)');
  });

  it('returns lb labels for each type', () => {
    expect(getBarbellLabel('olympic', 'lb')).toBe('Olympic Barbell (45lb)');
    expect(getBarbellLabel('womens', 'lb')).toBe("Women's Olympic (35lb)");
    expect(getBarbellLabel('ez_curl', 'lb')).toBe('EZ Curl Bar (25lb)');
    expect(getBarbellLabel('trap', 'lb')).toBe('Trap Bar (55lb)');
  });

  it('every type resolves to a positive weight and non-empty label in both units', () => {
    for (const t of types) {
      expect(getBarbellWeight(t, 'kg')).toBeGreaterThan(0);
      expect(getBarbellWeight(t, 'lb')).toBeGreaterThan(0);
      expect(getBarbellLabel(t, 'kg').length).toBeGreaterThan(0);
      expect(getBarbellLabel(t, 'lb').length).toBeGreaterThan(0);
    }
  });
});

describe('Measurement conversions', () => {
  it('cmToIn converts correctly', () => {
    expect(cmToIn(2.54)).toBeCloseTo(1, 5);
    expect(cmToIn(0)).toBe(0);
    expect(cmToIn(25.4)).toBeCloseTo(10, 5);
  });

  it('inToCm converts correctly', () => {
    expect(inToCm(1)).toBeCloseTo(2.54, 5);
    expect(inToCm(0)).toBe(0);
    expect(inToCm(10)).toBeCloseTo(25.4, 5);
  });

  describe('formatMeasurement', () => {
    it('formats in inches', () => {
      expect(formatMeasurement(25.4, 'in')).toBe('10.0 in');
    });
    it('formats in cm', () => {
      expect(formatMeasurement(40, 'cm')).toBe('40.0 cm');
    });
    it('honors custom decimals', () => {
      expect(formatMeasurement(40, 'cm', 2)).toBe('40.00 cm');
      expect(formatMeasurement(25.4, 'in', 0)).toBe('10 in');
    });
  });

  describe('formatMeasurementValue', () => {
    it('returns numeric inches when unit is in', () => {
      expect(formatMeasurementValue(25.4, 'in')).toBe(10);
      expect(typeof formatMeasurementValue(25.4, 'in')).toBe('number');
    });
    it('returns numeric cm when unit is cm', () => {
      expect(formatMeasurementValue(40, 'cm')).toBe(40);
    });
    it('honors custom decimals', () => {
      expect(formatMeasurementValue(40.123, 'cm', 2)).toBe(40.12);
    });
  });

  describe('inputMeasurementToCm', () => {
    it('converts inches to cm', () => {
      expect(inputMeasurementToCm(10, 'in')).toBeCloseTo(25.4, 5);
    });
    it('returns cm unchanged', () => {
      expect(inputMeasurementToCm(40, 'cm')).toBe(40);
    });
  });

  describe('formatMeasurementDiff', () => {
    it('shows a plus sign for positive differences (in)', () => {
      expect(formatMeasurementDiff(2.54, 'in')).toBe('+1.0 in');
    });
    it('shows a plus sign for positive differences (cm)', () => {
      expect(formatMeasurementDiff(1.2, 'cm')).toBe('+1.2 cm');
    });
    it('shows no extra sign for negative differences', () => {
      expect(formatMeasurementDiff(-1.2, 'cm')).toBe('-1.2 cm');
      expect(formatMeasurementDiff(-2.54, 'in')).toBe('-1.0 in');
    });
    it('treats zero as positive (>= 0 branch)', () => {
      expect(formatMeasurementDiff(0, 'cm')).toBe('+0.0 cm');
      expect(formatMeasurementDiff(0, 'in')).toBe('+0.0 in');
    });
  });

  describe('formatHeight', () => {
    it('formats cm with rounding', () => {
      expect(formatHeight(188.4, 'cm')).toBe('188 cm');
      expect(formatHeight(188.6, 'cm')).toBe('189 cm');
    });
    it('formats inches as feet and inches', () => {
      // 188 cm ~= 74.0 in -> 6'2"
      expect(formatHeight(188, 'in')).toBe('6\'2"');
    });
    it('handles exact foot boundaries', () => {
      // 182.88 cm = 72 in -> 6'0"
      expect(formatHeight(182.88, 'in')).toBe('6\'0"');
    });
  });

  describe('heightCmToInches', () => {
    it('converts cm to inches', () => {
      expect(heightCmToInches(25.4)).toBeCloseTo(10, 5);
    });
  });
});

describe('getPlateColor', () => {
  it('returns red for >= 24kg equivalent', () => {
    expect(getPlateColor(25, 'kg')).toBe('#E53935');
  });
  it('returns blue for >= 19kg', () => {
    expect(getPlateColor(20, 'kg')).toBe('#1E88E5');
  });
  it('returns yellow for >= 14kg', () => {
    expect(getPlateColor(15, 'kg')).toBe('#FDD835');
  });
  it('returns green for >= 9kg', () => {
    expect(getPlateColor(10, 'kg')).toBe('#43A047');
  });
  it('returns white for >= 4kg', () => {
    expect(getPlateColor(5, 'kg')).toBe('#FFFFFF');
  });
  it('returns red for >= 2kg', () => {
    expect(getPlateColor(2.5, 'kg')).toBe('#E53935');
  });
  it('returns gray for smaller plates', () => {
    expect(getPlateColor(1.25, 'kg')).toBe('#9E9E9E');
  });
  it('converts lb to kg equivalent before matching', () => {
    // 45lb ~= 20.4kg -> blue
    expect(getPlateColor(45, 'lb')).toBe('#1E88E5');
    // 55lb ~= 24.9kg -> red
    expect(getPlateColor(55, 'lb')).toBe('#E53935');
    // 5lb ~= 2.27kg -> red (>= 2 bucket)
    expect(getPlateColor(5, 'lb')).toBe('#E53935');
    // 2.5lb ~= 1.13kg -> gray
    expect(getPlateColor(2.5, 'lb')).toBe('#9E9E9E');
  });
});
