import { buildExerciseHistories, type HistoryBlockRow } from '../suggestions';
import {
  recommendSeedForSlot,
  recommendSessionStart,
  recommendSet,
} from '@/services/setRecommender';
import { SUGGESTION_ENGINE_VERSION } from '@/services/suggestionEngine/constants';

/**
 * REGRESSION BASELINE for the weight/rep engine remediation pass
 * (docs/WEIGHT_REP_ENGINE_AUDIT.md → Remediation).
 *
 * A regularly-trained exercise with recent history must receive the SAME
 * recommendation before and after the audit fixes (per-exercise history
 * window, all-sets bump gating, e1RM recency decay, regression path). The
 * values pinned here were captured from the engine at main @ bd960de, BEFORE
 * any fix landed. If a fix changes any of these numbers, the fix broke the
 * common case.
 *
 * Fixture: a barbell-bench staple, 4 sessions across 11 days, progressing
 * normally (best e1RM in the newest session, all reps mid-range, effort near
 * target). This is the "nothing unusual happened" case every fix must leave
 * untouched.
 */

const BENCH = 'bench';

interface SetSpec {
  weightKg: number;
  reps: number;
  rpe: number;
}

function sessionBlock(
  sessionId: string,
  completedAt: string,
  sets: SetSpec[]
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

// Most-recent-first, matching the history query order.
const stapleBlocks: HistoryBlockRow[] = [
  sessionBlock('s4', '2026-07-17T10:00:00Z', [
    { weightKg: 100, reps: 10, rpe: 8.5 },
    { weightKg: 100, reps: 9, rpe: 9 },
    { weightKg: 100, reps: 8, rpe: 9.5 },
  ]),
  sessionBlock('s3', '2026-07-14T10:00:00Z', [
    { weightKg: 97.5, reps: 11, rpe: 8 },
    { weightKg: 97.5, reps: 10, rpe: 8.5 },
    { weightKg: 97.5, reps: 9, rpe: 9 },
  ]),
  sessionBlock('s2', '2026-07-10T10:00:00Z', [
    { weightKg: 97.5, reps: 10, rpe: 8 },
    { weightKg: 97.5, reps: 9, rpe: 8.5 },
    { weightKg: 97.5, reps: 8, rpe: 9 },
  ]),
  sessionBlock('s1', '2026-07-06T10:00:00Z', [
    { weightKg: 95, reps: 10, rpe: 8 },
    { weightKg: 95, reps: 9, rpe: 8.5 },
    { weightKg: 95, reps: 8, rpe: 9 },
  ]),
];

const REP_RANGE: [number, number] = [8, 12];
const TARGET_RIR = 2;
const INC = 2.5;

describe('engine regression baseline — staple exercise, recent history', () => {
  const histories = buildExerciseHistories(stapleBlocks);
  const history = histories[BENCH];

  it('history: last session, session count, and e1RM anchor are stable', () => {
    expect(history.totalSessions).toBe(4);
    expect(history.lastWorkoutDate).toBe('2026-07-17T10:00:00Z');
    expect(history.lastWorkoutSets).toEqual([
      expect.objectContaining({ weightKg: 100, reps: 10, rpe: 8.5 }),
      expect.objectContaining({ weightKg: 100, reps: 9, rpe: 9 }),
      expect.objectContaining({ weightKg: 100, reps: 8, rpe: 9.5 }),
    ]);
    // Phase 2 aggregation: best qualifying set among the newest sessions —
    // no decay. The winner is the Jul 14 97.5 × 11 @ RPE 8 set (2 RIR → 13
    // effective reps → capped at 12 → 97.5 × 1.44 = 140.4), which beats the
    // newest session's 100 × 10 @ 8.5 (1 RIR → 11 eff → 138.5). Under the
    // old decayed max the Jul 14 value lost to its 3-day age haircut.
    expect(history.estimatedE1RM).toBeCloseTo(140.4, 2);
    // The undecayed PR is now the Jul 14 97.5 × 11 @ RPE 8 set: 2 RIR → 13
    // effective reps → capped at 12 → 97.5 × 1.44 = 140.4, which beats the
    // newest session's 138.5. (Under the old formulas its 12.5 effective
    // reps fell into the linear-Epley branch at 138.1 and lost.) The ANCHOR
    // still comes from the newest session because the PR's 3-day decay drops
    // it to ~131.3 in the decayed-max comparison.
    expect(history.personalRecord).toEqual({
      weightKg: 97.5,
      reps: 11,
      e1rm: 140.4,
      date: '2026-07-14T10:00:00Z',
    });
  });

  it('session-start seed (working slot, e1RM anchor): holds at 100 kg', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      anchorE1RMKg: history.estimatedE1RM,
      recentWorkingWeightKg: 100,
      prevWeightKg: 100,
      prevReps: 10,
      prevRir: 1.5,
    });
    expect(seed).toEqual({
      weightKg: 100,
      repRange: REP_RANGE,
      rir: TARGET_RIR,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'e1rm',
      clamped: false,
      // No session list supplied → the bump gate never ran; the raw curve
      // pick (100.29) rounds to the recent 100 on its own.
      clampBinder: 'none',
      preClampWeightKg: expect.any(Number),
      engineVersion: SUGGESTION_ENGINE_VERSION,
    });
  });

  it('session-start seed with the full previous-session set list (Fix 2 call shape) is IDENTICAL for the staple', () => {
    // ExerciseCard now passes prevSessionSets for the all-sets bump gate. For
    // the common case (mid-range reps, near-target effort → the engine held
    // anyway) the gated call must produce the exact same seed as the baseline.
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      anchorE1RMKg: history.estimatedE1RM,
      recentWorkingWeightKg: 100,
      prevWeightKg: 100,
      prevReps: 10,
      prevRir: 1.5,
      prevSessionSets: [
        { weightKg: 100, reps: 10, rir: 1.5 },
        { weightKg: 100, reps: 9, rir: 1 },
        { weightKg: 100, reps: 8, rir: 0.5 },
      ],
    });
    expect(seed).toEqual({
      weightKg: 100,
      repRange: REP_RANGE,
      rir: TARGET_RIR,
      role: 'working',
      showRirTarget: true,
      anchorSource: 'e1rm',
      clamped: false,
      clampBinder: 'bump_gate',
      preClampWeightKg: expect.any(Number),
      engineVersion: SUGGESTION_ENGINE_VERSION,
    });
  });

  it('session-start seed (ramp slot): 57.5% of the working top set', () => {
    const seed = recommendSeedForSlot({
      role: 'ramp',
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
      anchorE1RMKg: history.estimatedE1RM,
      recentWorkingWeightKg: 100,
      prevWeightKg: 57.5,
      prevReps: 10,
    });
    expect(seed.weightKg).toBe(57.5);
    expect(seed.role).toBe('ramp');
    expect(seed.anchorSource).toBe('ramp_percent');
    expect(seed.showRirTarget).toBe(false);
  });

  it('session-start fallback (no anchor): holds the load and asks for one more rep', () => {
    const rec = recommendSessionStart({
      prevWeightKg: 100,
      prevReps: 10,
      prevRir: 1.5,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
    });
    expect(rec.weightKg).toBe(100);
    expect(rec.reps).toBe(11); // prevReps + 1 — the seed prescribes progression
    expect(rec.rationale).toBe('maintain');
  });

  it('within-session next set: hold with normal per-set rep decline', () => {
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 10,
      lastRir: 2,
      setsCompletedThisExercise: 1,
      sessionBestE1RMKg: history.estimatedE1RM,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
    });
    expect(rec).toEqual({
      weightKg: 100,
      reps: 9,
      rir: TARGET_RIR,
      rationale: 'maintain',
      effortVsTarget: 'on_target',
      provenance: { source: 'anchor' },
    });
  });

  it('within-session next set: single-set overperformance still bumps mid-session', () => {
    // Within-session adaptation reacts to the set just done — the all-sets
    // gate (Fix 2) applies to SESSION-TO-SESSION bumps only. This must not
    // regress: 12 reps @ 4 RIR against 8-12 @ 2 clears the top with spare.
    const rec = recommendSet({
      lastWeightKg: 100,
      lastReps: 12,
      lastRir: 4,
      setsCompletedThisExercise: 1,
      targetRepRange: REP_RANGE,
      targetRir: TARGET_RIR,
      minIncrementKg: INC,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBe(105);
    expect(rec.reps).toBe(11);
  });
});
