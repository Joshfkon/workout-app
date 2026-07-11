import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoverySession,
} from '@/services/muscleRecovery';

// A fixed clock injected into every call — no ambient Date reads anywhere.
const NOW = new Date('2026-07-11T12:00:00.000Z');

/** Build a Date `hours` before NOW. */
function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

/** Convenience: a single-exercise session. */
function session(
  performedAt: Date,
  primaryMuscle: string,
  setCount: number,
  repsInTank: number | null,
  secondaryMuscles: string[] = []
): RecoverySession {
  return {
    performedAt,
    exercises: [
      {
        primaryMuscle,
        secondaryMuscles,
        sets: Array.from({ length: setCount }, () => ({ repsInTank })),
      },
    ],
  };
}

describe('computeMuscleRecovery', () => {
  it('trained 24h ago with 10 hard sets → Fatigued', () => {
    const history = [session(hoursAgo(24), 'chest_upper', 10, 0)];
    const result = computeMuscleRecovery(history, 'chest_upper', NOW);

    expect(result.status).toBe('fatigued');
    expect(result.hoursSinceLast).toBeCloseTo(24, 5);
    // High dose (10 ≥ 8) → 48 + 24 = 72h window.
    expect(result.windowHours).toBe(72);
    expect(result.hoursUntilReady).toBeCloseTo(48, 5);
    expect(result.estimatedReadyAt).toEqual(
      new Date(hoursAgo(24).getTime() + 72 * 60 * 60 * 1000)
    );
  });

  it('trained 80h ago, light session → Fresh', () => {
    // 3 sets, nothing below 2 RIR → low dose → 48 - 12 = 36h window.
    const history = [session(hoursAgo(80), 'biceps', 3, 3)];
    const result = computeMuscleRecovery(history, 'biceps', NOW);

    expect(result.status).toBe('fresh');
    expect(result.windowHours).toBe(36);
    expect(result.hoursUntilReady).toBe(0);
    expect(result.hoursSinceLast).toBeCloseTo(80, 5);
  });

  it('secondary-only involvement 24h ago (glutes via RDL) → half dose → Recovering not Fatigued', () => {
    // RDL: primary hamstrings, secondary glutes. 3 non-hard sets.
    // Glutes see half dose (1.5) → light → 36h window. 24h ≥ 0.6×36 (21.6) and
    // < 36 → Recovering.
    const history = [session(hoursAgo(24), 'hamstrings', 3, 2, ['glutes'])];
    const result = computeMuscleRecovery(history, 'glutes', NOW);

    expect(result.status).toBe('recovering');
    expect(result.dose).toBeCloseTo(1.5, 5);
    expect(result.windowHours).toBe(36);

    // The secondary muscle carries exactly half the primary's dose.
    const hams = computeMuscleRecovery(history, 'hamstrings', NOW);
    expect(hams.dose).toBeCloseTo(3, 5);
    expect(result.dose).toBeCloseTo(hams.dose / 2, 5);
  });

  it('sets logged in the current session move the muscle to Fatigued immediately', () => {
    // The live session is timestamped at `now`.
    const history = [session(NOW, 'glutes', 4, 2)];
    const result = computeMuscleRecovery(history, 'glutes', NOW);

    expect(result.status).toBe('fatigued');
    expect(result.hoursSinceLast).toBeCloseTo(0, 5);
    expect(result.hoursUntilReady).toBeGreaterThan(0);
  });

  it('a muscle never trained in the supplied history is Fresh with null timing', () => {
    const history = [session(hoursAgo(10), 'chest_upper', 5, 2)];
    const result = computeMuscleRecovery(history, 'calves', NOW);

    expect(result.status).toBe('fresh');
    expect(result.hoursSinceLast).toBeNull();
    expect(result.estimatedReadyAt).toBeNull();
    expect(result.lastTrainedAt).toBeNull();
    expect(result.dose).toBe(0);
  });

  it('uses the MOST RECENT session that involved the muscle', () => {
    const history = [
      session(hoursAgo(90), 'quads', 10, 0), // old, heavy
      session(hoursAgo(20), 'quads', 2, 3), // recent, light
    ];
    const result = computeMuscleRecovery(history, 'quads', NOW);

    // Should key off the recent light session: 2 sets, no hard → 36h window.
    expect(result.windowHours).toBe(36);
    expect(result.hoursSinceLast).toBeCloseTo(20, 5);
    expect(result.lastTrainedAt).toEqual(hoursAgo(20));
  });

  it('counts ≥2 hard sets (0–1 RIR) as high dose even below the set-count threshold', () => {
    // Only 4 sets (below the 8-set high-dose threshold) but all maxed → high dose.
    const history = [session(hoursAgo(30), 'lateral_delts', 4, 0)];
    const result = computeMuscleRecovery(history, 'lateral_delts', NOW);

    expect(result.windowHours).toBe(RECOVERY_CONFIG.defaultWindowHours + RECOVERY_CONFIG.highDoseExtraHours);
    expect(result.status).toBe('fatigued'); // 30 < 0.6×72 (43.2)
  });

  it('unrated sets are not treated as hard and do not block the light-session discount', () => {
    const history = [session(hoursAgo(40), 'triceps', 3, null)];
    const result = computeMuscleRecovery(history, 'triceps', NOW);

    // 3 sets, no rated-hard sets → light → 36h window; 40 ≥ 36 → Fresh.
    expect(result.windowHours).toBe(36);
    expect(result.status).toBe('fresh');
  });

  it('accumulates dose across multiple exercises in the same session', () => {
    const multi: RecoverySession = {
      performedAt: hoursAgo(24),
      exercises: [
        { primaryMuscle: 'quads', secondaryMuscles: [], sets: [{ repsInTank: 2 }, { repsInTank: 2 }, { repsInTank: 2 }, { repsInTank: 2 }] },
        { primaryMuscle: 'quads', secondaryMuscles: [], sets: [{ repsInTank: 2 }, { repsInTank: 2 }, { repsInTank: 2 }, { repsInTank: 2 }] },
      ],
    };
    const result = computeMuscleRecovery([multi], 'quads', NOW);

    // 8 total sets → high dose → 72h window.
    expect(result.dose).toBeCloseTo(8, 5);
    expect(result.windowHours).toBe(72);
  });

  it('respects a per-muscle window override from config', () => {
    const config = {
      ...RECOVERY_CONFIG,
      windowHoursByMuscle: { quads: 72 as number },
    };
    const history = [session(hoursAgo(50), 'quads', 5, 2)];
    const result = computeMuscleRecovery(history, 'quads', NOW, config);

    // Override base 72, moderate dose (no adjustment) → 72h; 50 < 72 → not Fresh.
    expect(result.windowHours).toBe(72);
    expect(result.status).toBe('recovering'); // 50 ≥ 0.6×72 (43.2)
  });
});
