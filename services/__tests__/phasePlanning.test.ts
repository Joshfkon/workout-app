/**
 * Phase planning tests: span validation + boundary-shift proposals, the
 * first-run auto-suggest segmentation, and phase card stats.
 */

import {
  activePhase,
  canSuggestPhases,
  computePhaseStats,
  goalSyncAfterEdit,
  phaseOnDay,
  phaseTypeToProfileGoal,
  planPhaseSwitch,
  sortPhases,
  suggestPhasesFromHistory,
  validatePhaseSpan,
} from '@/services/phasePlanning';
import type { TrainingPhase } from '@/types/schema';
import type { WeighIn } from '@/lib/nutrition/interval-tdee';
import { addLocalDays, localDay } from '@/lib/date/localDay';

function mkPhase(overrides: Partial<TrainingPhase> & Pick<TrainingPhase, 'id' | 'startDay'>): TrainingPhase {
  return {
    userId: 'user-1',
    phaseType: 'bulk',
    endDay: null,
    targetRateLbsPerWeek: null,
    note: null,
    ...overrides,
  };
}

describe('phaseOnDay / activePhase', () => {
  const phases = [
    mkPhase({ id: 'cut', phaseType: 'cut', startDay: '2026-01-01', endDay: '2026-03-01' }),
    // Gap: Mar 2 - Mar 14 untracked.
    mkPhase({ id: 'bulk', phaseType: 'bulk', startDay: '2026-03-15', endDay: null }),
  ];

  it('resolves the covering phase, honoring gaps', () => {
    expect(phaseOnDay(phases, '2026-02-10')?.id).toBe('cut');
    expect(phaseOnDay(phases, '2026-03-05')).toBeNull(); // gap
    expect(phaseOnDay(phases, '2026-07-01')?.id).toBe('bulk'); // open-ended
  });

  it('activePhase is the phase covering today', () => {
    expect(activePhase(phases, '2026-07-18')?.id).toBe('bulk');
    expect(activePhase([phases[0]], '2026-07-18')).toBeNull(); // ended phases only
  });

  it('sortPhases orders by startDay ascending', () => {
    expect(sortPhases([phases[1], phases[0]]).map((p) => p.id)).toEqual(['cut', 'bulk']);
  });
});

describe('validatePhaseSpan', () => {
  const existing = [
    mkPhase({ id: 'a', phaseType: 'cut', startDay: '2026-01-01', endDay: '2026-02-28' }),
    mkPhase({ id: 'b', phaseType: 'bulk', startDay: '2026-03-01', endDay: null }),
  ];

  it('accepts a span that fits in a gap', () => {
    const result = validatePhaseSpan(
      [existing[0]],
      { phaseType: 'maintenance', startDay: '2026-03-10', endDay: '2026-04-01' }
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects end before start', () => {
    const result = validatePhaseSpan(existing, {
      phaseType: 'cut',
      startDay: '2026-06-10',
      endDay: '2026-06-01',
    });
    expect(result.errors).toContain('end_before_start');
  });

  it('rejects a second open-ended phase', () => {
    const result = validatePhaseSpan(existing, {
      phaseType: 'cut',
      startDay: '2026-08-01',
      endDay: null,
    });
    expect(result.errors).toContain('multiple_active');
  });

  it('editing the active phase itself may stay open-ended', () => {
    const result = validatePhaseSpan(existing, {
      id: 'b',
      phaseType: 'bulk',
      startDay: '2026-03-05',
      endDay: null,
    });
    expect(result.ok).toBe(true);
  });

  it('flags overlap and proposes shifting the earlier neighbor end (contiguous case)', () => {
    // New cut starting inside the open-ended bulk: propose ending the bulk
    // the day before.
    const result = validatePhaseSpan(existing, {
      phaseType: 'cut',
      startDay: '2026-07-01',
      endDay: null,
    });
    expect(result.errors).toContain('overlap');
    expect(result.errors).toContain('multiple_active');
    expect(result.overlappingIds).toEqual(['b']);
    expect(result.proposals).toEqual([{ phaseId: 'b', field: 'endDay', value: '2026-06-30' }]);
  });

  it('proposes shifting the later neighbor start when extending an earlier phase', () => {
    // Extending the cut into March: propose bulk starting the day after.
    const result = validatePhaseSpan(existing, {
      id: 'a',
      phaseType: 'cut',
      startDay: '2026-01-01',
      endDay: '2026-03-10',
    });
    expect(result.errors).toContain('overlap');
    expect(result.proposals).toEqual([{ phaseId: 'b', field: 'startDay', value: '2026-03-11' }]);
  });

  it('offers no proposal when the candidate swallows a neighbor whole', () => {
    const result = validatePhaseSpan(existing, {
      phaseType: 'maintenance',
      startDay: '2025-12-01',
      endDay: '2026-03-15',
    });
    expect(result.errors).toContain('overlap');
    expect(result.proposals).toEqual([]);
  });
});

describe('suggestPhasesFromHistory', () => {
  /** Daily series: `segments` of [days, ratePerWk] starting at `startDay`. */
  function series(startDay: string, startLb: number, segments: [number, number][]): WeighIn[] {
    const out: WeighIn[] = [];
    let dayCursor = startDay;
    let weight = startLb;
    for (const [days, rate] of segments) {
      for (let i = 0; i < days; i++) {
        out.push({ date: dayCursor, weightLb: weight });
        dayCursor = addLocalDays(dayCursor, 1);
        weight += rate / 7;
      }
    }
    return out;
  }

  it('detects a cut -> bulk inflection near the true boundary', () => {
    // 70 days cutting at -1.2 lb/wk, then 70 days bulking at +0.8 lb/wk.
    const weighIns = series('2026-01-01', 200, [
      [70, -1.2],
      [70, 0.8],
    ]);
    const suggested = suggestPhasesFromHistory(weighIns);

    expect(suggested.length).toBeGreaterThanOrEqual(2);
    expect(suggested[0].phaseType).toBe('cut');
    expect(suggested[suggested.length - 1].phaseType).toBe('bulk');
    // Contiguous and ordered.
    for (let i = 1; i < suggested.length; i++) {
      expect(suggested[i].startDay > suggested[i - 1].endDay).toBe(true);
    }
    // The cut/bulk boundary lands near the actual inflection (2026-03-12),
    // allowing for the smoothing + trailing-slope lag.
    const cutEnd = suggested[0].endDay;
    expect(cutEnd >= '2026-03-01' && cutEnd <= '2026-04-01').toBe(true);
  });

  it('snaps a boundary to a DEXA scan within 14 days', () => {
    const weighIns = series('2026-01-01', 200, [
      [70, -1.2],
      [70, 0.8],
    ]);
    const bare = suggestPhasesFromHistory(weighIns);
    const boundary = bare[0].endDay;
    const scanDay = addLocalDays(boundary, 5);
    const snapped = suggestPhasesFromHistory(weighIns, [scanDay]);
    expect(snapped[0].endDay).toBe(scanDay);
    expect(snapped[1].startDay).toBe(addLocalDays(scanDay, 1));
  });

  it('classifies a flat stretch as maintenance and ignores sub-21-day wiggles', () => {
    // Flat, with a 10-day blip upward in the middle — too short to be a bulk.
    const weighIns = series('2026-01-01', 185, [
      [50, 0],
      [10, 1.5],
      [50, 0],
    ]);
    const suggested = suggestPhasesFromHistory(weighIns);
    expect(suggested.every((s) => s.phaseType === 'maintenance')).toBe(true);
  });

  it('returns nothing useful for tiny histories', () => {
    expect(suggestPhasesFromHistory([{ date: '2026-01-01', weightLb: 180 }])).toEqual([]);
  });
});

describe('canSuggestPhases', () => {
  const longHistory: WeighIn[] = [
    { date: '2026-01-01', weightLb: 180 },
    { date: '2026-05-01', weightLb: 185 },
  ];

  it('requires zero existing phases and >= 90 days of data', () => {
    expect(canSuggestPhases(0, longHistory)).toBe(true);
    expect(canSuggestPhases(1, longHistory)).toBe(false);
    expect(
      canSuggestPhases(0, [
        { date: '2026-01-01', weightLb: 180 },
        { date: '2026-02-01', weightLb: 181 },
      ])
    ).toBe(false);
    expect(canSuggestPhases(0, [])).toBe(false);
  });
});

describe('planPhaseSwitch (quick-switcher → spans sync)', () => {
  // An 11 PM LOCAL instant: in the suite's negative-offset timezone the UTC
  // date is already tomorrow, so any UTC-based day math closes/opens the
  // spans on the wrong day.
  const now = new Date(2026, 6, 17, 23, 0);
  const today = localDay(now); // '2026-07-17'
  const activeBulk = mkPhase({
    id: 'active',
    phaseType: 'bulk',
    startDay: '2026-05-01',
    endDay: null,
    targetRateLbsPerWeek: 0.5,
  });

  it('closes the active span at LOCAL yesterday and opens the new type at LOCAL today', () => {
    const plan = planPhaseSwitch([activeBulk], 'cut', now);
    expect(plan.noop).toBe(false);
    expect(plan.close).toEqual({ id: 'active', endDay: '2026-07-16' });
    expect(plan.open).toEqual({
      phaseType: 'cut',
      startDay: '2026-07-17',
      endDay: null,
      targetRateLbsPerWeek: -0.75,
    });
    // The naive-UTC answer would have been the 18th/17th:
    if (now.getTimezoneOffset() > 0) {
      expect(now.toISOString().slice(0, 10)).toBe('2026-07-18');
      expect(plan.open!.startDay).not.toBe(now.toISOString().slice(0, 10));
    }
  });

  it('same-type flip is a no-op — the span never fragments', () => {
    const plan = planPhaseSwitch([activeBulk], 'bulk', now);
    expect(plan).toEqual({ noop: true });
  });

  it('with no active span it just opens one (gap case, ended span, or empty table)', () => {
    const ended = mkPhase({ id: 'old', phaseType: 'cut', startDay: '2026-01-01', endDay: '2026-03-01' });
    for (const phases of [[], [ended]]) {
      const plan = planPhaseSwitch(phases, 'maintenance', now);
      expect(plan.close).toBeUndefined();
      expect(plan.open).toEqual({
        phaseType: 'maintenance',
        startDay: today,
        endDay: null,
        targetRateLbsPerWeek: null,
      });
    }
  });

  it('a second flip on the same day retypes the span instead of inverting it', () => {
    const openedToday = mkPhase({ id: 'today', phaseType: 'cut', startDay: today, endDay: null });
    const plan = planPhaseSwitch([openedToday], 'bulk', now);
    expect(plan.close).toBeUndefined();
    expect(plan.open).toBeUndefined();
    expect(plan.retype).toEqual({ id: 'today', phaseType: 'bulk', targetRateLbsPerWeek: 0.5 });
  });
});

describe('goalSyncAfterEdit (editor → users.goal mirror)', () => {
  const today = '2026-07-17';
  const past = mkPhase({ id: 'past', phaseType: 'cut', startDay: '2026-01-01', endDay: '2026-03-01' });
  const active = mkPhase({ id: 'active', phaseType: 'bulk', startDay: '2026-05-01', endDay: null });

  it('a retroactive edit (past span) writes nothing — users.goal/phase_history stay untouched', () => {
    const edited = { ...past, phaseType: 'maintenance' as const };
    expect(goalSyncAfterEdit([past, active], [edited, active], today)).toBeNull();
  });

  it('changing the ACTIVE span type mirrors into users.goal', () => {
    const edited = { ...active, phaseType: 'cut' as const };
    expect(goalSyncAfterEdit([past, active], [past, edited], today)).toBe('cut');
  });

  it('adding a span that covers today mirrors into users.goal', () => {
    expect(goalSyncAfterEdit([past], [past, active], today)).toBe('bulk');
  });

  it('ending or deleting the active span leaves users.goal as the standing fallback', () => {
    const ended = { ...active, endDay: '2026-07-10' };
    expect(goalSyncAfterEdit([past, active], [past, ended], today)).toBeNull();
    expect(goalSyncAfterEdit([past, active], [past], today)).toBeNull();
  });

  it('an active recomp span mirrors as maintenance (users.goal enum has no recomp)', () => {
    const recomp = mkPhase({ id: 'r', phaseType: 'recomp', startDay: '2026-06-01', endDay: null });
    expect(goalSyncAfterEdit([], [recomp], today)).toBe('maintenance');
    expect(phaseTypeToProfileGoal('recomp')).toBe('maintenance');
  });

  it('extending the active span end date (still active) writes nothing', () => {
    const extended = { ...active, endDay: '2026-12-31' };
    expect(goalSyncAfterEdit([active], [extended], today)).toBeNull();
  });
});

describe('computePhaseStats', () => {
  it('computes duration, endpoints, rate, and bracketing DEXA deltas', () => {
    const weighIns: WeighIn[] = [];
    for (let i = 0; i <= 28; i++) {
      weighIns.push({ date: addLocalDays('2026-06-01', i), weightLb: 180 + i * 0.1 });
    }
    const stats = computePhaseStats(
      { startDay: '2026-06-01', endDay: '2026-06-29' },
      weighIns,
      [
        { scanDate: '2026-06-02', leanMassKg: 70, fatMassKg: 20 },
        { scanDate: '2026-06-28', leanMassKg: 70.5, fatMassKg: 20.4 },
      ],
      '2026-07-18'
    );
    expect(stats.durationDays).toBe(29);
    expect(stats.startWeightLb).toBeCloseTo(180, 5);
    expect(stats.endWeightLb).toBeCloseTo(182.8, 5);
    expect(stats.deltaLb).toBeCloseTo(2.8, 5);
    expect(stats.avgRateLbPerWk).toBeCloseTo(0.7, 5);
    expect(stats.leanDeltaLb).toBeCloseTo(0.5 * 2.20462, 3);
    expect(stats.fatDeltaLb).toBeCloseTo(0.4 * 2.20462, 3);
  });

  it('an open-ended phase measures through today and skips DEXA deltas without 2 scans', () => {
    const stats = computePhaseStats(
      { startDay: '2026-07-01', endDay: null },
      [
        { date: '2026-07-02', weightLb: 190 },
        { date: '2026-07-16', weightLb: 191 },
      ],
      [{ scanDate: '2026-07-03', leanMassKg: 70, fatMassKg: 20 }],
      '2026-07-18'
    );
    expect(stats.durationDays).toBe(18);
    expect(stats.deltaLb).toBeCloseTo(1, 5);
    expect(stats.avgRateLbPerWk).toBeCloseTo(0.5, 5);
    expect(stats.leanDeltaLb).toBeUndefined();
  });
});
