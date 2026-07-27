/**
 * Cap asymmetry + frozen-anchor classification (amendment follow-up).
 *
 * Two structural defects for high-rep exercises on the e1rm path:
 *
 * 1. INVERSION ASYMMETRY: the forward path (canonical estimator) clamps at
 *    12 effective reps, so stored anchors are FLOORS that never encode
 *    capability past the cap — but the inverse curve priced loads at the
 *    range's raw mid + RIR (a 12-20 range inverts at 18 eff), dividing an
 *    already-deflated number by an extrapolated divisor. Double deflation:
 *    the lateral-raise "priced at 10 lbs" family.
 *
 * 2. FROZEN ANCHOR / CLASSIFIER MISS: a set at 12 < eff ≤ 15 returns a
 *    capped estimate — w × 36/25 REGARDLESS of the actual rep count — so an
 *    exercise living above the cap has an anchor that cannot rise with rep
 *    progress (10 lb × anything ≈ 14.4 "e1RM", forever ≈ the frozen 15 lb
 *    estimate), while those same sets counted as "estimable" and kept the
 *    exercise off rep_total. Above-cap sets now count toward rep_total
 *    classification.
 */

import { prescribe, recommendSeedForSlot } from '../setRecommender';
import { estimateE1RM } from '../shared/e1rm';
import { resolveProgressionModel } from '../suggestionEngine/repTotalPolicy';
import { buildExerciseHistories, type HistoryBlockRow } from '../../app/(dashboard)/dashboard/workout/[id]/_lib/suggestions';

describe('frozen-anchor mechanism (the estimator fact the fixes rest on)', () => {
  it('every above-cap set produces the SAME capped value — rep progress is invisible', () => {
    // 10 lb lateral raises: 13, 15, 18 reps @ 2 RIR — eff 15, (17, 20 → null).
    const at13 = estimateE1RM(10, 13, 2);
    expect(at13).toEqual({ value: 14.4, confidence: 'medium' }); // 10 × 36/25 — the "15 lb" estimate
    // One more rep at the cap boundary: identical value.
    expect(estimateE1RM(10, 12, 2)!.value).toBe(14.4);
    // And past 15 eff there is no estimate at all.
    expect(estimateE1RM(10, 16, 2)).toBeNull();
  });
});

describe('fix 1 — anchor-domain inversion (no pricing beyond the cap)', () => {
  it('prescribe() weight-pick for a high-rep range prices at the cap, not the raw mid', () => {
    // Anchor 100, range 12-20 @ 2: raw mid + RIR = 18 eff → old divide-by-1.6
    // gave 62.5 off a number that never encoded 18-eff capability. Capped
    // pricing divides by 1.4 (eff 12).
    const p = prescribe({
      e1RMKg: 100,
      targetRir: 2,
      repRange: [12, 20],
      minIncrementKg: 2.5,
    });
    expect(p).not.toBeNull();
    expect(p!.weightKg).toBeCloseTo(72.5, 5); // round(100/1.4 = 71.43) on the 2.5 grid
  });

  it('standard ranges are unchanged (mid + RIR at or under the cap)', () => {
    const p = prescribe({
      e1RMKg: 100,
      targetRir: 2,
      repRange: [8, 12],
      minIncrementKg: 2.5,
    });
    // mid 10 + 2 = 12 eff — exactly the cap; capped and uncapped agree
    // (100/1.4 = 71.43 → 72.5 on the 2.5 grid).
    expect(p!.weightKg).toBeCloseTo(72.5, 5);
  });

  it('the e1RM-anchored seed for a high-rep range no longer double-deflates', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: 100,
    });
    expect(seed.anchorSource).toBe('e1rm');
    // Old pick: 100/1.6 = 62.5. Capped pick: 100/1.4 → 72.5 on the grid.
    expect(seed.weightKg).toBeCloseTo(72.5, 5);
  });
});

describe('fix 2 — above-cap sets count toward rep_total classification', () => {
  const sessionBlock = (
    sessionId: string,
    completedAt: string,
    sets: Array<{ weightKg: number; reps: number; rpe: number }>
  ): HistoryBlockRow => ({
    id: `${sessionId}-lat-raise`,
    exercise_id: 'lat-raise',
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
  });

  it('a lateral raise living above the cap auto-classifies to rep_total', () => {
    // Every set 13-15 reps @ RPE 8 (RIR 2) → eff 15: capped estimates that
    // can never move. Previously ALL counted "estimable" → stayed on e1rm
    // with a frozen anchor. Now they count inestimable → rep_total.
    const histories = buildExerciseHistories([
      sessionBlock('s2', '2026-07-24T10:00:00Z', [
        { weightKg: 10, reps: 13, rpe: 8 },
        { weightKg: 10, reps: 14, rpe: 8 },
        { weightKg: 10, reps: 15, rpe: 8.5 },
      ]),
      sessionBlock('s1', '2026-07-20T10:00:00Z', [
        { weightKg: 10, reps: 13, rpe: 8 },
        { weightKg: 10, reps: 13, rpe: 9 },
      ]),
    ]);
    const h = histories['lat-raise'];
    expect(h.estimableSetCount).toBe(0);
    expect(h.inestimableSetCount).toBe(5);
    expect(resolveProgressionModel(null, h.estimableSetCount!, h.inestimableSetCount!)).toBe(
      'rep_total'
    );
  });

  it('a normal-range exercise stays on the e1rm path', () => {
    const histories = buildExerciseHistories([
      sessionBlock('s1', '2026-07-24T10:00:00Z', [
        { weightKg: 100, reps: 10, rpe: 8.5 }, // eff 11.5 → high confidence
        { weightKg: 100, reps: 9, rpe: 9 }, // eff 10
        { weightKg: 100, reps: 8, rpe: 9.5 }, // eff 8.5
      ]),
    ]);
    const h = histories['lat-raise'];
    expect(h.estimableSetCount).toBe(3);
    expect(h.inestimableSetCount).toBe(0);
    expect(resolveProgressionModel(null, h.estimableSetCount!, h.inestimableSetCount!)).toBe(
      'e1rm'
    );
  });

  it('above-cap sets STILL feed the anchor pool as floors (display continuity)', () => {
    const histories = buildExerciseHistories([
      sessionBlock('s1', '2026-07-24T10:00:00Z', [{ weightKg: 10, reps: 13, rpe: 8 }]),
    ]);
    // Classification says rep_total, but the stored anchor keeps the floor
    // value rather than vanishing (e1rm-path exercises with occasional
    // above-cap sets rely on this).
    expect(histories['lat-raise'].estimatedE1RM).toBeCloseTo(14.4, 1);
  });
});
