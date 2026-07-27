import {
  getExerciseProgression,
  getMuscleGroupProgression,
  getExpectedPace,
  getPaceDisplay,
  formatLastSessionDelta,
  EXPECTED_WEEKLY_E1RM_GAIN_PCT,
  MIN_SESSIONS_FOR_INSIGHT,
} from '../progressionInsights';
import type { ExercisePerformanceSnapshot } from '@/types/schema';

/**
 * Build weekly snapshots with a given starting E1RM and per-week gain %.
 * Sessions are 7 days apart ending 2026-06-29.
 */
function buildSnapshots(
  exerciseId: string,
  weeks: number,
  startE1RM: number,
  weeklyGainPct: number,
  opts: { startWeightKg?: number; reps?: number } = {}
): ExercisePerformanceSnapshot[] {
  const snapshots: ExercisePerformanceSnapshot[] = [];
  const end = new Date('2026-06-29T00:00:00');
  for (let i = 0; i < weeks; i++) {
    const date = new Date(end);
    date.setDate(end.getDate() - (weeks - 1 - i) * 7);
    const e1rm = startE1RM * Math.pow(1 + weeklyGainPct / 100, i);
    snapshots.push({
      id: `snap-${i}`,
      userId: 'user-1',
      exerciseId,
      sessionDate: date.toISOString().slice(0, 10),
      topSetWeightKg: (opts.startWeightKg ?? 100) + i * 2.5,
      topSetReps: opts.reps ?? 8,
      topSetRpe: 8,
      totalWorkingSets: 3,
      estimatedE1RM: Math.round(e1rm * 10) / 10,
    });
  }
  return snapshots;
}

describe('getExerciseProgression', () => {
  it('returns insufficient_data below the minimum session count', () => {
    const snapshots = buildSnapshots('ex-1', MIN_SESSIONS_FOR_INSIGHT - 1, 100, 1);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
    });
    expect(result.pace).toBe('insufficient_data');
    expect(result.sessionsAnalyzed).toBe(MIN_SESSIONS_FOR_INSIGHT - 1);
    // Delta is still available with two sessions
    expect(result.lastSessionDelta).toEqual({ weightKg: 2.5, reps: 0 });
  });

  it('classifies a fast-gaining novice as ahead', () => {
    // 2%/week actual vs 1%/week expected -> ratio 2.0
    const snapshots = buildSnapshots('ex-1', 8, 100, 2);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
    });
    expect(result.pace).toBe('ahead');
    expect(result.weeklyChangePct).toBeGreaterThan(1.5);
    expect(result.expectedWeeklyPct).toBe(EXPECTED_WEEKLY_E1RM_GAIN_PCT.novice);
  });

  it('classifies expected-rate intermediate progress as on_track, not plateaued', () => {
    // 0.3%/week matches the intermediate expectation exactly. This is below
    // plateauDetector's 2%-in-4-sessions threshold, so the raw plateau flag
    // fires — pace must still read on_track.
    const snapshots = buildSnapshots('ex-1', 10, 100, 0.3);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'intermediate',
    });
    expect(result.pace).toBe('on_track');
  });

  it('classifies a flat trend with enough history as plateaued', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, 0);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'intermediate',
    });
    expect(result.pace).toBe('plateaued');
    expect(result.isPlateaued).toBe(true);
    expect(result.weeklyChangePct).toBeCloseTo(0, 1);
  });

  it('classifies a regressing lift as plateaued or behind, never on_track', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, -0.5);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
    });
    expect(['plateaued', 'behind']).toContain(result.pace);
    expect(result.weeklyChangePct).toBeLessThan(0);
  });

  it('classifies slow-but-positive novice progress as behind when not plateau-flagged', () => {
    // 0.2%/wk vs 1%/wk expected -> ratio 0.2 (< 0.5). Only 3 sessions so the
    // plateau detector (needs 4) stays silent -> behind.
    const snapshots = buildSnapshots('ex-1', 3, 100, 0.2);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
    });
    expect(result.pace).toBe('behind');
  });

  it('reports weight and rep deltas vs the previous session', () => {
    const snapshots = buildSnapshots('ex-1', 4, 100, 1, { reps: 8 });
    snapshots[3] = { ...snapshots[3], topSetReps: 10 };
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
    });
    expect(result.lastSessionDelta).toEqual({ weightKg: 2.5, reps: 2 });
  });

  it('classifies holding strength on a cut as on_track, not behind', () => {
    // Flat E1RM is exactly what a cut should deliver. Without the goal this
    // would read plateaued (bulk expectations).
    const snapshots = buildSnapshots('ex-1', 8, 100, 0);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'intermediate',
      goal: 'cut',
    });
    expect(result.pace).toBe('on_track');
    expect(result.expectedWeeklyPct).toBe(0);
  });

  it('classifies gaining strength on a cut as ahead', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, 0.5);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'advanced',
      goal: 'cut',
    });
    expect(result.pace).toBe('ahead');
  });

  it('still flags a real strength decline on a cut', () => {
    // -1%/week over 8 weeks is losing strength faster than a cut should cost
    const snapshots = buildSnapshots('ex-1', 8, 100, -1);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'intermediate',
      goal: 'cut',
    });
    expect(['plateaued', 'behind']).toContain(result.pace);
  });

  it('classifies holding strength at maintenance as on_track', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, 0);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'intermediate',
      goal: 'maintenance',
    });
    expect(result.pace).toBe('on_track');
  });

  it('handles empty snapshots', () => {
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots: [],
      experience: 'novice',
    });
    expect(result.pace).toBe('insufficient_data');
    expect(result.currentE1RM).toBe(0);
    expect(result.lastSessionDelta).toBeUndefined();
  });
});

describe('getMuscleGroupProgression', () => {
  it('rolls exercises up to muscle groups and sorts problems first', () => {
    const snapshotsByExercise = new Map([
      ['bench', buildSnapshots('bench', 8, 100, 2)], // ahead (novice)
      ['fly', buildSnapshots('fly', 8, 40, 2)], // ahead
      ['squat', buildSnapshots('squat', 8, 140, 0)], // plateaued
      ['legpress', buildSnapshots('legpress', 8, 200, 0)], // plateaued
    ]);
    const muscleByExercise = new Map([
      ['bench', 'chest'],
      ['fly', 'chest'],
      ['squat', 'quads'],
      ['legpress', 'quads'],
    ]);

    const results = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'novice',
    });

    expect(results).toHaveLength(2);
    // Worst first: quads (plateaued) before chest (ahead)
    expect(results[0].muscleGroup).toBe('quads');
    expect(results[0].pace).toBe('plateaued');
    expect(results[0].plateauedCount).toBe(2);
    expect(results[1].muscleGroup).toBe('chest');
    expect(results[1].pace).toBe('ahead');
    expect(results[1].exerciseCount).toBe(2);
  });

  it('skips exercises without a muscle mapping', () => {
    const snapshotsByExercise = new Map([
      ['bench', buildSnapshots('bench', 8, 100, 1)],
      ['mystery', buildSnapshots('mystery', 8, 50, 1)],
    ]);
    const muscleByExercise = new Map([['bench', 'chest']]);

    const results = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'novice',
    });

    expect(results).toHaveLength(1);
    expect(results[0].muscleGroup).toBe('chest');
    expect(results[0].exerciseCount).toBe(1);
  });

  it('marks a muscle group with only new exercises as insufficient_data', () => {
    const snapshotsByExercise = new Map([['curl', buildSnapshots('curl', 1, 30, 0)]]);
    const muscleByExercise = new Map([['curl', 'biceps']]);

    const results = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'intermediate',
    });

    expect(results[0].pace).toBe('insufficient_data');
    expect(results[0].analyzedCount).toBe(0);
    expect(results[0].exerciseCount).toBe(1);
  });
});

describe('getExpectedPace', () => {
  it('expects the full experience rate on a bulk (and by default)', () => {
    expect(getExpectedPace('novice', 'bulk').expectedWeeklyPct).toBe(
      EXPECTED_WEEKLY_E1RM_GAIN_PCT.novice
    );
    expect(getExpectedPace('intermediate').expectedWeeklyPct).toBe(
      EXPECTED_WEEKLY_E1RM_GAIN_PCT.intermediate
    );
  });

  it('expects roughly half the bulk rate on a recomp', () => {
    expect(getExpectedPace('novice', 'recomp').expectedWeeklyPct).toBe(
      EXPECTED_WEEKLY_E1RM_GAIN_PCT.novice / 2
    );
  });

  it('expects no gains on maintenance/cut and normalizes maintain', () => {
    expect(getExpectedPace('novice', 'cut').expectedWeeklyPct).toBe(0);
    expect(getExpectedPace('novice', 'maintenance').expectedWeeklyPct).toBe(0);
    expect(getExpectedPace('novice', 'maintain')).toEqual(
      getExpectedPace('novice', 'maintenance')
    );
  });

  it('tolerates a larger weekly decline on a cut than at maintenance', () => {
    expect(getExpectedPace('novice', 'cut').onTrackAtPct).toBeLessThan(
      getExpectedPace('novice', 'maintenance').onTrackAtPct
    );
  });
});

describe('muscle rollup with a goal', () => {
  it('reads flat lifts as on_track when cutting instead of plateaued', () => {
    const snapshotsByExercise = new Map([
      ['squat', buildSnapshots('squat', 8, 140, 0)],
      ['legpress', buildSnapshots('legpress', 8, 200, 0)],
    ]);
    const muscleByExercise = new Map([
      ['squat', 'quads'],
      ['legpress', 'quads'],
    ]);

    const results = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'novice',
      goal: 'cut',
    });

    expect(results[0].pace).toBe('on_track');
    expect(results[0].plateauedCount).toBe(0);
  });
});

describe('display helpers', () => {
  it('maps every pace to a label and tone', () => {
    expect(getPaceDisplay('ahead')).toEqual({ label: 'Ahead of pace', tone: 'positive' });
    expect(getPaceDisplay('on_track')).toEqual({ label: 'On track', tone: 'neutral' });
    expect(getPaceDisplay('behind')).toEqual({ label: 'Behind pace', tone: 'warning' });
    expect(getPaceDisplay('plateaued')).toEqual({ label: 'Plateaued', tone: 'negative' });
    expect(getPaceDisplay('insufficient_data')).toEqual({
      label: 'Building history',
      tone: 'muted',
    });
  });

  it('formatLastSessionDelta returns null for no change or no history', () => {
    expect(formatLastSessionDelta(undefined)).toBeNull();
    expect(formatLastSessionDelta({ weightKg: 0, reps: 0 })).toBeNull();
    expect(formatLastSessionDelta({ weightKg: 2.5, reps: -1 })).toEqual({
      weightKg: 2.5,
      reps: -1,
    });
  });
});

// ============================================
// PROGRAM-BOUNDARY CONFIDENCE GATING
// ============================================

describe('program-boundary confidence gating', () => {
  // 8 weekly sessions ending 2026-06-29; a program that started 2026-06-20
  // leaves only 2 sessions since the boundary (< MIN_SESSIONS_FOR_INSIGHT).
  const PROGRAM_START = '2026-06-20';

  it('marks a lift straddling the program boundary as calibrating with NO rate', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, 2);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
      programStartDate: PROGRAM_START,
    });
    expect(result.pace).toBe('calibrating');
    // The number is noise with a decimal point — it must not exist.
    expect(result.weeklyChangePct).toBe(0);
    expect(result.weeklyChangeKg).toBe(0);
    expect(result.isPlateaued).toBe(false);
  });

  it('keeps full confidence once enough sessions accrue after the boundary', () => {
    const snapshots = buildSnapshots('ex-1', 8, 100, 2);
    const result = getExerciseProgression({
      exerciseId: 'ex-1',
      snapshots,
      experience: 'novice',
      // Program started before all 8 sessions -> no straddle.
      programStartDate: '2026-05-01',
    });
    expect(result.pace).not.toBe('calibrating');
    expect(result.weeklyChangePct).toBeGreaterThan(0);
  });

  it('rolls a low-confidence-only muscle up as calibrating with no rate', () => {
    const snapshotsByExercise = new Map([
      ['ex-1', buildSnapshots('ex-1', 8, 100, 2)],
      ['ex-2', buildSnapshots('ex-2', 6, 80, 1)],
    ]);
    const muscleByExercise = new Map([
      ['ex-1', 'chest'],
      ['ex-2', 'chest'],
    ]);

    const groups = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'novice',
      programStartDate: PROGRAM_START,
    });

    expect(groups).toHaveLength(1);
    const chest = groups[0];
    expect(chest.pace).toBe('calibrating');
    expect(chest.avgWeeklyChangePct).toBe(0);
    expect(chest.analyzedCount).toBe(0);
    expect(chest.calibratingCount).toBe(2);
  });

  it('shows a rate when at least one contributing lift is confident, averaging confident lifts only', () => {
    // Boundary 2026-06-10. Weekly sessions ending 2026-06-29 give three
    // post-boundary sessions (6/15, 6/22, 6/29) → confident. Dropping the
    // last session leaves two post-boundary (6/15, 6/22) → calibrating.
    const confident = buildSnapshots('ex-conf', 8, 100, 2);
    const calibrating = buildSnapshots('ex-cal', 8, 80, -5).slice(0, -1);
    const snapshotsByExercise = new Map([
      ['ex-conf', confident],
      ['ex-cal', calibrating],
    ]);
    const muscleByExercise = new Map([
      ['ex-conf', 'back'],
      ['ex-cal', 'back'],
    ]);

    const groups = getMuscleGroupProgression({
      snapshotsByExercise,
      muscleByExercise,
      experience: 'novice',
      programStartDate: '2026-06-10',
    });

    const back = groups[0];
    // One confident lift is enough for a real rate; the calibrating lift's
    // (strongly negative) noise slope must NOT drag the average.
    expect(back.pace).not.toBe('calibrating');
    expect(back.analyzedCount).toBe(1);
    expect(back.calibratingCount).toBe(1);
    expect(back.avgWeeklyChangePct).toBeGreaterThan(0);
  });

  it('maps calibrating pace to a muted label', () => {
    expect(getPaceDisplay('calibrating')).toEqual({ label: 'Calibrating', tone: 'muted' });
  });
});

// ============================================
// TREND-ROBUSTNESS VERIFICATION FIXTURES
// (Glutes +35.4%/wk repro — see the trend-robustness task)
// ============================================

describe('muscle rollup weighting and sanity ceiling', () => {
  it('a 3-session outlier lift cannot outvote a 12-session staple (weighted rollup)', () => {
    // Back Extension: 3 sessions rocketing +35%/wk (calibration noise).
    // Hip Thrust: 12 sessions at a plausible +1%/wk.
    const backExtension = buildSnapshots('ex-back-ext', 3, 60, 35);
    const hipThrust = buildSnapshots('ex-hip-thrust', 12, 140, 1);

    const groups = getMuscleGroupProgression({
      snapshotsByExercise: new Map([
        ['ex-back-ext', backExtension],
        ['ex-hip-thrust', hipThrust],
      ]),
      muscleByExercise: new Map([
        ['ex-back-ext', 'glutes'],
        ['ex-hip-thrust', 'glutes'],
      ]),
      experience: 'intermediate',
    });

    const glutes = groups.find((g) => g.muscleGroup === 'glutes')!;
    // The group rate must sit near the staple's rate, nowhere near +35.
    expect(glutes.avgWeeklyChangePct).toBeLessThan(10);
    expect(glutes.rateImplausible).toBe(false);
    expect(Math.abs(glutes.avgWeeklyChangePct - 1)).toBeLessThan(2.5);
  });

  it('renders Building history (insufficient_data) when no lift qualifies, never a fabricated rate', () => {
    const groups = getMuscleGroupProgression({
      snapshotsByExercise: new Map([
        ['ex-new-1', buildSnapshots('ex-new-1', 2, 60, 5)],
        ['ex-new-2', buildSnapshots('ex-new-2', 1, 80, 0)],
      ]),
      muscleByExercise: new Map([
        ['ex-new-1', 'quads'],
        ['ex-new-2', 'quads'],
      ]),
      experience: 'novice',
    });
    const quads = groups.find((g) => g.muscleGroup === 'quads')!;
    expect(quads.pace).toBe('insufficient_data');
    expect(quads.avgWeeklyChangePct).toBe(0);
    expect(getPaceDisplay(quads.pace).label).toBe('Building history');
  });

  it('clamps and flags a physiologically implausible group rate that survives all filters', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Every contributor rockets — nothing to outvote it, so the ceiling
      // must catch it: +20%/wk is a bug signal, not a verdict.
      const groups = getMuscleGroupProgression({
        snapshotsByExercise: new Map([
          ['ex-a', buildSnapshots('ex-a', 6, 60, 20)],
          ['ex-b', buildSnapshots('ex-b', 6, 80, 22)],
        ]),
        muscleByExercise: new Map([
          ['ex-a', 'forearms'],
          ['ex-b', 'forearms'],
        ]),
        experience: 'novice',
      });
      const forearms = groups.find((g) => g.muscleGroup === 'forearms')!;
      expect(forearms.rateImplausible).toBe(true);
      expect(Math.abs(forearms.avgWeeklyChangePct)).toBeLessThanOrEqual(5);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('explicit equipment markers in the rollup path', () => {
  it('honors a user-marked boundary below the 25% heuristic (calibrating until rebuilt)', () => {
    // −15% shift at the marker: invisible to the heuristic, but the user
    // said the equipment changed — with only 2 post-marker sessions the lift
    // must read calibrating, not mix old and new levels into a rate.
    const pre = buildSnapshots('ex-marked', 4, 100, 0.5);
    const post = buildSnapshots('ex-marked', 2, 85, 0.5).map((s, i) => ({
      ...s,
      id: `post-${i}`,
      sessionDate: i === 0 ? '2026-07-06' : '2026-07-13',
    }));
    const snapshots = [...pre, ...post];

    const withMarker = getExerciseProgression({
      exerciseId: 'ex-marked',
      snapshots,
      experience: 'intermediate',
      referenceDate: '2026-07-13',
      knownDiscontinuities: ['2026-07-06'],
    });
    expect(withMarker.pace).toBe('calibrating');
    expect(withMarker.weeklyChangePct).toBe(0);

    // Without the marker the −15% shift is below the heuristic: the lift
    // classifies normally (this is exactly why the explicit marker exists).
    const withoutMarker = getExerciseProgression({
      exerciseId: 'ex-marked',
      snapshots,
      experience: 'intermediate',
      referenceDate: '2026-07-13',
    });
    expect(withoutMarker.pace).not.toBe('calibrating');
  });

  it('threads per-exercise markers through getMuscleGroupProgression', () => {
    const pre = buildSnapshots('ex-m', 4, 100, 0.5);
    const post = buildSnapshots('ex-m', 2, 85, 0.5).map((s, i) => ({
      ...s,
      id: `post-${i}`,
      sessionDate: i === 0 ? '2026-07-06' : '2026-07-13',
    }));
    const groups = getMuscleGroupProgression({
      snapshotsByExercise: new Map([['ex-m', [...pre, ...post]]]),
      muscleByExercise: new Map([['ex-m', 'chest']]),
      experience: 'intermediate',
      referenceDate: '2026-07-13',
      discontinuitiesByExercise: new Map([['ex-m', ['2026-07-06']]]),
    });
    const chest = groups.find((g) => g.muscleGroup === 'chest')!;
    expect(chest.pace).toBe('calibrating');
    expect(chest.avgWeeklyChangePct).toBe(0);
  });
});
