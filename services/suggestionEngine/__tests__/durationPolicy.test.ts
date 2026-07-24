import {
  recommendSet,
  recommendSessionStart,
  recommendSeedForSlot,
} from '../../setRecommender';
import { DURATION_PROGRESSION_STEP_S } from '../constants';

const RANGE: [number, number] = [30, 60];

describe('duration policy — within-session (recommendSet)', () => {
  it('routes duration exercises away from the e1RM curve and holds the load', () => {
    const rec = recommendSet({
      lastWeightKg: 40,
      lastReps: 45, // seconds
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      exerciseType: 'duration_based',
      isBodyweight: false,
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(40);
    // Fatigue haircut applies in time space, near the last hold — never an
    // Epley-derived rep count.
    expect(rec.reps).toBeGreaterThanOrEqual(30);
    expect(rec.reps).toBeLessThanOrEqual(45);
  });

  it('does NOT clamp an honest over-range hold back to the range top (bodyweight)', () => {
    const rec = recommendSet({
      lastWeightKg: 80, // effective bodyweight load
      lastReps: 90, // 90s plank against a 30–60 range
      lastRir: 2,
      setsCompletedThisExercise: 1,
      targetRepRange: RANGE,
      targetRir: 2,
      exerciseType: 'duration_based',
      isBodyweight: true,
    });
    // The old zero-load guard clamped 90 → 60; honest seconds keep the real
    // (fatigue-adjusted) time visible above the range top.
    expect(rec.reps).toBeGreaterThan(60);
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(80);
  });

  it('bumps the load one increment when a LOADED hold runs far past the range', () => {
    const rec = recommendSet({
      lastWeightKg: 40,
      lastReps: 75, // way past 60s + overshoot
      lastRir: 3,
      setsCompletedThisExercise: 0,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      exerciseType: 'duration_based',
      isBodyweight: false,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBe(42.5);
    expect(rec.reps).toBe(30); // time target resets to the range floor
  });

  it('never changes the load for a bodyweight hold, even at the ceiling', () => {
    const rec = recommendSet({
      lastWeightKg: 80,
      lastReps: 75,
      lastRir: 4,
      setsCompletedThisExercise: 0,
      targetRepRange: RANGE,
      targetRir: 2,
      exerciseType: 'duration_based',
      isBodyweight: true,
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(80);
  });

  it('steps a LOADED hold down when it failed before the range floor', () => {
    const rec = recommendSet({
      lastWeightKg: 40,
      lastReps: 20, // failed at 20s against a 30s floor
      lastRir: 0,
      setsCompletedThisExercise: 0,
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      exerciseType: 'duration_based',
      isBodyweight: false,
    });
    expect(rec.rationale).toBe('reduce_load');
    expect(rec.weightKg).toBe(37.5);
  });
});

describe('duration policy — session start (recommendSessionStart)', () => {
  const base = {
    targetRepRange: RANGE,
    targetRir: 2,
    minIncrementKg: 2.5,
    exerciseType: 'duration_based' as const,
  };

  it('time-then-load: reaching the ceiling on a LOADED exercise earns one increment and reseeds the floor', () => {
    const rec = recommendSessionStart({
      ...base,
      prevWeightKg: 40,
      prevReps: 60,
      prevRir: 2,
      isBodyweight: false,
    });
    expect(rec.rationale).toBe('increase_load');
    expect(rec.weightKg).toBe(42.5);
    expect(rec.reps).toBe(30);
  });

  it('bodyweight hold at the ceiling is a STABLE state — no load nag, re-prescribes the ceiling', () => {
    const rec = recommendSessionStart({
      ...base,
      prevWeightKg: 80,
      prevReps: 60,
      prevRir: 2,
      isBodyweight: true,
    });
    // The no-nag guarantee: rationale stays 'maintain' (never a repeated
    // increase_load suggestion) and the target holds at the range top.
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(80);
    expect(rec.reps).toBe(60);
  });

  it('a not-met session asks for +5s at the same load, capped at the range top', () => {
    const rec = recommendSessionStart({
      ...base,
      prevWeightKg: 40,
      prevReps: 44,
      prevRir: 1,
      isBodyweight: false,
    });
    expect(rec.rationale).toBe('maintain');
    expect(rec.weightKg).toBe(40);
    expect(rec.reps).toBe(44 + DURATION_PROGRESSION_STEP_S);
  });
});

describe('duration policy — session-start seed (recommendSeedForSlot)', () => {
  it('anchors to last session and never to an e1RM, even when one is supplied', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      anchorE1RMKg: 120, // must be ignored — fabricated for a timed exercise
      prevWeightKg: 40,
      prevReps: 45,
      prevRir: 2,
      exerciseType: 'duration_based',
      isBodyweight: false,
    });
    expect(seed.anchorSource).toBe('last_session');
    expect(seed.weightKg).toBe(40);
    expect(seed.repRange).toEqual(RANGE);
  });

  it('carries the policy seconds target on the seed (not the range midpoint)', () => {
    // Not-met previous session (44s vs a 60s ceiling) → the seed must ask for
    // 44+5s, and the card must receive that via seedReps instead of falling
    // back to the mid of the range (45).
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      minIncrementKg: 2.5,
      prevWeightKg: 40,
      prevReps: 44,
      prevRir: 1,
      exerciseType: 'duration_based',
      isBodyweight: false,
    });
    expect(seed.seedReps).toBe(44 + DURATION_PROGRESSION_STEP_S);
  });

  it('falls back to the previous session set list when the slot has no direct prev set', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: RANGE,
      targetRir: 2,
      exerciseType: 'duration_based',
      isBodyweight: false,
      prevSessionSets: [
        { weightKg: 35, reps: 50, rir: 2 },
        { weightKg: 40, reps: 40, rir: 1 },
      ],
    });
    expect(seed.anchorSource).toBe('last_session');
    expect(seed.weightKg).toBe(40); // heaviest load wins as the reference
  });

  it('cold start on a LOADED duration exercise skips LOUDLY: no fabricated weight + console.warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const seed = recommendSeedForSlot({
        role: 'working',
        targetRepRange: RANGE,
        targetRir: 2,
        anchorE1RMKg: 120,
        exerciseType: 'duration_based',
        isBodyweight: false,
      });
      expect(seed.anchorSource).toBe('none');
      expect(seed.weightKg).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('duration exercise with no history'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('cold start on a BODYWEIGHT hold is a normal quiet empty seed (no load needed)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const seed = recommendSeedForSlot({
        role: 'working',
        targetRepRange: RANGE,
        targetRir: 2,
        exerciseType: 'duration_based',
        isBodyweight: true,
      });
      expect(seed.anchorSource).toBe('none');
      expect(seed.weightKg).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
