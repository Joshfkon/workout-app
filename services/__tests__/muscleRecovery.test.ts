import {
  computeMuscleRecovery,
  computeSleepWindowMultiplier,
  recoveryConfigFor,
  adjustRecoveryMultiplier,
  clampRecoveryMultiplier,
  RECOVERY_CONFIG,
  RECOVERY_MULTIPLIER_BOUNDS,
  RECOVERY_MULTIPLIER_STEP,
  type RecoverySession,
  type RecoveryStatus,
  type SleepNight,
  type SorenessReport,
} from '@/services/muscleRecovery';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';

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
    // 3 sets, nothing below 2 RIR → low dose → biceps base 36 - 12 = 24h window.
    const history = [session(hoursAgo(80), 'biceps', 3, 3)];
    const result = computeMuscleRecovery(history, 'biceps', NOW);

    expect(result.status).toBe('fresh');
    expect(result.windowHours).toBe(24);
    expect(result.hoursUntilReady).toBe(0);
    expect(result.hoursSinceLast).toBeCloseTo(80, 5);
  });

  it('secondary-only involvement 30h ago (glutes via RDL) → half dose → Recovering not Fatigued', () => {
    // RDL: primary hamstrings, secondary glutes. 3 non-hard sets.
    // Glutes see half dose (1.5) → light → 60 - 12 = 48h window. 30h ≥ 0.6×48
    // (28.8) and < 48 → Recovering.
    const history = [session(hoursAgo(30), 'hamstrings', 3, 2, ['glutes'])];
    const result = computeMuscleRecovery(history, 'glutes', NOW);

    expect(result.status).toBe('recovering');
    expect(result.dose).toBeCloseTo(1.5, 5);
    expect(result.windowHours).toBe(48);

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

    // Should key off the recent light session: 2 sets, no hard → quads base
    // 60 - 12 = 48h window.
    expect(result.windowHours).toBe(48);
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

    // 3 sets, no rated-hard sets → light → triceps base 36 - 12 = 24h window;
    // 40 ≥ 24 → Fresh.
    expect(result.windowHours).toBe(24);
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

    // 8 total sets → high dose → quads base 60 + 24 = 84h window.
    expect(result.dose).toBeCloseTo(8, 5);
    expect(result.windowHours).toBe(84);
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

  it('large muscle groups get a longer default window than small ones', () => {
    // Identical moderate sessions (5 sets, RIR 2, no dose adjustment): the
    // per-muscle table separates quads (60h) from biceps (36h) and leaves an
    // unlisted muscle (lateral_delts) on the 48h default.
    const at = hoursAgo(50);
    const quads = computeMuscleRecovery([session(at, 'quads', 5, 2)], 'quads', NOW);
    const biceps = computeMuscleRecovery([session(at, 'biceps', 5, 2)], 'biceps', NOW);
    const delts = computeMuscleRecovery(
      [session(at, 'lateral_delts', 5, 2)],
      'lateral_delts',
      NOW
    );

    expect(quads.windowHours).toBe(60);
    expect(biceps.windowHours).toBe(36);
    expect(delts.windowHours).toBe(RECOVERY_CONFIG.defaultWindowHours);

    // Same session age, different verdicts: 50h is inside the quads window but
    // past the biceps one.
    expect(quads.status).toBe('recovering');
    expect(biceps.status).toBe('fresh');
  });

  it('recoveryConfigFor(true) shrinks every window by the shared enhanced multiplier', () => {
    const enhanced = recoveryConfigFor(true);
    const history = [session(hoursAgo(52), 'quads', 5, 2)]; // moderate → base 60h

    const natural = computeMuscleRecovery(history, 'quads', NOW);
    const scaled = computeMuscleRecovery(history, 'quads', NOW, enhanced);

    // 60 / 1.225 ≈ 48.98h — the enhanced athlete is Fresh at 52h while the
    // natural athlete is still Recovering.
    expect(scaled.windowHours).toBeCloseTo(60 / ENHANCED_RECOVERY_MULTIPLIER, 5);
    expect(natural.status).toBe('recovering');
    expect(scaled.status).toBe('fresh');
  });

  it('windowScale applies to dose adjustments too, not just the base window', () => {
    const enhanced = recoveryConfigFor(true);
    const history = [session(hoursAgo(10), 'chest_upper', 10, 0)]; // high dose → 48+24

    const result = computeMuscleRecovery(history, 'chest_upper', NOW, enhanced);
    expect(result.windowHours).toBeCloseTo(72 / ENHANCED_RECOVERY_MULTIPLIER, 5);
  });

  it('recoveryConfigFor(false) is the unscaled default config', () => {
    expect(recoveryConfigFor(false)).toBe(RECOVERY_CONFIG);
    expect(RECOVERY_CONFIG.windowScale).toBe(1);
  });
});

describe('per-muscle learned recovery multiplier', () => {
  it('scales that muscle\'s window (and only that muscle\'s)', () => {
    const config = recoveryConfigFor(false, { quads: 1.2 });
    const at = hoursAgo(50);

    const quads = computeMuscleRecovery([session(at, 'quads', 5, 2)], 'quads', NOW, config);
    const hams = computeMuscleRecovery(
      [session(at, 'hamstrings', 5, 2)],
      'hamstrings',
      NOW,
      config
    );

    expect(quads.windowHours).toBeCloseTo(60 * 1.2, 5); // 72h
    expect(hams.windowHours).toBe(60); // untouched
  });

  it('composes with the enhanced-athlete windowScale', () => {
    const config = recoveryConfigFor(true, { quads: 1.2 });
    const result = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW,
      config
    );
    expect(result.windowHours).toBeCloseTo((60 * 1.2) / ENHANCED_RECOVERY_MULTIPLIER, 5);
  });

  it('an out-of-range persisted multiplier is clamped before it can distort the window', () => {
    const config = recoveryConfigFor(false, { quads: 9 });
    const result = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW,
      config
    );
    expect(result.windowHours).toBeCloseTo(60 * RECOVERY_MULTIPLIER_BOUNDS.max, 5);
  });

  it('a "still sore" report can flip the same-hours verdict after learning', () => {
    // 66h after a moderate quads session: with multiplier 1 (60h window) the
    // model says Fresh; after the window learns +10% (66h window) it says
    // Recovering — the learning loop actually changes behavior.
    const history = [session(hoursAgo(66), 'quads', 5, 2)];
    const before = computeMuscleRecovery(history, 'quads', NOW);
    const after = computeMuscleRecovery(
      history,
      'quads',
      NOW,
      recoveryConfigFor(false, { quads: 1.15 })
    );
    expect(before.status).toBe('fresh');
    expect(after.status).toBe('recovering');
  });
});

describe('adjustRecoveryMultiplier', () => {
  it('"still sore" when the model said fresh/recovering moves +0.05', () => {
    expect(adjustRecoveryMultiplier(1.0, 'still_sore', 'fresh')).toBeCloseTo(1.05, 10);
    expect(adjustRecoveryMultiplier(1.0, 'still_sore', 'recovering')).toBeCloseTo(1.05, 10);
  });

  it('"wasn\'t sore" when the model said fatigued moves −0.05', () => {
    expect(adjustRecoveryMultiplier(1.0, 'none', 'fatigued')).toBeCloseTo(0.95, 10);
  });

  it('agreement and the ambiguous "recovered" answer leave it unchanged', () => {
    expect(adjustRecoveryMultiplier(1.0, 'still_sore', 'fatigued')).toBe(1.0); // agreement
    expect(adjustRecoveryMultiplier(1.0, 'none', 'fresh')).toBe(1.0); // agreement
    expect(adjustRecoveryMultiplier(1.0, 'recovered', 'fresh')).toBe(1.0);
    expect(adjustRecoveryMultiplier(1.0, 'recovered', 'fatigued')).toBe(1.0);
  });

  it('clamps at both bounds', () => {
    expect(adjustRecoveryMultiplier(RECOVERY_MULTIPLIER_BOUNDS.max, 'still_sore', 'fresh')).toBe(
      RECOVERY_MULTIPLIER_BOUNDS.max
    );
    expect(adjustRecoveryMultiplier(RECOVERY_MULTIPLIER_BOUNDS.min, 'none', 'fatigued')).toBe(
      RECOVERY_MULTIPLIER_BOUNDS.min
    );
  });

  it('sanitizes garbage input via clampRecoveryMultiplier', () => {
    // Non-finite values reset to the neutral 1; finite outliers clamp.
    expect(clampRecoveryMultiplier(Number.NaN)).toBe(1);
    expect(clampRecoveryMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampRecoveryMultiplier(9)).toBe(RECOVERY_MULTIPLIER_BOUNDS.max);
    expect(clampRecoveryMultiplier(-3)).toBe(RECOVERY_MULTIPLIER_BOUNDS.min);
  });

  it('stays within [0.7, 1.5] over ANY input sequence (property test)', () => {
    // Deterministic LCG so the sequence is reproducible without Math.random.
    let seed = 0x2f6e2b1;
    const nextRandom = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const reports: SorenessReport[] = ['none', 'recovered', 'still_sore'];
    const statuses: RecoveryStatus[] = ['fresh', 'recovering', 'fatigued'];

    for (let run = 0; run < 50; run++) {
      // Occasionally start from a corrupt persisted value on purpose.
      let multiplier =
        run % 10 === 0 ? (nextRandom() - 0.5) * 10 : 0.5 + nextRandom() * 1.5;
      for (let step = 0; step < 500; step++) {
        const report = reports[Math.floor(nextRandom() * reports.length)];
        const status = statuses[Math.floor(nextRandom() * statuses.length)];
        multiplier = adjustRecoveryMultiplier(multiplier, report, status);
        expect(multiplier).toBeGreaterThanOrEqual(RECOVERY_MULTIPLIER_BOUNDS.min);
        expect(multiplier).toBeLessThanOrEqual(RECOVERY_MULTIPLIER_BOUNDS.max);
      }
    }
  });

  it('moves in RECOVERY_MULTIPLIER_STEP increments', () => {
    const upped = adjustRecoveryMultiplier(1.0, 'still_sore', 'fresh');
    expect(upped - 1.0).toBeCloseTo(RECOVERY_MULTIPLIER_STEP, 10);
  });
});

// ============================================
// SLEEP → RECOVERY WINDOW WIRING
// ============================================

/** YYYY-MM-DD local-day string for NOW minus `days` (mirrors the module's own helper). */
function localDayAgo(days: number): string {
  const d = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

describe('computeSleepWindowMultiplier', () => {
  it('trailing-2-night average under 6h stretches windows by the short multiplier', () => {
    const nights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 5.5, quality: 'poor' },
      { localDay: localDayAgo(1), hours: 6.0, quality: 'ok' },
    ];
    expect(computeSleepWindowMultiplier(nights, NOW)).toBe(
      RECOVERY_CONFIG.sleepShortWindowMultiplier
    );
  });

  it('≥8h average with GOOD quality on every night shrinks windows', () => {
    const nights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 8, quality: 'good' },
      { localDay: localDayAgo(1), hours: 8.5, quality: 'good' },
    ];
    expect(computeSleepWindowMultiplier(nights, NOW)).toBe(
      RECOVERY_CONFIG.sleepGoodWindowMultiplier
    );
  });

  it('≥8h average without good quality is neutral', () => {
    const nights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 9, quality: 'ok' },
      { localDay: localDayAgo(1), hours: 8.5, quality: 'good' },
    ];
    expect(computeSleepWindowMultiplier(nights, NOW)).toBe(1);
  });

  it('a normal night is neutral', () => {
    const nights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 7, quality: 'ok' },
      { localDay: localDayAgo(1), hours: 7.5, quality: 'good' },
    ];
    expect(computeSleepWindowMultiplier(nights, NOW)).toBe(1);
  });

  it('no recent nights (or none at all) is neutral — a stale entry never counts as last night', () => {
    expect(computeSleepWindowMultiplier([], NOW)).toBe(1);
    const stale: SleepNight[] = [
      { localDay: localDayAgo(20), hours: 4, quality: 'poor' },
      { localDay: localDayAgo(21), hours: 4, quality: 'poor' },
    ];
    expect(computeSleepWindowMultiplier(stale, NOW)).toBe(1);
  });

  it('only the two most recent nights inside the lookback drive the average', () => {
    // Recent nights are fine; an awful night 2 days back is outside the pair.
    const nights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 7.5, quality: 'ok' },
      { localDay: localDayAgo(1), hours: 7.5, quality: 'ok' },
      { localDay: localDayAgo(2), hours: 3, quality: 'poor' },
    ];
    expect(computeSleepWindowMultiplier(nights, NOW)).toBe(1);
  });
});

describe('sleep multiplier applied to recovery windows', () => {
  it('short sleep (<6h trailing avg) extends a muscle ready-time by 15%', () => {
    // High-dose chest session 24h ago → base window 48 + 24 = 72h.
    const history = [session(hoursAgo(24), 'chest_upper', 10, 0)];

    const shortNights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 5, quality: 'poor' },
      { localDay: localDayAgo(1), hours: 5.5, quality: 'ok' },
    ];
    const config = recoveryConfigFor(
      false,
      undefined,
      computeSleepWindowMultiplier(shortNights, NOW)
    );

    const baseline = computeMuscleRecovery(history, 'chest_upper', NOW);
    const shortSleep = computeMuscleRecovery(history, 'chest_upper', NOW, config);

    expect(baseline.windowHours).toBe(72);
    expect(shortSleep.windowHours).toBeCloseTo(72 * 1.15, 5);
    // Ready-time (time-until-fresh from the last session) extends by exactly 15%.
    expect(shortSleep.estimatedReadyAt!.getTime() - shortSleep.lastTrainedAt!.getTime()).toBeCloseTo(
      (baseline.estimatedReadyAt!.getTime() - baseline.lastTrainedAt!.getTime()) * 1.15,
      -3
    );
  });

  it('long good-quality sleep shrinks the window by 5%', () => {
    const history = [session(hoursAgo(24), 'chest_upper', 10, 0)];
    const goodNights: SleepNight[] = [
      { localDay: localDayAgo(0), hours: 8.5, quality: 'good' },
      { localDay: localDayAgo(1), hours: 8, quality: 'good' },
    ];
    const config = recoveryConfigFor(
      false,
      undefined,
      computeSleepWindowMultiplier(goodNights, NOW)
    );
    const result = computeMuscleRecovery(history, 'chest_upper', NOW, config);
    expect(result.windowHours).toBeCloseTo(72 * 0.95, 5);
  });

  it('composes with the enhanced-athlete windowScale and learned multipliers', () => {
    const history = [session(hoursAgo(24), 'chest_upper', 10, 0)];
    const config = recoveryConfigFor(true, { chest_upper: 1.2 }, 1.15);
    const result = computeMuscleRecovery(history, 'chest_upper', NOW, config);
    expect(result.windowHours).toBeCloseTo(
      (72 / ENHANCED_RECOVERY_MULTIPLIER) * 1.2 * 1.15,
      5
    );
  });
});
