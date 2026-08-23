/**
 * Tests for services/exerciseDetailAnalytics.ts
 *
 * Pure derivations behind the tabbed exercise detail sheet:
 * session summaries (History), records incl. the rep-records table
 * (Records), e1RM trend + weekly volume (Charts), and tab behavior.
 */

import {
  summarizeSession,
  summarizeSessions,
  resolveDefaultTab,
  shouldCollapseGuides,
  computeExerciseRecords,
  buildE1RMTrend,
  buildWeeklyVolume,
  buildSessionSparkline,
  effortColorClass,
  setRir,
  setE1RM,
  type ExerciseDetailSessionInput,
} from '../exerciseDetailAnalytics';
import { estimateE1RM } from '@/lib/utils';

function makeSession(
  overrides: Partial<ExerciseDetailSessionInput> & { date: string }
): ExerciseDetailSessionInput {
  return {
    sessionId: overrides.sessionId ?? `session-${overrides.date}`,
    date: overrides.date,
    isDeload: overrides.isDeload ?? false,
    locationName: overrides.locationName,
    sets: overrides.sets ?? [],
  };
}

// === Session summaries ===

describe('summarizeSession', () => {
  it('derives volume, best e1RM, and the top set', () => {
    const session = summarizeSession(
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [
          { weightKg: 100, reps: 8, rpe: 8 },
          { weightKg: 100, reps: 6, rpe: 9 },
        ],
      })
    );

    expect(session.totalVolume).toBe(100 * 8 + 100 * 6);
    // 100×8 @RPE8 (RIR 2) beats 100×6 @RPE9 (RIR 1)
    expect(session.topSet).toEqual({ weightKg: 100, reps: 8, rpe: 8 });
    expect(session.bestE1RM).toBe(estimateE1RM(100, 8, 2));
  });

  it('handles an empty session', () => {
    const session = summarizeSession(makeSession({ date: '2026-06-01T10:00:00Z' }));
    expect(session.totalVolume).toBe(0);
    expect(session.bestE1RM).toBe(0);
    expect(session.topSet).toBeNull();
    expect(session.locationName).toBeNull();
  });
});

describe('summarizeSessions', () => {
  it('sorts reverse-chronologically (newest first)', () => {
    const sessions = summarizeSessions([
      makeSession({ date: '2026-05-01T10:00:00Z' }),
      makeSession({ date: '2026-06-01T10:00:00Z' }),
      makeSession({ date: '2026-04-01T10:00:00Z' }),
    ]);
    expect(sessions.map((s) => s.date)).toEqual([
      '2026-06-01T10:00:00Z',
      '2026-05-01T10:00:00Z',
      '2026-04-01T10:00:00Z',
    ]);
  });
});

// === Tab behavior ===

describe('resolveDefaultTab', () => {
  it('opens About for a brand-new exercise', () => {
    expect(resolveDefaultTab(0)).toBe('about');
  });

  it('opens History once the exercise has at least one logged session', () => {
    expect(resolveDefaultTab(1)).toBe('history');
    expect(resolveDefaultTab(25)).toBe('history');
  });
});

describe('shouldCollapseGuides', () => {
  it('keeps guides expanded below 5 sessions and collapses at >= 5', () => {
    expect(shouldCollapseGuides(0)).toBe(false);
    expect(shouldCollapseGuides(4)).toBe(false);
    expect(shouldCollapseGuides(5)).toBe(true);
    expect(shouldCollapseGuides(12)).toBe(true);
  });
});

// === Records ===

describe('computeExerciseRecords', () => {
  it('rep records: heaviest weight ever logged at >= that many reps', () => {
    // Spec fixture: sets (100×10, 110×8, 120×3)
    const records = computeExerciseRecords(
      summarizeSessions([
        makeSession({
          date: '2026-06-01T10:00:00Z',
          sets: [
            { weightKg: 100, reps: 10, rpe: 8 },
            { weightKg: 110, reps: 8, rpe: 9 },
            { weightKg: 120, reps: 3, rpe: 9 },
          ],
        }),
      ])
    );

    const byReps = new Map(records.repRecords.map((r) => [r.reps, r.weightKg]));
    expect(byReps.get(3)).toBe(120);
    expect(byReps.get(5)).toBe(110); // heaviest at >= 5 reps
    expect(byReps.get(8)).toBe(110);
    expect(byReps.get(10)).toBe(100);
    expect(byReps.get(1)).toBe(120);
    expect(byReps.has(11)).toBe(false); // nothing logged at >= 11 reps
    expect(byReps.has(12)).toBe(false);
  });

  it('caps rep records at 12 even for higher-rep sets', () => {
    const records = computeExerciseRecords(
      summarizeSessions([
        makeSession({
          date: '2026-06-01T10:00:00Z',
          sets: [{ weightKg: 60, reps: 20, rpe: 8 }],
        }),
      ])
    );
    const reps = records.repRecords.map((r) => r.reps);
    expect(Math.max(...reps)).toBe(12);
    expect(reps).toHaveLength(12);
  });

  it('keeps the earliest date on a tied rep record', () => {
    const records = computeExerciseRecords(
      summarizeSessions([
        makeSession({
          date: '2026-05-01T10:00:00Z',
          sets: [{ weightKg: 100, reps: 5, rpe: 8 }],
        }),
        makeSession({
          date: '2026-06-01T10:00:00Z',
          sets: [{ weightKg: 100, reps: 5, rpe: 8 }],
        }),
      ])
    );
    const rec5 = records.repRecords.find((r) => r.reps === 5);
    expect(rec5?.date).toBe('2026-05-01T10:00:00Z');
  });

  it('derives best e1RM, heaviest weight, set/session volume, and lifetime totals', () => {
    const records = computeExerciseRecords(
      summarizeSessions([
        makeSession({
          sessionId: 'a',
          date: '2026-05-01T10:00:00Z',
          sets: [
            { weightKg: 100, reps: 10, rpe: 8 }, // set volume 1000
            { weightKg: 110, reps: 8, rpe: 9 },  // set volume 880
          ],
        }),
        makeSession({
          sessionId: 'b',
          date: '2026-06-01T10:00:00Z',
          sets: [{ weightKg: 120, reps: 3, rpe: 9 }], // heaviest weight
        }),
      ])
    );

    expect(records.heaviestWeight).toEqual({
      weightKg: 120,
      reps: 3,
      date: '2026-06-01T10:00:00Z',
    });

    expect(records.bestSetVolume?.volumeKg).toBe(1000);
    expect(records.bestSetVolume?.set).toEqual({ weightKg: 100, reps: 10, rpe: 8 });
    expect(records.bestSessionVolume).toEqual({
      volumeKg: 1880,
      date: '2026-05-01T10:00:00Z',
    });

    // 100×10 @RIR2 -> effective 12 reps is the strongest e1RM of the three.
    const expectedBest = Math.max(
      estimateE1RM(100, 10, 2),
      estimateE1RM(110, 8, 1),
      estimateE1RM(120, 3, 1)
    );
    expect(records.bestE1RM?.valueKg).toBe(expectedBest);

    expect(records.lifetime).toEqual({
      totalSets: 3,
      totalVolumeKg: 1000 + 880 + 360,
      totalSessions: 2,
      firstDate: '2026-05-01T10:00:00Z',
    });
  });

  it('returns empty records for no history', () => {
    const records = computeExerciseRecords([]);
    expect(records.bestE1RM).toBeNull();
    expect(records.heaviestWeight).toBeNull();
    expect(records.bestSetVolume).toBeNull();
    expect(records.bestSessionVolume).toBeNull();
    expect(records.repRecords).toEqual([]);
    expect(records.lifetime).toEqual({
      totalSets: 0,
      totalVolumeKg: 0,
      totalSessions: 0,
      firstDate: null,
    });
  });
});

// === Charts ===

describe('buildE1RMTrend', () => {
  const now = new Date('2026-07-01T00:00:00Z');

  const sessions = summarizeSessions([
    makeSession({
      date: '2026-06-01T10:00:00Z',
      sets: [{ weightKg: 100, reps: 5, rpe: 9 }],
    }),
    makeSession({
      date: '2026-06-08T10:00:00Z',
      isDeload: true,
      sets: [{ weightKg: 80, reps: 5, rpe: 6 }],
    }),
    makeSession({
      date: '2025-01-01T10:00:00Z',
      sets: [{ weightKg: 90, reps: 5, rpe: 9 }],
    }),
  ]);

  it('excludes deload sessions from the trend line but keeps them as separate dots', () => {
    const points = buildE1RMTrend(sessions, 'all', now);
    expect(points).toHaveLength(3);

    const deloadPoint = points.find((p) => p.date === '2026-06-08T10:00:00Z');
    expect(deloadPoint?.e1rm).toBeNull();
    expect(deloadPoint?.deloadE1rm).toBeGreaterThan(0);

    const normalPoint = points.find((p) => p.date === '2026-06-01T10:00:00Z');
    expect(normalPoint?.e1rm).toBeGreaterThan(0);
    expect(normalPoint?.deloadE1rm).toBeNull();
  });

  it('returns points oldest first', () => {
    const points = buildE1RMTrend(sessions, 'all', now);
    expect(points[0].date).toBe('2025-01-01T10:00:00Z');
  });

  it('filters by time range', () => {
    expect(buildE1RMTrend(sessions, '3m', now)).toHaveLength(2);
    expect(buildE1RMTrend(sessions, '1y', now)).toHaveLength(2);
    expect(buildE1RMTrend(sessions, 'all', now)).toHaveLength(3);
  });

  it('drops sessions with no working sets', () => {
    const withEmpty = summarizeSessions([
      makeSession({ date: '2026-06-15T10:00:00Z' }),
    ]);
    expect(buildE1RMTrend(withEmpty, 'all', now)).toHaveLength(0);
  });
});

describe('buildWeeklyVolume', () => {
  it('buckets sessions into Monday-start weeks and sums volume', () => {
    // 2026-06-08 is a Monday; 2026-06-10 falls in the same week,
    // 2026-06-15 (next Monday) starts a new one.
    const points = buildWeeklyVolume(
      summarizeSessions([
        makeSession({
          date: '2026-06-08T10:00:00Z',
          sets: [{ weightKg: 100, reps: 10, rpe: 8 }],
        }),
        makeSession({
          date: '2026-06-10T10:00:00Z',
          sets: [{ weightKg: 50, reps: 10, rpe: 8 }],
        }),
        makeSession({
          date: '2026-06-15T10:00:00Z',
          sets: [{ weightKg: 100, reps: 5, rpe: 8 }],
        }),
      ])
    );

    expect(points).toHaveLength(2);
    expect(points[0].volumeKg).toBe(1500);
    expect(points[1].volumeKg).toBe(500);
    // Oldest week first
    expect(points[0].weekStart < points[1].weekStart).toBe(true);
  });

  it('skips zero-volume sessions', () => {
    expect(
      buildWeeklyVolume(summarizeSessions([makeSession({ date: '2026-06-08T10:00:00Z' })]))
    ).toHaveLength(0);
  });
});

// === Set display helpers ===

describe('effortColorClass', () => {
  it('follows the RIR color convention', () => {
    expect(effortColorClass(10)).toBe('text-orange-400'); // 0 RIR maxed
    expect(effortColorClass(9)).toBe('text-warning-400'); // 1 RIR hard
    expect(effortColorClass(8)).toBe('text-success-400'); // 2 RIR good
    expect(effortColorClass(7)).toBe('text-success-400'); // 3 RIR good
    expect(effortColorClass(6)).toBe('text-danger-400');  // 4+ RIR too easy
    expect(effortColorClass(null)).toBe('text-surface-500');
    expect(effortColorClass(0)).toBe('text-surface-500');
  });
});

describe('setRir', () => {
  it('maps stored RPE back to RIR and hides unusable values', () => {
    expect(setRir(10)).toBe(0);
    expect(setRir(8)).toBe(2);
    expect(setRir(null)).toBeNull();
    expect(setRir(0)).toBeNull();
  });
});

describe('setE1RM', () => {
  it('treats missing RPE as taken to failure', () => {
    expect(setE1RM({ weightKg: 100, reps: 5, rpe: null })).toBe(estimateE1RM(100, 5, 0));
  });

  it('credits reps in reserve via the canonical estimator', () => {
    expect(setE1RM({ weightKg: 100, reps: 5, rpe: 8 })).toBe(estimateE1RM(100, 5, 2));
  });
});

// === History sparkline ===

describe('buildSessionSparkline', () => {
  const NOW = new Date('2026-06-15T12:00:00Z');

  it('plots best e1RM per session, oldest first, within the 12-week window', () => {
    const sessions = summarizeSessions([
      // Outside the 84-day window — dropped.
      makeSession({
        date: '2026-01-01T10:00:00Z',
        sets: [{ weightKg: 90, reps: 8, rpe: 8 }],
      }),
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [{ weightKg: 105, reps: 8, rpe: 8 }],
      }),
      makeSession({
        date: '2026-05-01T10:00:00Z',
        sets: [{ weightKg: 100, reps: 8, rpe: 8 }],
      }),
    ]);

    const points = buildSessionSparkline(sessions, 'e1rm', NOW);

    expect(points.map((p) => p.date)).toEqual([
      '2026-05-01T10:00:00Z',
      '2026-06-01T10:00:00Z',
    ]);
    expect(points[0].value).toBe(estimateE1RM(100, 8, 2));
    expect(points[1].value).toBe(estimateE1RM(105, 8, 2));
  });

  it('excludes deload sessions — their dip is intentional, not regression', () => {
    const sessions = summarizeSessions([
      makeSession({
        date: '2026-06-01T10:00:00Z',
        isDeload: true,
        sets: [{ weightKg: 60, reps: 8, rpe: 6 }],
      }),
      makeSession({
        date: '2026-06-08T10:00:00Z',
        sets: [{ weightKg: 100, reps: 8, rpe: 8 }],
      }),
    ]);

    const points = buildSessionSparkline(sessions, 'e1rm', NOW);
    expect(points.map((p) => p.date)).toEqual(['2026-06-08T10:00:00Z']);
  });

  it('plots session tonnage for the volume metric', () => {
    const sessions = summarizeSessions([
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [
          { weightKg: 100, reps: 10, rpe: 8 },
          { weightKg: 100, reps: 8, rpe: 8 },
        ],
      }),
    ]);

    const points = buildSessionSparkline(sessions, 'volume', NOW);
    expect(points).toEqual([{ date: '2026-06-01T10:00:00Z', value: 1800 }]);
  });

  it('plots total straight-set seconds for the duration metric, ignoring special schemes', () => {
    const sessions = summarizeSessions([
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [
          // Duration exercises store seconds in `reps`; a bodyweight plank has
          // weightKg 0 (zero tonnage — the volume metric would drop it).
          { weightKg: 0, reps: 60, rpe: 8 },
          { weightKg: 0, reps: 45, rpe: 9 },
          { weightKg: 0, reps: 30, rpe: 9, setType: 'dropset' },
        ],
      }),
    ]);

    const points = buildSessionSparkline(sessions, 'duration', NOW);
    expect(points).toEqual([{ date: '2026-06-01T10:00:00Z', value: 105 }]);
  });

  it('drops sessions whose metric carries no signal', () => {
    const sessions = summarizeSessions([
      // Only a dropset — no straight-set seconds.
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [{ weightKg: 0, reps: 30, rpe: 9, setType: 'dropset' }],
      }),
    ]);

    expect(buildSessionSparkline(sessions, 'duration', NOW)).toEqual([]);
  });

  it('honors a custom window', () => {
    const sessions = summarizeSessions([
      makeSession({
        date: '2026-06-01T10:00:00Z',
        sets: [{ weightKg: 100, reps: 8, rpe: 8 }],
      }),
      makeSession({
        date: '2026-06-14T10:00:00Z',
        sets: [{ weightKg: 100, reps: 8, rpe: 8 }],
      }),
    ]);

    const points = buildSessionSparkline(sessions, 'e1rm', NOW, 7);
    expect(points.map((p) => p.date)).toEqual(['2026-06-14T10:00:00Z']);
  });
});
