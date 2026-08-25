/**
 * Stabilizer-recovery channel (services/muscleRecovery).
 *
 * Covers the approved spec's test list:
 *  - recovery-window math under the stabilizer windows (longer bases, dose
 *    scaling, learned multipliers, mover-vs-stabilizer-tag involvement),
 *  - trigger logic at and around both thresholds,
 *  - the missing-anchor case (no reference → never warn),
 *  - the safety invariant: Enhanced Athlete Mode must not touch stabilizer
 *    readiness (inherits the exerciseSafety.ts contract).
 */

import {
  computeMuscleRecovery,
  computeStabilizerRecovery,
  evaluateStabilizerWarning,
  recoveryConfigFor,
  requiredStabilizersFor,
  stabilizerReferenceLoadKg,
  stabilizerTrackedMuscles,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
} from '@/services/muscleRecovery';

const HOUR = 60 * 60 * 1000;

function sessionAt(hoursAgo: number, now: Date, exercises: RecoverySession['exercises']): RecoverySession {
  return { performedAt: new Date(now.getTime() - hoursAgo * HOUR), exercises };
}

const NOW = new Date('2026-08-25T12:00:00Z');

/** 4 hard-ish sets of heavy back extensions (erectors as a secondary mover). */
const backExtensions = (sets = 4) => ({
  primaryMuscle: 'glutes',
  secondaryMuscles: ['hamstrings', 'erectors'],
  sets: Array.from({ length: sets }, () => ({ repsInTank: 1 })),
});

/** A row: forearms + erectors carried as stabilizer tags only. */
const barbellRow = (sets = 4) => ({
  primaryMuscle: 'back',
  secondaryMuscles: ['biceps', 'rear_delts'],
  stabilizers: ['erectors', 'forearms'],
  sets: Array.from({ length: sets }, () => ({ repsInTank: 2 })),
});

describe('stabilizer recovery windows', () => {
  it('uses the stabilizer base window (96h erectors), not the mover window (60h)', () => {
    const history = [sessionAt(24, NOW, [backExtensions()])];
    const stab = computeStabilizerRecovery(history, 'erectors', NOW);
    const mover = computeMuscleRecovery(history, 'erectors', NOW);
    expect(stab.breakdown?.baseWindowHours).toBe(96);
    expect(mover.breakdown?.baseWindowHours).toBe(60);
    // Same dose, longer base → strictly longer resolved window, lower ratio.
    expect(stab.windowHours!).toBeGreaterThan(mover.windowHours!);
    expect(stab.readinessRatio).toBeLessThan(mover.readinessRatio);
  });

  it('accrues dose from stabilizer TAGS at stabilizerDoseFactor (mover channel sees nothing)', () => {
    const history = [sessionAt(6, NOW, [barbellRow()])];
    const stab = computeStabilizerRecovery(history, 'forearms', NOW);
    const mover = computeMuscleRecovery(history, 'forearms', NOW);
    expect(stab.dose).toBeCloseTo(4 * RECOVERY_CONFIG.stabilizerDoseFactor);
    // The row tags forearms only as a stabilizer, so the mover model owes
    // nothing — the channels answer different questions.
    expect(mover.status).toBe('fresh');
    expect(stab.status).toBe('fatigued');
  });

  it('takes MAX of mover and stabilizer factors, never the sum', () => {
    const doubleTagged = {
      primaryMuscle: 'back',
      secondaryMuscles: ['forearms'],
      stabilizers: ['forearms'],
      sets: Array.from({ length: 4 }, () => ({ repsInTank: 2 })),
    };
    const stab = computeStabilizerRecovery([sessionAt(6, NOW, [doubleTagged])], 'forearms', NOW);
    expect(stab.dose).toBeCloseTo(4 * 0.5); // not 4 × (0.5 + 0.5)
  });

  it('a muscle loaded as a PRIMARY mover still accrues stabilizer-channel debt at full strength', () => {
    const deadHang = {
      primaryMuscle: 'forearms',
      secondaryMuscles: [],
      sets: [{ repsInTank: 1 }, { repsInTank: 1 }],
    };
    const stab = computeStabilizerRecovery([sessionAt(6, NOW, [deadHang])], 'forearms', NOW);
    expect(stab.dose).toBe(2);
  });

  it('applies the learned per-muscle multiplier exactly like the mover model', () => {
    const history = [sessionAt(24, NOW, [backExtensions()])];
    const base = computeStabilizerRecovery(history, 'erectors', NOW);
    const learned: RecoveryConfig = {
      ...RECOVERY_CONFIG,
      recoveryMultiplierByMuscle: { erectors: 1.2 },
    };
    const scaled = computeStabilizerRecovery(history, 'erectors', NOW, learned);
    expect(scaled.windowHours!).toBeCloseTo(Math.min(120, base.windowHours! * 1.2), 5);
  });

  it('throws for a muscle the channel does not track', () => {
    expect(() => computeStabilizerRecovery([], 'quads', NOW)).toThrow(/not a stabilizer-tracked/);
  });

  it('tracks exactly the four spec muscles by default', () => {
    expect(stabilizerTrackedMuscles().sort()).toEqual(
      ['erectors', 'forearms', 'rear_delts', 'rotator_cuff'].sort()
    );
  });
});

describe('safety invariant: enhanced mode never touches stabilizer readiness', () => {
  const history = [sessionAt(24, NOW, [backExtensions()]), sessionAt(30, NOW, [barbellRow()])];

  it('stabilizer results are byte-identical with the mode on and off', () => {
    const natural = recoveryConfigFor(false);
    const enhanced = recoveryConfigFor(true);
    for (const muscle of ['erectors', 'forearms'] as const) {
      const a = computeStabilizerRecovery(history, muscle, NOW, natural);
      const b = computeStabilizerRecovery(history, muscle, NOW, enhanced);
      expect(b).toEqual(a);
    }
    // Sanity: the MOVER model does shrink under the mode, so the invariant
    // above is a real exemption rather than a vacuous equality.
    const moverNatural = computeMuscleRecovery(history, 'erectors', NOW, recoveryConfigFor(false));
    const moverEnhanced = computeMuscleRecovery(history, 'erectors', NOW, recoveryConfigFor(true));
    expect(moverEnhanced.windowHours!).toBeLessThan(moverNatural.windowHours!);
  });

  it('the wearable scale (folded into windowScale) is exempt too', () => {
    const withWearable = recoveryConfigFor(false, undefined, undefined, 1.15);
    const without = recoveryConfigFor(false);
    expect(computeStabilizerRecovery(history, 'erectors', NOW, withWearable)).toEqual(
      computeStabilizerRecovery(history, 'erectors', NOW, without)
    );
  });

  it('sleep still applies (environmental, not enhancement)', () => {
    const shortSleep: RecoveryConfig = { ...RECOVERY_CONFIG, sleepWindowMultiplier: 1.15 };
    const base = computeStabilizerRecovery(history, 'erectors', NOW);
    const stretched = computeStabilizerRecovery(history, 'erectors', NOW, shortSleep);
    expect(stretched.windowHours!).toBeGreaterThan(base.windowHours!);
  });
});

describe('stabilizer warning trigger', () => {
  const fatiguedHistory = [sessionAt(12, NOW, [backExtensions(5)])];
  const erectorsState = () => computeStabilizerRecovery(fatiguedHistory, 'erectors', NOW);

  it('fires when the stabilizer is fatigued AND planned load ≥ 80% of reference', () => {
    const state = erectorsState();
    expect(state.readinessRatio).toBeLessThan(RECOVERY_CONFIG.stabilizerReadinessThreshold);
    const warning = evaluateStabilizerWarning({
      muscle: 'erectors',
      recovery: state,
      plannedLoadKg: 90,
      referenceLoadKg: 100,
    });
    expect(warning).not.toBeNull();
    expect(warning!.intensityRatio).toBeCloseTo(0.9);
    expect(warning!.estimatedReadyAt).toEqual(state.estimatedReadyAt);
  });

  it('stays silent below the intensity gate (60% of reference)', () => {
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors',
        recovery: erectorsState(),
        plannedLoadKg: 60,
        referenceLoadKg: 100,
      })
    ).toBeNull();
  });

  it('boundary: exactly at the intensity threshold fires, a hair under does not', () => {
    const state = erectorsState();
    const at = evaluateStabilizerWarning({
      muscle: 'erectors', recovery: state, plannedLoadKg: 80, referenceLoadKg: 100,
    });
    const under = evaluateStabilizerWarning({
      muscle: 'erectors', recovery: state, plannedLoadKg: 79.9, referenceLoadKg: 100,
    });
    expect(at).not.toBeNull();
    expect(under).toBeNull();
  });

  it('boundary: readinessRatio exactly at the threshold does NOT fire (< is strict)', () => {
    const state = { ...erectorsState(), readinessRatio: RECOVERY_CONFIG.stabilizerReadinessThreshold };
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors', recovery: state, plannedLoadKg: 100, referenceLoadKg: 100,
      })
    ).toBeNull();
  });

  it('a recovered stabilizer never warns regardless of load', () => {
    const freshState = computeStabilizerRecovery([], 'erectors', NOW);
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors', recovery: freshState, plannedLoadKg: 500, referenceLoadKg: 100,
      })
    ).toBeNull();
  });

  it('missing anchor: no reference or no planned load → no warning', () => {
    const state = erectorsState();
    expect(
      evaluateStabilizerWarning({ muscle: 'erectors', recovery: state, plannedLoadKg: 100, referenceLoadKg: null })
    ).toBeNull();
    expect(
      evaluateStabilizerWarning({ muscle: 'erectors', recovery: state, plannedLoadKg: null, referenceLoadKg: 100 })
    ).toBeNull();
    expect(
      evaluateStabilizerWarning({ muscle: 'erectors', recovery: state, plannedLoadKg: 100, referenceLoadKg: 0 })
    ).toBeNull();
  });

  it('thresholds are config, not constants baked into the evaluator', () => {
    const strict: RecoveryConfig = {
      ...RECOVERY_CONFIG,
      stabilizerIntensityThreshold: 0.5,
      stabilizerReadinessThreshold: 0.9,
    };
    const state = erectorsState();
    expect(
      evaluateStabilizerWarning({
        muscle: 'erectors', recovery: state, plannedLoadKg: 60, referenceLoadKg: 100, config: strict,
      })
    ).not.toBeNull();
  });
});

describe('reference load resolution', () => {
  it('previous top set wins over the anchor', () => {
    expect(stabilizerReferenceLoadKg(100, 200)).toBe(100);
  });
  it('falls back to anchor × working fraction', () => {
    expect(stabilizerReferenceLoadKg(null, 100)).toBeCloseTo(
      100 * RECOVERY_CONFIG.stabilizerE1rmWorkingFraction
    );
  });
  it('no previous set and no anchor → null (never warn)', () => {
    expect(stabilizerReferenceLoadKg(null, null)).toBeNull();
    expect(stabilizerReferenceLoadKg(0, 0)).toBeNull();
  });
});

describe('required-stabilizer predicate', () => {
  it('resolves tags to tracked standard muscles and dedupes', () => {
    expect(
      requiredStabilizersFor({ stabilizers: ['erectors', 'forearms', 'erectors'] })
    ).toEqual(['erectors', 'forearms']);
  });

  it('filters out untracked tags (abs) and unknown tokens', () => {
    expect(requiredStabilizersFor({ stabilizers: ['abs', 'nonsense'] })).toEqual([]);
  });

  it('a curl with no stabilizer tags requires nothing — prime-mover fatigue alone never warns', () => {
    expect(requiredStabilizersFor({ stabilizers: [] })).toEqual([]);
    expect(requiredStabilizersFor({})).toEqual([]);
  });

  it('secondary MOVER tags do not gate: only the stabilizers field does', () => {
    // A pulldown carries rear_delts as a secondary mover; the predicate reads
    // only `stabilizers`, so rear-delt fatigue cannot gate every pull day.
    expect(requiredStabilizersFor({ stabilizers: ['forearms'] })).toEqual(['forearms']);
  });
});
