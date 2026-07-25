import {
  buildExerciseHistories,
  isAnchorEligibleSet,
  type HistoryBlockRow,
} from '../suggestions';
import { recommendSeedForSlot } from '@/services/setRecommender';

/**
 * Phase 2 — anchor pool validity:
 *  1. Only set_type 'normal' non-warmup sets may anchor (cluster / myorep /
 *     rest-pause / dropset / AMRAP-burnout reps are not commensurable with
 *     straight-set reps; no cap fixes that).
 *  2. The pool must equal what the history / previousSets UI displays: both
 *     go through the SAME predicate (isAnchorEligibleSet), so a set can
 *     anchor a prescription only if the user can see it.
 *  3. No qualifying set → estimatedE1RM 0 → recommendSeedForSlot falls
 *     through to the last-session (double-progression) path instead of
 *     anchoring on garbage.
 */

const EX = 'seated-calf-raise';

function makeSet(
  weightKg: number,
  reps: number,
  rpe: number,
  opts: Partial<{ set_type: string; is_warmup: boolean; set_number: number }> = {}
) {
  return {
    weight_kg: weightKg,
    reps,
    rpe,
    is_warmup: opts.is_warmup ?? false,
    set_number: opts.set_number ?? 1,
    set_type: opts.set_type ?? 'normal',
    logged_at: '2026-07-11T10:00:00Z',
    location_id: null,
  };
}

function sessionBlock(
  sessionId: string,
  completedAt: string,
  sets: ReturnType<typeof makeSet>[]
): HistoryBlockRow {
  return {
    id: `${sessionId}-${EX}`,
    exercise_id: EX,
    workout_sessions: {
      id: sessionId,
      completed_at: completedAt,
      state: 'completed',
      user_id: 'u1',
      is_deload: false,
    },
    set_logs: sets.map((s, i) => ({ ...s, set_number: i + 1 })),
  };
}

describe('anchor pool eligibility (Phase 2)', () => {
  it('non-normal set types never enter the anchor pool, even in-domain ones', () => {
    // The dropset is 100 × 10 @ 9 — well inside the estimator's domain and
    // BIGGER than every straight set. It still must not anchor.
    const blocks = [
      sessionBlock('s1', '2026-07-20T10:00:00Z', [
        makeSet(61.2, 12, 9), // canonical ≈ 88.1 kg
        makeSet(61.2, 10, 7.5),
        makeSet(100, 10, 9, { set_type: 'dropset' }),
        makeSet(95, 8, 9, { set_type: 'myorep' }),
        makeSet(90, 8, 9, { set_type: 'rest_pause' }),
      ]),
    ];
    const history = buildExerciseHistories(blocks)[EX];
    // Anchor from the best NORMAL set only: 61.2 × 12 @ 9 → eff 13 → cap 12
    // → 61.2 × 1.44 = 88.1.
    expect(history.estimatedE1RM).toBeCloseTo(88.1, 1);
    // PR follows the same eligibility — the 100 kg dropset can't be the PR.
    expect(history.personalRecord?.weightKg).toBeCloseTo(61.2, 5);
  });

  it('pool equals the displayed history: same predicate feeds both', () => {
    const sets = [
      makeSet(61.2, 12, 9),
      makeSet(100, 10, 9, { set_type: 'dropset' }),
      makeSet(50, 5, 9, { is_warmup: true }),
    ];
    const blocks = [sessionBlock('s1', '2026-07-20T10:00:00Z', sets)];
    const history = buildExerciseHistories(blocks)[EX];

    // What the UI displays (lastWorkoutSets) is exactly the eligible sets.
    const displayed = sets.filter(isAnchorEligibleSet);
    expect(history.lastWorkoutSets.map((s) => s.weightKg)).toEqual(
      displayed.map((s) => s.weight_kg)
    );
    // And the anchor is derived from that same displayed set list: with the
    // one eligible set at 61.2 × 12 @ 9 the anchor is its estimate — nothing
    // hidden contributed.
    expect(history.estimatedE1RM).toBeCloseTo(88.1, 1);
  });

  it('no qualifying set → no anchor → seed falls through to the last-session path', () => {
    // Every set is beyond the estimator's domain (>15 effective reps): real
    // history, no e1RM claim.
    const blocks = [
      sessionBlock('s1', '2026-07-20T10:00:00Z', [
        makeSet(61.2, 20, 9),
        makeSet(61.2, 18, 8),
      ]),
    ];
    const history = buildExerciseHistories(blocks)[EX];
    expect(history.estimatedE1RM).toBe(0);

    // recommendSeedForSlot with anchor 0 takes the previous-session fallback
    // (recommendSessionStart / double progression), not the e1RM curve.
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: history.estimatedE1RM,
      recentWorkingWeightKg: 61.2,
      prevWeightKg: 61.2,
      prevReps: 20,
      prevRir: 1,
      prevSessionSets: history.lastWorkoutSets.map((s) => ({
        weightKg: s.weightKg,
        reps: s.reps,
        rir: 1,
      })),
    });
    expect(seed.anchorSource).toBe('last_session');
  });
});
