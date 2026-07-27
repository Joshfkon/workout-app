import { computeLiftTrends, type LiftTrendSessionRow } from '../liftTrends';

/** Build a completed session with one exercise block and one working top set. */
function session(
  id: string,
  completedAt: string,
  exercise: { id: string; name: string },
  weightKg: number,
  reps: number
): LiftTrendSessionRow {
  return {
    id,
    completed_at: completedAt,
    exercise_blocks: [
      {
        exercises: exercise,
        set_logs: [
          { weight_kg: weightKg, reps, is_warmup: false },
          // Warmups must be ignored even when heavier-rep
          { weight_kg: weightKg / 2, reps: 12, is_warmup: true },
        ],
      },
    ],
  };
}

const bench = { id: 'ex-bench', name: 'Bench Press' };
const squat = { id: 'ex-squat', name: 'Squat' };

describe('computeLiftTrends', () => {
  it('classifies a steadily improving lift as rising', () => {
    const sessions = [
      session('s1', '2026-06-01T10:00:00Z', bench, 80, 8),
      session('s2', '2026-06-08T10:00:00Z', bench, 82.5, 8),
      session('s3', '2026-06-15T10:00:00Z', bench, 85, 8),
      session('s4', '2026-06-22T10:00:00Z', bench, 87.5, 8),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.lifts).toHaveLength(1);
    expect(summary.lifts[0]).toMatchObject({ name: 'Bench Press', direction: 'rising' });
    expect(summary.rising).toBe(1);
    expect(summary.stalled).toBeNull();
  });

  it('flags a flat lift on a bulk as stalled with weeks since progress', () => {
    const sessions = [
      session('s1', '2026-05-25T10:00:00Z', bench, 100, 5),
      session('s2', '2026-06-01T10:00:00Z', bench, 100, 5),
      session('s3', '2026-06-08T10:00:00Z', bench, 100, 5),
      session('s4', '2026-06-15T10:00:00Z', bench, 100, 5),
      session('s5', '2026-06-22T10:00:00Z', bench, 100, 5),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.flat).toBe(1);
    expect(summary.stalled).not.toBeNull();
    expect(summary.stalled!.name).toBe('Bench Press');
    expect(summary.stalled!.weeks).toBeGreaterThanOrEqual(1);
  });

  it('skips lifts with fewer than 3 sessions and orders rising before down', () => {
    const sessions = [
      // Squat declining across 4 sessions
      session('q1', '2026-06-01T10:00:00Z', squat, 140, 5),
      session('q2', '2026-06-08T10:00:00Z', squat, 135, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 130, 5),
      session('q4', '2026-06-22T10:00:00Z', squat, 125, 5),
      // Bench rising but only 2 sessions — not enough history
      session('b1', '2026-06-15T10:00:00Z', bench, 80, 8),
      session('b2', '2026-06-22T10:00:00Z', bench, 85, 8),
    ];

    const summary = computeLiftTrends(sessions, undefined, new Date('2026-06-23'));

    expect(summary.lifts.map((l) => l.exerciseId)).toEqual(['ex-squat']);
    expect(summary.down).toBe(1);
  });

  it('keeps the aggregate counts and the per-lift detail list in agreement', () => {
    const sessions = [
      // Bench rising over 4 sessions
      session('b1', '2026-06-01T10:00:00Z', bench, 80, 8),
      session('b2', '2026-06-08T10:00:00Z', bench, 82.5, 8),
      session('b3', '2026-06-15T10:00:00Z', bench, 85, 8),
      session('b4', '2026-06-22T10:00:00Z', bench, 87.5, 8),
      // Squat declining over 4 sessions
      session('q1', '2026-06-01T10:00:00Z', squat, 140, 5),
      session('q2', '2026-06-08T10:00:00Z', squat, 135, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 130, 5),
      session('q4', '2026-06-22T10:00:00Z', squat, 125, 5),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    // The tile headline (rising/flat/down/rebuilding) and the detail list are
    // derived from the same lifts array — they can never disagree.
    expect(summary.rising + summary.flat + summary.down + summary.rebuilding).toBe(
      summary.lifts.length
    );
    expect(summary.rising).toBe(summary.lifts.filter((l) => l.direction === 'rising' && !l.lowConfidence).length);
    expect(summary.down).toBe(summary.lifts.filter((l) => l.direction === 'down' && !l.lowConfidence).length);

    // Detail fields for the destination view
    for (const lift of summary.lifts) {
      expect(lift.history).toHaveLength(lift.sessionCount);
      expect(lift.currentE1RMKg).toBeCloseTo(lift.history[lift.history.length - 1].e1rmKg, 5);
      // History is oldest-first
      const dates = lift.history.map((h) => h.date);
      expect([...dates].sort()).toEqual(dates);
    }
    expect(summary.windowDays).toBe(84);
  });

  it('flags lifts spanning a program boundary as low-confidence instead of down', () => {
    const sessions = [
      // Declining across the old program...
      session('q1', '2026-06-01T10:00:00Z', squat, 140, 5),
      session('q2', '2026-06-08T10:00:00Z', squat, 135, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 130, 5),
      // ...then one session since the program switch on 2026-06-20
      session('q4', '2026-06-22T10:00:00Z', squat, 125, 5),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'), {
      programStartDate: '2026-06-20',
    });

    expect(summary.lifts).toHaveLength(1);
    expect(summary.lifts[0].lowConfidence).toBe(true);
    // Not counted as a confident "down" — surfaced as rebuilding instead.
    expect(summary.down).toBe(0);
    expect(summary.rebuilding).toBe(1);
    // Stall verdicts across the boundary are suppressed too.
    expect(summary.stalled).toBeNull();
  });

  it('keeps full confidence once enough sessions accrue after the boundary', () => {
    const sessions = [
      session('q1', '2026-05-20T10:00:00Z', squat, 140, 5),
      // 3 sessions since the switch on 2026-05-25 — enough to trust again
      session('q2', '2026-06-08T10:00:00Z', squat, 135, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 130, 5),
      session('q4', '2026-06-22T10:00:00Z', squat, 125, 5),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'), {
      programStartDate: '2026-05-25',
    });

    expect(summary.lifts[0].lowConfidence).toBe(false);
    expect(summary.down).toBe(1);
    expect(summary.rebuilding).toBe(0);
  });

  it('counts lifts without enough sessions as insufficientData', () => {
    const sessions = [
      session('q1', '2026-06-01T10:00:00Z', squat, 140, 5),
      session('q2', '2026-06-08T10:00:00Z', squat, 140, 5),
      session('q3', '2026-06-15T10:00:00Z', squat, 140, 5),
      // Bench only has 2 sessions — trained but not classifiable yet
      session('b1', '2026-06-15T10:00:00Z', bench, 80, 8),
      session('b2', '2026-06-22T10:00:00Z', bench, 85, 8),
    ];

    const summary = computeLiftTrends(sessions, undefined, new Date('2026-06-23'));

    expect(summary.lifts.map((l) => l.exerciseId)).toEqual(['ex-squat']);
    expect(summary.insufficientData).toBe(1);
  });

  it('ignores bodyweight/zero-load sets instead of zeroing the trend', () => {
    const sessions = [
      session('s1', '2026-06-01T10:00:00Z', bench, 80, 8),
      session('s2', '2026-06-08T10:00:00Z', bench, 82.5, 8),
      {
        id: 's3',
        completed_at: '2026-06-15T10:00:00Z',
        exercise_blocks: [
          { exercises: bench, set_logs: [{ weight_kg: 0, reps: 15, is_warmup: false }] },
        ],
      },
      session('s4', '2026-06-22T10:00:00Z', bench, 85, 8),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-06-23'));

    expect(summary.lifts).toHaveLength(1);
    expect(summary.lifts[0].direction).toBe('rising');
  });
});

// ============================================
// TREND-ROBUSTNESS VERIFICATION FIXTURES
// (Cable Fly repro — see the trend-robustness task)
// ============================================

describe('equipment discontinuity + inestimable sessions', () => {
  const cableFly = { id: 'ex-cable-fly', name: 'Cable Fly' };

  it('Cable Fly repro: 20-rep old-machine session yields no e1RM point, level shift segments the trend', () => {
    const sessions = [
      // Old machine (different stack labeling): heavy-looking e1RM.
      session('s0', '2026-06-22T10:00:00Z', cableFly, 18, 12),
      session('s1', '2026-06-29T10:00:00Z', cableFly, 26, 8),
      // 20-rep day: outside the estimator's domain → NO snapshot, never a 0.
      session('s2', '2026-07-04T10:00:00Z', cableFly, 18, 20),
      // Correct machine from here on.
      session('s3', '2026-07-14T10:00:00Z', cableFly, 13.5, 12),
      session('s4', '2026-07-21T10:00:00Z', cableFly, 13.5, 13),
      session('s5', '2026-07-27T10:00:00Z', cableFly, 14.5, 13),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-07-27'));
    const lift = summary.lifts[0];

    // The Jul 4 session contributed no point (5 points, not 6).
    expect(lift.history).toHaveLength(5);
    expect(lift.history.every((h) => h.e1rmKg > 0)).toBe(true);
    // The old-machine level shift anchors the trend at Jul 14…
    expect(lift.discontinuityDate).toBe('2026-07-14');
    // …so the fitted slope reads the (mildly positive) new-machine segment,
    // not a −25%/wk collapse across the machine swap.
    expect(lift.weeklyChangePct).toBeGreaterThan(0);
    expect(lift.direction).toBe('rising');
  });

  it('marks a lift calibrating (equipment change) with fewer than 3 post-shift sessions', () => {
    const sessions = [
      session('s0', '2026-06-15T10:00:00Z', cableFly, 26, 8),
      session('s1', '2026-06-22T10:00:00Z', cableFly, 26, 8),
      session('s2', '2026-06-29T10:00:00Z', cableFly, 26.5, 8),
      session('s3', '2026-07-14T10:00:00Z', cableFly, 13.5, 12),
      session('s4', '2026-07-21T10:00:00Z', cableFly, 13.5, 13),
    ];

    const summary = computeLiftTrends(sessions, 'bulk', new Date('2026-07-21'));
    const lift = summary.lifts[0];

    expect(lift.lowConfidence).toBe(true);
    expect(lift.calibrationReason).toBe('equipment_change');
    // Calibrating lifts never feed the stalled banner.
    expect(summary.stalled).toBeNull();
  });

  it('honors the persisted equipment_changed marker as a hard boundary', () => {
    const marked: LiftTrendSessionRow[] = [
      session('s0', '2026-06-15T10:00:00Z', cableFly, 20, 8),
      session('s1', '2026-06-22T10:00:00Z', cableFly, 20.5, 8),
      session('s2', '2026-06-29T10:00:00Z', cableFly, 21, 8),
      session('s3', '2026-07-06T10:00:00Z', cableFly, 18, 8),
      session('s4', '2026-07-13T10:00:00Z', cableFly, 18.5, 8),
      session('s5', '2026-07-20T10:00:00Z', cableFly, 19, 8),
    ];
    // −15% at Jul 6: below the heuristic threshold, but the user marked it.
    marked[3].exercise_blocks![0].equipment_changed = true;

    const summary = computeLiftTrends(marked, 'bulk', new Date('2026-07-21'));
    const lift = summary.lifts[0];

    expect(lift.discontinuityDate).toBe('2026-07-06');
    // Slope fits the marked segment only (rising), not the cross-gym mix.
    expect(lift.weeklyChangePct).toBeGreaterThan(0);
  });
});

describe('marked boundary on an inestimable session', () => {
  const cableFly = { id: 'ex-cable-fly', name: 'Cable Fly' };

  it('keeps a marked boundary even when the marked session itself has no estimable set', () => {
    const marked: LiftTrendSessionRow[] = [
      session('s0', '2026-06-15T10:00:00Z', cableFly, 20, 8),
      session('s1', '2026-06-22T10:00:00Z', cableFly, 20.5, 8),
      session('s2', '2026-06-29T10:00:00Z', cableFly, 21, 8),
      // Marked equipment-change day logged as a 20-rep burnout: outside the
      // estimator's domain, so it contributes NO e1RM point — the boundary
      // must survive anyway.
      session('s3', '2026-07-03T10:00:00Z', cableFly, 10, 20),
      session('s4', '2026-07-06T10:00:00Z', cableFly, 18, 8),
      session('s5', '2026-07-13T10:00:00Z', cableFly, 18.5, 8),
      session('s6', '2026-07-20T10:00:00Z', cableFly, 19, 8),
    ];
    marked[3].exercise_blocks![0].equipment_changed = true;

    const summary = computeLiftTrends(marked, 'bulk', new Date('2026-07-21'));
    const lift = summary.lifts[0];

    // 6 e1RM points (the 20-rep day contributes none), segment anchored at
    // the first point at/after the marked date.
    expect(lift.history).toHaveLength(6);
    expect(lift.discontinuityDate).toBe('2026-07-06');
    expect(lift.weeklyChangePct).toBeGreaterThan(0);
  });
});
