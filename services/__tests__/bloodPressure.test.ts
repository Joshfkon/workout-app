/**
 * Tests for services/bloodPressure.ts
 * Category classification, input validation, daily averaging, grouping,
 * period filtering and summary stats.
 */
import {
  classifyBloodPressure,
  isCrisisReading,
  validateBloodPressure,
  averageReadings,
  groupByDay,
  filterByPeriod,
  summarizeReadings,
  formatReading,
  BP_LIMITS,
} from '../bloodPressure';
import type { BloodPressureEntry } from '@/types/schema';

// ============================================
// TEST FIXTURES
// ============================================
const makeEntry = (
  overrides: Partial<BloodPressureEntry> & {
    systolic: number;
    diastolic: number;
    localDay: string;
  }
): BloodPressureEntry => ({
  id: overrides.id ?? `${overrides.localDay}-${overrides.systolic}`,
  measuredAt: overrides.measuredAt ?? `${overrides.localDay}T08:00:00.000Z`,
  localDay: overrides.localDay,
  systolic: overrides.systolic,
  diastolic: overrides.diastolic,
  pulse: overrides.pulse ?? null,
  context: overrides.context ?? null,
  notes: overrides.notes ?? null,
  source: 'manual',
});

// ============================================
// classifyBloodPressure
// ============================================
describe('classifyBloodPressure', () => {
  it('classifies a textbook normal reading', () => {
    expect(classifyBloodPressure(115, 75).id).toBe('normal');
    expect(classifyBloodPressure(108, 70).id).toBe('normal');
  });

  it('classifies elevated (systolic 120-129 and diastolic < 80)', () => {
    expect(classifyBloodPressure(125, 78).id).toBe('elevated');
    expect(classifyBloodPressure(120, 79).id).toBe('elevated');
  });

  it('does NOT treat 120-129 systolic with diastolic >= 80 as elevated', () => {
    // Diastolic 80 pushes this to high stage 1, not elevated.
    expect(classifyBloodPressure(125, 82).id).toBe('high_stage_1');
  });

  it('classifies high stage 1 by systolic OR diastolic', () => {
    expect(classifyBloodPressure(135, 78).id).toBe('high_stage_1');
    expect(classifyBloodPressure(118, 85).id).toBe('high_stage_1');
  });

  it('classifies high stage 2 by systolic OR diastolic', () => {
    expect(classifyBloodPressure(145, 85).id).toBe('high_stage_2');
    expect(classifyBloodPressure(120, 95).id).toBe('high_stage_2');
  });

  it('classifies crisis by systolic OR diastolic', () => {
    expect(classifyBloodPressure(185, 100).id).toBe('crisis');
    expect(classifyBloodPressure(160, 125).id).toBe('crisis');
  });

  it('grades by the worse of the two numbers', () => {
    // Systolic normal but diastolic in stage 2 -> stage 2.
    expect(classifyBloodPressure(118, 92).id).toBe('high_stage_2');
  });

  it('exposes neutral, non-diagnostic labels', () => {
    expect(classifyBloodPressure(115, 75).label).toBe('Normal range');
    expect(classifyBloodPressure(185, 100).label).toMatch(/recheck/i);
  });

  it('picks severity ordering consistently', () => {
    expect(classifyBloodPressure(115, 75).severity).toBeLessThan(
      classifyBloodPressure(135, 85).severity
    );
    expect(classifyBloodPressure(145, 95).severity).toBeLessThan(
      classifyBloodPressure(185, 125).severity
    );
  });

  it('handles exact boundary values', () => {
    expect(classifyBloodPressure(119, 79).id).toBe('normal');
    expect(classifyBloodPressure(120, 79).id).toBe('elevated');
    expect(classifyBloodPressure(130, 79).id).toBe('high_stage_1');
    expect(classifyBloodPressure(140, 79).id).toBe('high_stage_2');
    expect(classifyBloodPressure(180, 79).id).toBe('crisis');
    expect(classifyBloodPressure(119, 80).id).toBe('high_stage_1');
    expect(classifyBloodPressure(119, 90).id).toBe('high_stage_2');
    expect(classifyBloodPressure(119, 120).id).toBe('crisis');
  });
});

describe('isCrisisReading', () => {
  it('flags crisis-level readings only', () => {
    expect(isCrisisReading(185, 100)).toBe(true);
    expect(isCrisisReading(150, 122)).toBe(true);
    expect(isCrisisReading(150, 95)).toBe(false);
    expect(isCrisisReading(115, 75)).toBe(false);
  });
});

// ============================================
// validateBloodPressure
// ============================================
describe('validateBloodPressure', () => {
  it('accepts a valid reading', () => {
    const r = validateBloodPressure({ systolic: 120, diastolic: 80 });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual({});
  });

  it('requires systolic and diastolic', () => {
    const r = validateBloodPressure({ systolic: null, diastolic: undefined });
    expect(r.valid).toBe(false);
    expect(r.errors.systolic).toBeDefined();
    expect(r.errors.diastolic).toBeDefined();
  });

  it('rejects out-of-range systolic with a friendly message', () => {
    const low = validateBloodPressure({ systolic: 40, diastolic: 60 });
    expect(low.valid).toBe(false);
    expect(low.errors.systolic).toContain(String(BP_LIMITS.systolic.min));

    const high = validateBloodPressure({ systolic: 300, diastolic: 80 });
    expect(high.errors.systolic).toContain(String(BP_LIMITS.systolic.max));
  });

  it('rejects out-of-range diastolic', () => {
    expect(validateBloodPressure({ systolic: 120, diastolic: 20 }).valid).toBe(
      false
    );
    expect(validateBloodPressure({ systolic: 120, diastolic: 200 }).valid).toBe(
      false
    );
  });

  it('requires systolic greater than diastolic', () => {
    const r = validateBloodPressure({ systolic: 80, diastolic: 120 });
    expect(r.valid).toBe(false);
    expect(r.errors.systolic).toMatch(/higher than/i);
  });

  it('rejects equal systolic and diastolic', () => {
    expect(validateBloodPressure({ systolic: 100, diastolic: 100 }).valid).toBe(
      false
    );
  });

  it('treats pulse as optional', () => {
    expect(
      validateBloodPressure({ systolic: 120, diastolic: 80 }).valid
    ).toBe(true);
    expect(
      validateBloodPressure({ systolic: 120, diastolic: 80, pulse: null }).valid
    ).toBe(true);
  });

  it('validates pulse range when provided', () => {
    expect(
      validateBloodPressure({ systolic: 120, diastolic: 80, pulse: 65 }).valid
    ).toBe(true);
    expect(
      validateBloodPressure({ systolic: 120, diastolic: 80, pulse: 10 }).errors
        .pulse
    ).toBeDefined();
    expect(
      validateBloodPressure({ systolic: 120, diastolic: 80, pulse: 300 }).errors
        .pulse
    ).toBeDefined();
  });

  it('rejects non-integer inputs', () => {
    expect(
      validateBloodPressure({ systolic: 120.5, diastolic: 80 }).errors.systolic
    ).toBeDefined();
  });
});

// ============================================
// averageReadings
// ============================================
describe('averageReadings', () => {
  it('returns null for an empty set', () => {
    expect(averageReadings([])).toBeNull();
  });

  it('averages systolic and diastolic (rounded)', () => {
    const avg = averageReadings([
      { systolic: 120, diastolic: 80, pulse: null },
      { systolic: 130, diastolic: 84, pulse: null },
    ]);
    expect(avg).toEqual({ systolic: 125, diastolic: 82, pulse: null, count: 2 });
  });

  it('rounds averages to the nearest integer', () => {
    const avg = averageReadings([
      { systolic: 121, diastolic: 81, pulse: null },
      { systolic: 122, diastolic: 82, pulse: null },
      { systolic: 122, diastolic: 82, pulse: null },
    ]);
    // (121+122+122)/3 = 121.67 -> 122
    expect(avg!.systolic).toBe(122);
  });

  it('averages pulse only over readings that recorded one', () => {
    const avg = averageReadings([
      { systolic: 120, diastolic: 80, pulse: 60 },
      { systolic: 120, diastolic: 80, pulse: 70 },
      { systolic: 120, diastolic: 80, pulse: null },
    ]);
    expect(avg!.pulse).toBe(65);
  });

  it('returns null pulse when no reading recorded one', () => {
    const avg = averageReadings([
      { systolic: 120, diastolic: 80, pulse: null },
      { systolic: 122, diastolic: 82, pulse: null },
    ]);
    expect(avg!.pulse).toBeNull();
  });
});

// ============================================
// groupByDay
// ============================================
describe('groupByDay', () => {
  it('groups readings by local day, newest day first', () => {
    const grouped = groupByDay([
      makeEntry({ systolic: 120, diastolic: 80, localDay: '2026-07-10' }),
      makeEntry({ systolic: 130, diastolic: 84, localDay: '2026-07-12' }),
      makeEntry({ systolic: 118, diastolic: 78, localDay: '2026-07-11' }),
    ]);
    expect(grouped.map((d) => d.localDay)).toEqual([
      '2026-07-12',
      '2026-07-11',
      '2026-07-10',
    ]);
  });

  it('computes a daily average for multi-reading days', () => {
    const grouped = groupByDay([
      makeEntry({
        systolic: 120,
        diastolic: 80,
        localDay: '2026-07-12',
        measuredAt: '2026-07-12T07:00:00.000Z',
      }),
      makeEntry({
        systolic: 140,
        diastolic: 90,
        localDay: '2026-07-12',
        measuredAt: '2026-07-12T19:00:00.000Z',
      }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].readings).toHaveLength(2);
    expect(grouped[0].average.systolic).toBe(130);
    expect(grouped[0].average.diastolic).toBe(85);
  });

  it('orders readings within a day newest-first', () => {
    const grouped = groupByDay([
      makeEntry({
        systolic: 120,
        diastolic: 80,
        localDay: '2026-07-12',
        measuredAt: '2026-07-12T07:00:00.000Z',
        id: 'morning',
      }),
      makeEntry({
        systolic: 140,
        diastolic: 90,
        localDay: '2026-07-12',
        measuredAt: '2026-07-12T19:00:00.000Z',
        id: 'evening',
      }),
    ]);
    expect(grouped[0].readings[0].id).toBe('evening');
  });
});

// ============================================
// filterByPeriod
// ============================================
describe('filterByPeriod', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');
  const readings = [
    makeEntry({ systolic: 120, diastolic: 80, localDay: '2026-07-15' }),
    makeEntry({ systolic: 121, diastolic: 81, localDay: '2026-07-09' }), // 7d edge
    makeEntry({ systolic: 122, diastolic: 82, localDay: '2026-06-20' }), // within 30d
    makeEntry({ systolic: 123, diastolic: 83, localDay: '2026-01-01' }), // old
  ];

  it('returns everything for "all"', () => {
    expect(filterByPeriod(readings, 'all', now)).toHaveLength(4);
  });

  it('filters to the trailing 7 days (inclusive edge)', () => {
    const days = filterByPeriod(readings, '7d', now).map((r) => r.localDay);
    expect(days).toContain('2026-07-15');
    expect(days).toContain('2026-07-09');
    expect(days).not.toContain('2026-06-20');
  });

  it('filters to the trailing 30 days', () => {
    const days = filterByPeriod(readings, '30d', now).map((r) => r.localDay);
    expect(days).toContain('2026-06-20');
    expect(days).not.toContain('2026-01-01');
  });
});

// ============================================
// summarizeReadings
// ============================================
describe('summarizeReadings', () => {
  it('returns null with no readings', () => {
    expect(summarizeReadings([])).toBeNull();
  });

  it('computes averages, min/max, count and category', () => {
    const summary = summarizeReadings([
      makeEntry({ systolic: 120, diastolic: 80, localDay: '2026-07-10', pulse: 60 }),
      makeEntry({ systolic: 130, diastolic: 84, localDay: '2026-07-11', pulse: 70 }),
      makeEntry({ systolic: 110, diastolic: 72, localDay: '2026-07-12' }),
    ]);
    expect(summary!.count).toBe(3);
    expect(summary!.avgSystolic).toBe(120); // (120+130+110)/3
    expect(summary!.avgDiastolic).toBe(79); // (80+84+72)/3 = 78.67 -> 79
    expect(summary!.minSystolic).toBe(110);
    expect(summary!.maxSystolic).toBe(130);
    expect(summary!.minDiastolic).toBe(72);
    expect(summary!.maxDiastolic).toBe(84);
    expect(summary!.avgPulse).toBe(65);
    // 120/79 -> systolic 120-129 with diastolic < 80 == elevated.
    expect(summary!.category.id).toBe('elevated');
  });
});

// ============================================
// formatReading
// ============================================
describe('formatReading', () => {
  it('formats as systolic/diastolic', () => {
    expect(formatReading(120, 80)).toBe('120/80');
  });
});
