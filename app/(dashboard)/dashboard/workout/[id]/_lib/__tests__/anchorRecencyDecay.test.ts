import { buildExerciseHistories, type HistoryBlockRow } from '../suggestions';

/**
 * Stale-peak integration (Phase 2 aggregation): buildExerciseHistories'
 * estimatedE1RM is the best qualifying set among the newest sessions, where
 * a session only qualifies within ANCHOR_MAX_AGE_DAYS of the NEWEST session.
 * A 10-month-old pre-weight-cut PR therefore cannot drive today's
 * prescription — while the personal record display stays the true window
 * best. Unlike the old exp(-age/45d) decay, the anchor never moves with the
 * calendar: only training a session can change it.
 */

const BENCH = 'bench';

function sessionBlock(
  sessionId: string,
  completedAt: string,
  sets: Array<{ weightKg: number; reps: number; rpe: number }>
): HistoryBlockRow {
  return {
    id: `${sessionId}-${BENCH}`,
    exercise_id: BENCH,
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

describe('e1RM anchor staleness guard (Phase 2 aggregation)', () => {
  it('a 10-month-old peak does not anchor over a recent cluster 15% lower', () => {
    // Pre-cut peak in Sep 2025: 110 × 10 @ RPE 8 → Brzycki e1RM ≈ 158.4.
    // Recent cluster (July 2026): ~95 kg work, e1RM ≈ 134-137 — the user lost
    // significant bodyweight since the peak.
    const blocks: HistoryBlockRow[] = [
      sessionBlock('recent-2', '2026-07-15T10:00:00Z', [
        { weightKg: 95, reps: 10, rpe: 8 },
        { weightKg: 95, reps: 9, rpe: 8.5 },
      ]),
      sessionBlock('recent-1', '2026-07-11T10:00:00Z', [
        { weightKg: 95, reps: 9, rpe: 8 },
      ]),
      sessionBlock('stale-peak', '2025-09-15T10:00:00Z', [
        { weightKg: 110, reps: 10, rpe: 8 },
      ]),
    ];

    const history = buildExerciseHistories(blocks)[BENCH];

    // The 10-month-old peak (≈158.4) is outside the 90-day window relative
    // to the newest session and is excluded; the anchor tracks the recent
    // cluster (best recent set: 95 × 10 @ 8 → ≈136.8).
    expect(history.estimatedE1RM).toBeCloseTo(136.8, 1);
    // The PR display stays the true all-time best.
    expect(history.personalRecord?.weightKg).toBe(110);
    expect(history.personalRecord?.e1rm).toBeCloseTo(158.4, 1);
  });

  it('an actively-trained exercise whose best is recent keeps its exact anchor', () => {
    const blocks: HistoryBlockRow[] = [
      sessionBlock('s2', '2026-07-16T10:00:00Z', [{ weightKg: 100, reps: 10, rpe: 8 }]),
      sessionBlock('s1', '2026-07-12T10:00:00Z', [{ weightKg: 97.5, reps: 10, rpe: 8 }]),
    ];
    const history = buildExerciseHistories(blocks)[BENCH];
    // Best qualifying set is in the newest session — anchored at face value:
    // 100 × 36/25.
    expect(history.estimatedE1RM).toBeCloseTo(144, 5);
  });
});
