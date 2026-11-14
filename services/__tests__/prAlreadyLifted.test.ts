/**
 * PRs must not fire for something already lifted.
 *
 * Weight/reps PRs used to compare against the best-e1RM set's own weight and
 * reps, not the heaviest weight lifted — so a heavier set from last week that
 * wasn't the best-e1RM set did not count, and repeating it was a "New Weight
 * PR". And because e1RM uses RPE, repeating last week's exact weight × reps at
 * a lower RPE was a "New e1RM PR". These tests build the record the way the
 * workout page does (buildExerciseHistories → prBaselineFromRecord) and run
 * the live detector against it.
 */

import {
  buildExerciseHistories,
  type HistoryBlockRow,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/suggestions';
import {
  detectLiveSetPr,
  isAlreadyLifted,
  prBaselineFromRecord,
  type LivePrSetInput,
} from '../livePrDetector';

const PUSHDOWN = 'tricep-pushdown';

function session(
  sessionId: string,
  completedAt: string,
  sets: { weightKg: number; reps: number; rpe: number }[]
): HistoryBlockRow {
  return {
    id: `${sessionId}-${PUSHDOWN}`,
    exercise_id: PUSHDOWN,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: false,
    },
    set_logs: sets.map((s, i) => ({
      weight_kg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      is_warmup: false,
      set_number: i + 1,
      set_type: 'normal',
      logged_at: completedAt,
      location_id: null,
    })),
  };
}

// Last week: a high-rep set that carries the best e1RM, and a heavier,
// harder set that does not.
// 40 × 8 @8 → e1RM ≈ 53.3; 45 × 2 @10 → e1RM ≈ 46.3.
const lastWeek = session('w1', '2026-11-06', [
  { weightKg: 40, reps: 8, rpe: 8 },
  { weightKg: 45, reps: 2, rpe: 10 },
]);

const record = () => buildExerciseHistories([lastWeek])[PUSHDOWN].personalRecord;

const set = (weightKg: number, reps: number, rpe: number): LivePrSetInput => ({
  weightKg,
  reps,
  rpe,
  isWarmup: false,
  feedback: { form: 'clean' },
});

const detect = (s: LivePrSetInput, prior: LivePrSetInput[] = []) =>
  detectLiveSetPr({
    set: s,
    priorSessionSets: prior,
    previousBest: prBaselineFromRecord(record()),
    isDeload: false,
    exercise: { exerciseType: 'rep_based' },
  });

describe('PR baseline from history', () => {
  it('keeps the best-e1RM set as the record and adds the heaviest weight lifted', () => {
    const r = record();
    expect(r).toMatchObject({ weightKg: 40, reps: 8, heaviestWeightKg: 45, repsAtHeaviest: 2 });
    expect(r?.liftedSets).toEqual([
      { weightKg: 40, count: 8 },
      { weightKg: 45, count: 2 },
    ]);
  });
});

describe('no PR for something already lifted', () => {
  it('a weight between the best-e1RM set and the heaviest set is not a weight PR', () => {
    // The Nov 13 Tricep Pushdown pattern: heavier than the best-e1RM set
    // (40 kg) but lighter than the 45 kg already lifted. Was a weight PR.
    expect(detect(set(42, 5, 9))).toBeNull();
  });

  it('repeating last week\'s weight and reps at a lower RPE is not an e1RM PR', () => {
    // 40 × 8 again at RPE 7 → e1RM ≈ 55.4 > 53.3. Was an e1RM PR.
    expect(detect(set(40, 8, 7))).toBeNull();
  });

  it('matching an earlier set from this session is not a PR', () => {
    expect(detect(set(45, 6, 9), [set(45, 6, 9)])).toBeNull();
  });
});

describe('real PRs still fire', () => {
  it('heavier than anything lifted is a PR', () => {
    expect(detect(set(46, 3, 9))).toMatchObject({ type: 'weight', value: 46 });
  });

  it('more reps at the heaviest weight is a PR', () => {
    expect(detect(set(45, 4, 10))).toMatchObject({ type: 'reps', value: 4 });
  });
});

describe('isAlreadyLifted', () => {
  it('needs one earlier set to match or beat BOTH weight and count', () => {
    const earlier = [
      { weightKg: 100, count: 5 },
      { weightKg: 80, count: 12 },
    ];
    expect(isAlreadyLifted({ weightKg: 100, count: 5 }, earlier)).toBe(true);
    expect(isAlreadyLifted({ weightKg: 90, count: 10 }, earlier)).toBe(false);
    expect(isAlreadyLifted({ weightKg: 100, count: 6 }, earlier)).toBe(false);
  });

  it('compares weights at storage precision', () => {
    // 230 lb converted at full precision vs the stored DECIMAL(6,2) value.
    expect(isAlreadyLifted({ weightKg: 104.326, count: 6 }, [{ weightKg: 104.33, count: 6 }])).toBe(true);
  });
});
