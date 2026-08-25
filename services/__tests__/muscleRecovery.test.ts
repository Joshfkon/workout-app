import {
  computeDoseScale,
  computeMuscleRecovery,
  computeSleepWindowMultiplier,
  recoveryConfigFor,
  adjustRecoveryMultiplier,
  clampRecoveryMultiplier,
  MAX_DOSE_SCALE,
  RECOVERY_CONFIG,
  RECOVERY_MULTIPLIER_BOUNDS,
  RECOVERY_MULTIPLIER_STEP,
  type RecoverySession,
  type RecoveryStatus,
  type SleepNight,
  type SorenessReport,
} from '@/services/muscleRecovery';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';
import type { StandardMuscleGroup } from '@/types/schema';

/**
 * Expected window for a muscle after a session of `sets` sets of which
 * `hardSets` were at/below the hard-RIR threshold.
 *
 * These tests used to restate the retired step function's discrete outputs
 * (base, base-12, base+24). The dose response is now a CONTINUOUS MULTIPLIER,
 * so the expectation is DERIVED from the same model the code uses and each
 * test keeps asserting what it always meant: that the window composes as
 * base x doseScale x globalScale x learned. Behavioural claims (light < base <
 * heavy, quads > biceps, learning flips a verdict) are asserted directly.
 */
function expectedWindow(
  muscle: StandardMuscleGroup,
  sets: number,
  hardSets: number,
  config = RECOVERY_CONFIG,
  learned = 1
): number {
  const base = config.windowHoursByMuscle[muscle] ?? config.defaultWindowHours;
  const { doseScale } = computeDoseScale(muscle, sets, hardSets, config);
  return base * doseScale * config.windowScale * config.sleepWindowMultiplier * learned;
}

/** The window a saturated (scale-capped) session earns for a muscle. */
function saturatedWindow(muscle: StandardMuscleGroup): number {
  return (RECOVERY_CONFIG.windowHoursByMuscle[muscle] ?? RECOVERY_CONFIG.defaultWindowHours) *
    MAX_DOSE_SCALE;
}

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
    // 10 sets all at RIR 0 saturates the dose scale → 48 × 1.45 = 69.6h.
    expect(result.windowHours).toBeCloseTo(saturatedWindow('chest_upper'), 6);
    expect(result.breakdown!.dose.doseScaleClamp).toBe('upper');
    expect(result.hoursUntilReady).toBeCloseTo(saturatedWindow('chest_upper') - 24, 5);
    expect(result.estimatedReadyAt).toEqual(
      new Date(hoursAgo(24).getTime() + saturatedWindow('chest_upper') * 60 * 60 * 1000)
    );
  });

  it('trained 80h ago, light session → Fresh', () => {
    // 3 sets, nothing below 2 RIR → light dose → biceps base 36 shortened.
    const history = [session(hoursAgo(80), 'biceps', 3, 3)];
    const result = computeMuscleRecovery(history, 'biceps', NOW);

    expect(result.status).toBe('fresh');
    expect(result.windowHours).toBeCloseTo(expectedWindow('biceps', 3, 0), 6);
    // The claim that matters: a light session shortens the base window.
    expect(result.windowHours!).toBeLessThan(36);
    expect(result.hoursUntilReady).toBe(0);
    expect(result.hoursSinceLast).toBeCloseTo(80, 5);
  });

  it('secondary-only involvement carries HALF the primary dose, and a much shorter window', () => {
    // RDL: primary hamstrings, secondary glutes. 3 non-hard sets.
    const history = [session(hoursAgo(30), 'hamstrings', 3, 2, ['glutes'])];
    const result = computeMuscleRecovery(history, 'glutes', NOW);
    const hams = computeMuscleRecovery(history, 'hamstrings', NOW);

    // The secondary muscle carries exactly half the primary's dose.
    expect(result.dose).toBeCloseTo(1.5, 5);
    expect(hams.dose).toBeCloseTo(3, 5);
    expect(result.dose).toBeCloseTo(hams.dose / 2, 5);
    expect(result.windowHours).toBeCloseTo(expectedWindow('glutes', 1.5, 0), 6);

    // Half the dose now buys a MATERIALLY shorter window. Under the additive
    // model both sat within 12h of their base, so 30h left the secondary
    // muscle Recovering off 1.5 sets of incidental work; it is now done while
    // the primary (full dose, longer base) is not.
    expect(result.status).toBe('fresh');
    expect(hams.status).not.toBe('fresh');
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

  it('a settled older session stops governing once its own window has elapsed', () => {
    const history = [
      session(hoursAgo(90), 'quads', 10, 0), // old, heavy — window already run out
      session(hoursAgo(20), 'quads', 2, 3), // recent, light
    ];
    const result = computeMuscleRecovery(history, 'quads', NOW);

    // The heavy session's debt is settled (90h > its window), so the light one
    // governs — but by outliving it, not by being the most recent.
    expect(expectedWindow('quads', 10, 10)).toBeLessThan(90);
    expect(result.windowHours).toBeCloseTo(expectedWindow('quads', 2, 0), 6);
    expect(result.governingTrainedAt).toEqual(hoursAgo(20));
    expect(result.hoursSinceLast).toBeCloseTo(20, 5);
    expect(result.lastTrainedAt).toEqual(hoursAgo(20));
  });

  it('hard sets lengthen the window even when total set count is modest', () => {
    // 4 sets, all maxed out. Under the retired step function this tripped a
    // flat +24h at exactly 2 hard sets; now the hard-dose term contributes
    // continuously, but the direction is the same.
    const history = [session(hoursAgo(30), 'lateral_delts', 4, 0)];
    const result = computeMuscleRecovery(history, 'lateral_delts', NOW);

    expect(result.windowHours).toBeCloseTo(expectedWindow('lateral_delts', 4, 4), 6);
    // Same volume, none of it hard → strictly shorter.
    const easy = computeMuscleRecovery([session(hoursAgo(30), 'lateral_delts', 4, 3)], 'lateral_delts', NOW);
    expect(result.windowHours!).toBeGreaterThan(easy.windowHours!);
    // Sharper than a bare status check: at the SAME elapsed hours, taking the
    // same volume to failure leaves the muscle strictly less recovered.
    expect(result.readinessRatio).toBeLessThan(easy.readinessRatio);
    expect(result.status).toBe('recovering');
  });

  it('unrated sets are not treated as hard and do not block the light-session discount', () => {
    const history = [session(hoursAgo(40), 'triceps', 3, null)];
    const result = computeMuscleRecovery(history, 'triceps', NOW);

    // 3 sets, no rated-hard sets → treated as light, same as RIR-3 sets.
    expect(result.windowHours).toBeCloseTo(expectedWindow('triceps', 3, 0), 6);
    const rated = computeMuscleRecovery([session(hoursAgo(40), 'triceps', 3, 3)], 'triceps', NOW);
    expect(result.windowHours).toBeCloseTo(rated.windowHours!, 6);
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

    // 8 total sets accumulated across two exercises → one 8-set dose.
    expect(result.dose).toBeCloseTo(8, 5);
    expect(result.windowHours).toBeCloseTo(expectedWindow('quads', 8, 0), 6);
    // Accumulation is the point: 8 sets must outweigh 4.
    const half = computeMuscleRecovery([session(hoursAgo(24), 'quads', 4, 2)], 'quads', NOW);
    expect(result.windowHours!).toBeGreaterThan(half.windowHours!);
  });

  it('respects a per-muscle window override from config', () => {
    const config = {
      ...RECOVERY_CONFIG,
      windowHoursByMuscle: { quads: 72 as number },
    };
    const history = [session(hoursAgo(50), 'quads', 5, 2)];
    const result = computeMuscleRecovery(history, 'quads', NOW, config);

    // The override replaces the BASE; the dose adjustment still applies on top.
    expect(result.windowHours).toBeCloseTo(expectedWindow('quads', 5, 0, config), 6);
    expect(result.windowHours!).toBeGreaterThan(
      expectedWindow('quads', 5, 0, RECOVERY_CONFIG)
    );
    expect(result.status).toBe('recovering');
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

    expect(quads.windowHours).toBeCloseTo(expectedWindow('quads', 5, 0), 6);
    expect(biceps.windowHours).toBeCloseTo(expectedWindow('biceps', 5, 0), 6);
    expect(delts.windowHours).toBeCloseTo(expectedWindow('lateral_delts', 5, 0), 6);
    // The ordering the per-muscle table exists to produce.
    expect(quads.windowHours!).toBeGreaterThan(delts.windowHours!);
    expect(delts.windowHours!).toBeGreaterThan(biceps.windowHours!);

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

    // The enhanced athlete's whole window (base AND dose) divides by the
    // shared multiplier, so they are Fresh at 52h while the natural athlete
    // is still Recovering.
    expect(scaled.windowHours).toBeCloseTo(
      natural.windowHours! / ENHANCED_RECOVERY_MULTIPLIER,
      6
    );
    expect(natural.status).toBe('recovering');
    expect(scaled.status).toBe('fresh');
  });

  it('windowScale applies to dose adjustments too, not just the base window', () => {
    const enhanced = recoveryConfigFor(true);
    const history = [session(hoursAgo(10), 'chest_upper', 10, 0)]; // high dose → 48+24

    const natural = computeMuscleRecovery(history, 'chest_upper', NOW);
    const result = computeMuscleRecovery(history, 'chest_upper', NOW, enhanced);
    // The scalar multiplies (base + dose), not the base alone — so a
    // high-dose session scales by exactly the same factor as a light one.
    expect(result.windowHours).toBeCloseTo(
      natural.windowHours! / ENHANCED_RECOVERY_MULTIPLIER,
      6
    );
  });

  it('recoveryConfigFor(false) is the unscaled default config', () => {
    expect(recoveryConfigFor(false)).toBe(RECOVERY_CONFIG);
    expect(RECOVERY_CONFIG.windowScale).toBe(1);
  });
});

describe('every session leaves an INDEPENDENT debt (no last-session-wins)', () => {
  // The reported defect: a 2-set dead hang, credited to lats as a secondary
  // (1.0 effective set), overwrote a real pull day's window with its own and
  // moved the muscle from "Recovering, Fresh in ~8h" to "Fatigued, Fresh in
  // ~42h". A light touch must never lengthen a debt it did not create.
  const heavyPull: RecoverySession = {
    performedAt: hoursAgo(72),
    exercises: [
      { primaryMuscle: 'lats', secondaryMuscles: [], sets: Array.from({ length: 4 }, () => ({ repsInTank: 1 })) },
      { primaryMuscle: 'upper_back', secondaryMuscles: ['lats'], sets: Array.from({ length: 5 }, () => ({ repsInTank: 1 })) },
    ],
  };
  const gripHold = session(hoursAgo(6), 'forearms', 2, 3, ['lats']);

  it('a trivial later session cannot REPLACE the heavy debt it followed', () => {
    const alone = computeMuscleRecovery([heavyPull], 'lats', NOW);
    const withHold = computeMuscleRecovery([heavyPull, gripHold], 'lats', NOW);

    // The heavy day's own debt survives intact — same window, still listed —
    // where last-session-wins deleted it and substituted the hold's.
    const heavyDebt = withHold.debts.find(
      (d) => d.performedAt.getTime() === hoursAgo(72).getTime()
    );
    expect(heavyDebt).toBeDefined();
    expect(heavyDebt!.windowHours).toBeCloseTo(alone.windowHours!, 6);

    // The hold may still add its OWN short debt — that is legitimate, you did
    // hang from a bar 6h ago — but it is bounded by that window, not by the
    // heavy day's. Pre-fix this added 34h; the hold's whole window is ~21h.
    expect(withHold.hoursUntilReady).toBeGreaterThanOrEqual(alone.hoursUntilReady);
    expect(withHold.hoursUntilReady - alone.hoursUntilReady).toBeLessThan(4);

    // `lastTrainedAt` stays literal — it is what the sheet shows.
    expect(withHold.lastTrainedAt).toEqual(hoursAgo(6));
    expect(withHold.hoursSinceLast).toBeCloseTo(6, 6);
  });

  it('a trivial later session cannot SHORTEN the heavy session either', () => {
    const heavyOnly = computeMuscleRecovery([heavyPull], 'lats', NOW);
    // A grip hold logged right after the heavy day, whose own window is long
    // since over, must not discharge the heavy day's remaining debt.
    const withEarlyHold = computeMuscleRecovery(
      [heavyPull, session(hoursAgo(70), 'forearms', 2, 3, ['lats'])],
      'lats',
      NOW
    );
    expect(withEarlyHold.estimatedReadyAt).toEqual(heavyOnly.estimatedReadyAt);
    expect(withEarlyHold.status).toBe(heavyOnly.status);
  });

  it('reports the WORST status across debts, and the LATEST ready-time — even from different sessions', () => {
    // Heavy day 60h ago: further through its window, but the longer-dated
    // debt. Grip hold 6h ago: barely started, but a short window.
    const recentHeavy = { ...heavyPull, performedAt: hoursAgo(60) };
    const result = computeMuscleRecovery([recentHeavy, gripHold], 'lats', NOW);
    const heavyOnly = computeMuscleRecovery([recentHeavy], 'lats', NOW);
    const holdOnly = computeMuscleRecovery([gripHold], 'lats', NOW);

    // Status comes from the hold (the least-recovered debt)…
    expect(heavyOnly.status).toBe('recovering');
    expect(holdOnly.status).toBe('fatigued');
    expect(result.status).toBe('fatigued');

    // …while the ready-time comes from the heavy day (the longest-dated one).
    expect(result.governingTrainedAt).toEqual(hoursAgo(60));
    expect(result.hoursUntilReady).toBeCloseTo(heavyOnly.hoursUntilReady, 6);
    expect(result.hoursUntilReady).toBeGreaterThan(holdOnly.hoursUntilReady);

    expect(result.debts).toHaveLength(2);
    expect(result.debts[0].ratio).toBeLessThanOrEqual(result.debts[1].ratio);
  });

  it('status is exactly readinessRatio banded — the two can never disagree', () => {
    for (const history of [[heavyPull], [gripHold], [heavyPull, gripHold], []]) {
      const r = computeMuscleRecovery(history, 'lats', NOW);
      expect(r.status).toBe(
        r.readinessRatio >= 1
          ? 'fresh'
          : r.readinessRatio >= RECOVERY_CONFIG.recoveringThreshold
            ? 'recovering'
            : 'fatigued'
      );
      // Fresh implies every debt settled, so nothing is outstanding.
      if (r.status === 'fresh') {
        expect(r.debts).toEqual([]);
        expect(r.hoursUntilReady).toBe(0);
      }
    }
  });

  it('the end-to-end regression: 2 secondary sets no longer buy 42h of unreadiness', () => {
    const withHold = computeMuscleRecovery([heavyPull, gripHold], 'lats', NOW);
    // Pre-fix this returned windowHours 48 and hoursUntilReady 42 — a 34h
    // increase over the heavy day alone, off one effective set.
    expect(withHold.hoursUntilReady).toBeLessThan(20);
    const holdOnly = computeMuscleRecovery([gripHold], 'lats', NOW);
    expect(holdOnly.windowHours!).toBeLessThan(30);
  });

  it('ties on ready-time resolve to the more recent session, deterministically', () => {
    const twice = [session(hoursAgo(10), 'biceps', 4, 2), session(hoursAgo(10), 'biceps', 4, 2)];
    const a = computeMuscleRecovery(twice, 'biceps', NOW);
    const b = computeMuscleRecovery([...twice].reverse(), 'biceps', NOW);
    expect(a.governingTrainedAt).toEqual(b.governingTrainedAt);
    expect(a.windowHours).toBeCloseTo(b.windowHours!, 10);
    expect(a.status).toBe(b.status);
  });

  it('is order-independent for the same set of sessions', () => {
    const sessions = [heavyPull, gripHold, session(hoursAgo(30), 'lats', 3, 2)];
    const forward = computeMuscleRecovery(sessions, 'lats', NOW);
    const backward = computeMuscleRecovery([...sessions].reverse(), 'lats', NOW);
    expect(backward.status).toBe(forward.status);
    expect(backward.readinessRatio).toBeCloseTo(forward.readinessRatio, 10);
    expect(backward.estimatedReadyAt).toEqual(forward.estimatedReadyAt);
    expect(backward.governingTrainedAt).toEqual(forward.governingTrainedAt);
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

    expect(quads.windowHours).toBeCloseTo(expectedWindow('quads', 5, 0, RECOVERY_CONFIG, 1.2), 6);
    // Hamstrings untouched by the quads multiplier.
    expect(hams.windowHours).toBeCloseTo(expectedWindow('hamstrings', 5, 0), 6);
    const unlearned = computeMuscleRecovery([session(at, 'quads', 5, 2)], 'quads', NOW);
    expect(quads.windowHours).toBeCloseTo(unlearned.windowHours! * 1.2, 6);
  });

  it('composes with the enhanced-athlete windowScale', () => {
    const config = recoveryConfigFor(true, { quads: 1.2 });
    const result = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW,
      config
    );
    const natural = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW
    );
    expect(result.windowHours).toBeCloseTo(
      (natural.windowHours! * 1.2) / ENHANCED_RECOVERY_MULTIPLIER,
      6
    );
  });

  it('an out-of-range persisted multiplier is clamped before it can distort the window', () => {
    const config = recoveryConfigFor(false, { quads: 9 });
    const result = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW,
      config
    );
    const unclamped = computeMuscleRecovery(
      [session(hoursAgo(50), 'quads', 5, 2)],
      'quads',
      NOW
    );
    expect(result.windowHours).toBeCloseTo(
      unclamped.windowHours! * RECOVERY_MULTIPLIER_BOUNDS.max,
      6
    );
  });

  it('a "still sore" report can flip the same-hours verdict after learning', () => {
    // Sit just PAST the unlearned window, then let the muscle learn a longer
    // one: the same elapsed hours must flip Fresh -> Recovering. The offset is
    // derived from the model so the test cannot rot against a retuned dose
    // curve — the behavioural claim is what is pinned.
    const unlearnedWindow = expectedWindow('quads', 5, 0);
    const elapsed = unlearnedWindow + 1;
    const history = [session(hoursAgo(elapsed), 'quads', 5, 2)];
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

  it('stays within RECOVERY_MULTIPLIER_BOUNDS over ANY input sequence (property test)', () => {
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
    // Saturating chest session 24h ago → 48 × 1.45 = 69.6h base-case window.
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

    expect(baseline.windowHours).toBeCloseTo(saturatedWindow('chest_upper'), 6);
    expect(shortSleep.windowHours).toBeCloseTo(saturatedWindow('chest_upper') * 1.15, 5);
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
    expect(result.windowHours).toBeCloseTo(saturatedWindow('chest_upper') * 0.95, 5);
  });

  it('composes with the enhanced-athlete windowScale and learned multipliers', () => {
    const history = [session(hoursAgo(24), 'chest_upper', 10, 0)];
    const config = recoveryConfigFor(true, { chest_upper: 1.2 }, 1.15);
    const result = computeMuscleRecovery(history, 'chest_upper', NOW, config);
    expect(result.windowHours).toBeCloseTo(
      (saturatedWindow('chest_upper') / ENHANCED_RECOVERY_MULTIPLIER) * 1.2 * 1.15,
      5
    );
  });
});
