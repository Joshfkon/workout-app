import {
  computeWeeklySetsByMuscle,
  exerciseKey,
  planWeeklySetAdjustments,
  resolveVolumeLandmarks,
  standardMusclesFor,
  type PlanWeeklySetAdjustmentsInput,
  type RolloverSession,
} from '../weeklyRollover';
import type { MuscleWeekFeedback, PerformanceTrend } from '@/services/weeklyProgressionEngine';
import { DEFAULT_VOLUME_LANDMARKS } from '@/types/schema';
import type { StandardMuscleGroup, VolumeLandmarks } from '@/types/schema';

function landmarks(overrides: Partial<Record<StandardMuscleGroup, VolumeLandmarks>> = {}) {
  return { ...DEFAULT_VOLUME_LANDMARKS.intermediate, ...overrides };
}

function goodFeedback(): MuscleWeekFeedback {
  return { sorenessBefore: 1, pump: 2, workload: 1 };
}

/** Week: two sessions, quads primary on both; last quads exercise is s1:e0. */
function week(): RolloverSession[] {
  return [
    {
      exercises: [
        { exerciseName: 'Squat', primaryMuscle: 'quads', sets: 3 },
        { exerciseName: 'Row', primaryMuscle: 'lats', sets: 3 },
      ],
    },
    {
      exercises: [
        { exerciseName: 'Leg Press', primaryMuscle: 'quads', sets: 3 },
        { exerciseName: 'Curl', primaryMuscle: 'biceps', sets: 2 },
      ],
    },
  ];
}

function makeInput(overrides: Partial<PlanWeeklySetAdjustmentsInput> = {}): PlanWeeklySetAdjustmentsInput {
  return {
    weekSessions: week(),
    feedbackByMuscle: new Map<StandardMuscleGroup, MuscleWeekFeedback[]>(),
    trendByMuscle: new Map<StandardMuscleGroup, PerformanceTrend>(),
    // Fixture trains quads at 6 weekly sets; keep that inside [mev, mrv] so
    // both add and remove paths are reachable in these tests.
    landmarksByMuscle: landmarks({ quads: { mev: 4, mav: 8, mrv: 12 } }),
    weekInMeso: 2,
    isDeloadWeek: false,
    ...overrides,
  };
}

describe('standardMusclesFor', () => {
  it('passes standard muscles through', () => {
    expect(standardMusclesFor('quads')).toEqual(['quads']);
    expect(standardMusclesFor('chest_upper')).toEqual(['chest_upper']);
  });

  it('expands legacy muscles to their standard groups', () => {
    expect(standardMusclesFor('chest')).toEqual(['chest_upper', 'chest_lower']);
    expect(standardMusclesFor('back')).toEqual(['lats', 'upper_back']);
  });

  it('is case-insensitive and returns [] for unknown names', () => {
    expect(standardMusclesFor('Chest')).toEqual(['chest_upper', 'chest_lower']);
    expect(standardMusclesFor('wings')).toEqual([]);
  });
});

describe('computeWeeklySetsByMuscle', () => {
  it('sums sets per muscle across the week', () => {
    const sets = computeWeeklySetsByMuscle(week());
    expect(sets.get('quads')).toBe(6);
    expect(sets.get('lats')).toBe(3);
    expect(sets.get('biceps')).toBe(2);
  });

  it('credits legacy primaries to every mapped standard muscle', () => {
    const sets = computeWeeklySetsByMuscle([
      { exercises: [{ exerciseName: 'Bench', primaryMuscle: 'chest', sets: 4 }] },
    ]);
    expect(sets.get('chest_upper')).toBe(4);
    expect(sets.get('chest_lower')).toBe(4);
  });
});

describe('resolveVolumeLandmarks', () => {
  it('returns experience defaults when no custom landmarks exist', () => {
    expect(resolveVolumeLandmarks('novice')).toEqual(DEFAULT_VOLUME_LANDMARKS.novice);
    expect(resolveVolumeLandmarks('advanced', null)).toEqual(DEFAULT_VOLUME_LANDMARKS.advanced);
  });

  it('overlays well-formed custom entries and ignores junk', () => {
    const resolved = resolveVolumeLandmarks('intermediate', {
      quads: { mev: 9, mav: 15, mrv: 21 },
      not_a_muscle: { mev: 1, mav: 2, mrv: 3 },
      lats: { mev: 'lots' }, // malformed → ignored
    });
    expect(resolved.quads).toEqual({ mev: 9, mav: 15, mrv: 21 });
    expect(resolved.lats).toEqual(DEFAULT_VOLUME_LANDMARKS.intermediate.lats);
  });
});

describe('planWeeklySetAdjustments', () => {
  it('makes no block changes when there is no feedback (parity with pre-feature behavior)', () => {
    const plan = planWeeklySetAdjustments(makeInput());
    expect(plan.byExercise.size).toBe(0);
    expect(plan.summary.every((s) => s.action === 'hold')).toBe(true);
  });

  it('makes no block changes on a deload week even with great feedback', () => {
    const plan = planWeeklySetAdjustments(
      makeInput({
        isDeloadWeek: true,
        feedbackByMuscle: new Map([['quads', [goodFeedback()]]]),
      })
    );
    expect(plan.byExercise.size).toBe(0);
    expect(plan.summary.find((s) => s.muscle === 'quads')?.reason).toMatch(/deload/i);
  });

  it('adds a set to the LAST exercise targeting the muscle as primary', () => {
    const plan = planWeeklySetAdjustments(
      makeInput({ feedbackByMuscle: new Map([['quads', [goodFeedback()]]]) })
    );
    // Last quads exercise in the week is session 1, exercise 0 (Leg Press)
    const adjustment = plan.byExercise.get(exerciseKey(1, 0));
    expect(adjustment).toMatchObject({ muscle: 'quads', action: 'add', delta: 1, adjustedSets: 4 });
    expect(adjustment?.label).toMatch(/^\+1 set Quads — /);
    expect(plan.byExercise.size).toBe(1);
  });

  it('removes a set from the last exercise for the muscle on bad recovery', () => {
    const plan = planWeeklySetAdjustments(
      makeInput({
        feedbackByMuscle: new Map<StandardMuscleGroup, MuscleWeekFeedback[]>([
          ['quads', [{ sorenessBefore: 3, pump: 1, workload: 1 }]],
        ]),
      })
    );
    const adjustment = plan.byExercise.get(exerciseKey(1, 0));
    expect(adjustment).toMatchObject({ muscle: 'quads', action: 'remove', delta: -1, adjustedSets: 2 });
    expect(adjustment?.label).toMatch(/^-1 set Quads — /);
  });

  it('never removes below 1 set per exercise; falls back to an earlier exercise', () => {
    const sessions: RolloverSession[] = [
      {
        exercises: [
          { exerciseName: 'Squat', primaryMuscle: 'quads', sets: 4 },
          { exerciseName: 'Leg Extension', primaryMuscle: 'quads', sets: 1 },
        ],
      },
    ];
    const plan = planWeeklySetAdjustments(
      makeInput({
        weekSessions: sessions,
        feedbackByMuscle: new Map<StandardMuscleGroup, MuscleWeekFeedback[]>([
          ['quads', [{ sorenessBefore: 3, pump: 1, workload: 1 }]],
        ]),
      })
    );
    // Last quads exercise has only 1 set → the removal targets the squat instead
    expect(plan.byExercise.get(exerciseKey(0, 1))).toBeUndefined();
    expect(plan.byExercise.get(exerciseKey(0, 0))).toMatchObject({ delta: -1, adjustedSets: 3 });
  });

  it('skips the removal entirely when every candidate exercise has 1 set', () => {
    const sessions: RolloverSession[] = [
      { exercises: [{ exerciseName: 'Leg Extension', primaryMuscle: 'quads', sets: 1 }] },
    ];
    const plan = planWeeklySetAdjustments(
      makeInput({
        weekSessions: sessions,
        // 1 weekly set is already below intermediate MEV, so force the remove
        // path via declining performance + low landmarks
        landmarksByMuscle: landmarks({ quads: { mev: 0, mav: 2, mrv: 4 } }),
        feedbackByMuscle: new Map<StandardMuscleGroup, MuscleWeekFeedback[]>([
          ['quads', [{ sorenessBefore: 3, pump: 1, workload: 3 }]],
        ]),
      })
    );
    expect(plan.byExercise.size).toBe(0);
    expect(plan.summary.find((s) => s.muscle === 'quads')?.action).toBe('remove');
  });

  it('applies at most one adjustment per exercise when a legacy muscle maps to two standard groups', () => {
    const sessions: RolloverSession[] = [
      { exercises: [{ exerciseName: 'Bench Press', primaryMuscle: 'chest', sets: 3 }] },
    ];
    const plan = planWeeklySetAdjustments(
      makeInput({
        weekSessions: sessions,
        feedbackByMuscle: new Map<StandardMuscleGroup, MuscleWeekFeedback[]>([
          ['chest_upper', [goodFeedback()]],
          ['chest_lower', [goodFeedback()]],
        ]),
      })
    );
    // Both chest_upper and chest_lower recommend +1, but the bench only moves ±1
    const adjustment = plan.byExercise.get(exerciseKey(0, 0));
    expect(plan.byExercise.size).toBe(1);
    expect(adjustment?.adjustedSets).toBe(4);
  });

  it('feeds the performance trend through to the engine (declining → remove)', () => {
    const plan = planWeeklySetAdjustments(
      makeInput({
        feedbackByMuscle: new Map([['quads', [goodFeedback()]]]),
        trendByMuscle: new Map([['quads', 'declining' as PerformanceTrend]]),
      })
    );
    const adjustment = plan.byExercise.get(exerciseKey(1, 0));
    expect(adjustment).toMatchObject({ action: 'remove', delta: -1 });
    expect(adjustment?.label).toMatch(/declining/i);
  });

  it('only evaluates muscles present in the week plan', () => {
    const plan = planWeeklySetAdjustments(
      makeInput({ feedbackByMuscle: new Map([['calves', [goodFeedback()]]]) })
    );
    expect(plan.summary.some((s) => s.muscle === 'calves')).toBe(false);
    expect(plan.byExercise.size).toBe(0);
  });
});
