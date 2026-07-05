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
