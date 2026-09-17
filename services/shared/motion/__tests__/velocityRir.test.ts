/**
 * velocityRir — the MVT (minimal velocity threshold) → estimated-RIR fit.
 *
 * Contract under test: the module refuses to guess (returns null) whenever
 * the data can't support an estimate, and every line it can emit obeys the
 * same describe-don't-judge framing rules as observations.ts.
 */

import type { CaptureAnalysisRepMetrics } from '@/types/motion';
import {
  analysisRepsToVelocityReps,
  buildMvtProfile,
  buildVelocityRirLine,
  captureRepsToVelocityReps,
  estimateRirFromVelocity,
  MVT_MIN_SETS,
  VELOCITY_RIR_CONTEXT_LINE,
  VELOCITY_RIR_ESTIMATE_MAX,
  type LabeledVelocitySet,
  type MvtProfile,
  type VelocityRep,
} from '../velocityRir';
import type { CaptureRep } from '../captureAnalysis';

/** Same banned-language list as the observations test (framing rule). */
const BANNED = [
  /didn['’]?t count/i,
  /not counted/i,
  /\binvalid\b/i,
  /incomplete rep/i,
  /bad form/i,
  /form breakdown/i,
  /partial rep/i,
  /failed rep/i,
];

function expectNoBannedLanguage(text: string, context: string) {
  for (const pattern of BANNED) {
    if (pattern.test(text)) {
      throw new Error(`Banned language ${pattern} in ${context}: "${text}"`);
    }
  }
}

/** Reps declining linearly to `finalW` (0.1 rad/s per rep). */
function decliningReps(finalW: number, count = 5): VelocityRep[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    meanConcentricW: finalW + (count - 1 - i) * 0.1,
  }));
}

function flatReps(w: number, count = 6): VelocityRep[] {
  return Array.from({ length: count }, (_, i) => ({ index: i, meanConcentricW: w }));
}

function labeled(
  finalW: number,
  loggedRir: number,
  overrides: Partial<LabeledVelocitySet> = {}
): LabeledVelocitySet {
  return { reps: decliningReps(finalW), loggedRir, pc1VarianceShare: 0.95, ...overrides };
}

const soundProfile = (): MvtProfile => {
  const profile = buildMvtProfile([labeled(1.0, 0), labeled(1.05, 0), labeled(0.95, 0)]);
  if (!profile) throw new Error('fixture profile must build');
  return profile;
};

describe('buildMvtProfile', () => {
  it('returns null below MVT_MIN_SETS qualifying sets', () => {
    expect(buildMvtProfile([])).toBeNull();
    expect(buildMvtProfile([labeled(1.0, 0), labeled(1.0, 1)])).toBeNull();
    expect(MVT_MIN_SETS).toBe(3);
  });

  it('only near-limit labels (RIR 0-1) qualify', () => {
    expect(
      buildMvtProfile([labeled(1.0, 0), labeled(1.0, 1), labeled(1.0, 2), labeled(1.0, 4)])
    ).toBeNull();
  });

  it('excludes low-quality captures and sets with fewer than 4 reps', () => {
    const lowQuality = labeled(1.0, 0, { pc1VarianceShare: 0.5 });
    const thin = labeled(1.0, 0, { reps: decliningReps(1.0, 3) });
    expect(buildMvtProfile([lowQuality, thin, labeled(1.0, 0)])).toBeNull();
    // null pc1VarianceShare (older rows) passes.
    const untagged = labeled(1.0, 0, { pc1VarianceShare: null });
    expect(buildMvtProfile([untagged, labeled(1.0, 0), labeled(1.0, 0)])).not.toBeNull();
  });

  it('uses RIR-0 sets alone when enough exist, pooling RIR-1 otherwise', () => {
    // Three RIR-0 finals at ~1.0 and two RIR-1 finals at 2.0: the RIR-1
    // sets must not drag the threshold up.
    const preferZero = buildMvtProfile([
      labeled(1.0, 0),
      labeled(1.0, 0),
      labeled(1.0, 0),
      labeled(2.0, 1),
      labeled(2.0, 1),
    ]);
    expect(preferZero?.mvtW).toBeCloseTo(1.0);
    expect(preferZero?.setCount).toBe(3);

    const pooled = buildMvtProfile([labeled(1.0, 0), labeled(1.0, 0), labeled(1.2, 1)]);
    expect(pooled?.mvtW).toBeCloseTo(1.0);
    expect(pooled?.setCount).toBe(3);
  });

  it('flags low confidence when failure velocities disagree', () => {
    const spread = buildMvtProfile([labeled(0.5, 0), labeled(1.0, 0), labeled(2.0, 0)]);
    expect(spread?.lowConfidence).toBe(true);
    expect(soundProfile().lowConfidence).toBe(false);
  });
});

describe('estimateRirFromVelocity', () => {
  it('refuses on a low-confidence profile or a thin current set', () => {
    const lowConfidence = { ...soundProfile(), lowConfidence: true };
    expect(estimateRirFromVelocity(decliningReps(1.3), lowConfidence)).toBeNull();
    expect(estimateRirFromVelocity(decliningReps(1.3, 3), soundProfile())).toBeNull();
    expect(estimateRirFromVelocity([], soundProfile())).toBeNull();
  });

  it('reads a final velocity at the threshold as 0 in reserve', () => {
    const est = estimateRirFromVelocity(decliningReps(1.02), soundProfile());
    expect(est).toMatchObject({ estimatedRir: 0, atOrAboveMax: false });
  });

  it('extrapolates surplus velocity over the trailing decline', () => {
    // Final 1.3 vs MVT 1.0 with 0.1/rep decline → ~3 reps in reserve.
    const est = estimateRirFromVelocity(decliningReps(1.3, 8), soundProfile());
    expect(est).toMatchObject({ estimatedRir: 3, atOrAboveMax: false });
    expect(est?.declinePerRepW).toBeCloseTo(0.1);
  });

  it('caps at the RepsInTank ceiling and marks it', () => {
    const est = estimateRirFromVelocity(decliningReps(1.9, 12), soundProfile());
    expect(est).toMatchObject({
      estimatedRir: VELOCITY_RIR_ESTIMATE_MAX,
      atOrAboveMax: true,
    });
  });

  it('handles a set that never slowed: far above → max, ambiguous → null', () => {
    const far = estimateRirFromVelocity(flatReps(1.4), soundProfile());
    expect(far).toMatchObject({ estimatedRir: VELOCITY_RIR_ESTIMATE_MAX, atOrAboveMax: true });
    expect(estimateRirFromVelocity(flatReps(1.1), soundProfile())).toBeNull();
  });
});

describe('buildVelocityRirLine', () => {
  const estimates = () => {
    const profile = soundProfile();
    return [
      estimateRirFromVelocity(decliningReps(1.02), profile),
      estimateRirFromVelocity(decliningReps(1.15, 8), profile),
      estimateRirFromVelocity(decliningReps(1.3, 8), profile),
      estimateRirFromVelocity(flatReps(1.4), profile),
    ].filter((e): e is NonNullable<typeof e> => e !== null);
  };

  it('states the estimate and restates the logged RIR as a fact', () => {
    const profile = soundProfile();
    const est = estimateRirFromVelocity(decliningReps(1.3, 8), profile)!;
    expect(buildVelocityRirLine(est, 1)).toContain('roughly 3 reps in reserve');
    expect(buildVelocityRirLine(est, 1)).toContain('You logged 1 in reserve.');
    expect(buildVelocityRirLine(est, 4)).toContain('You logged 4+');
    expect(buildVelocityRirLine(est, null)).not.toContain('You logged');

    const atMax = estimateRirFromVelocity(flatReps(1.4), profile)!;
    expect(buildVelocityRirLine(atMax, null)).toContain('4 or more reps in reserve');
    const atZero = estimateRirFromVelocity(decliningReps(1.0), profile)!;
    expect(buildVelocityRirLine(atZero, null)).toContain('0-1 reps in reserve');
  });

  it('never emits banned language from any variant, including the context line', () => {
    for (const est of estimates()) {
      for (const rir of [null, 0, 1, 2, 4]) {
        expectNoBannedLanguage(buildVelocityRirLine(est, rir), 'velocity RIR line');
      }
    }
    expectNoBannedLanguage(VELOCITY_RIR_CONTEXT_LINE, 'context line');
  });
});

describe('adapters', () => {
  it('maps live CaptureReps and persisted analysis_metrics to the same shape', () => {
    const live = [
      { index: 0, meanWConcentric: 1.5 },
      { index: 1, meanWConcentric: 1.2 },
    ] as CaptureRep[];
    expect(captureRepsToVelocityReps(live)).toEqual([
      { index: 0, meanConcentricW: 1.5 },
      { index: 1, meanConcentricW: 1.2 },
    ]);

    const persisted = [
      { index: 0, meanConcentricW_radps: 1.5 },
      { index: 1, meanConcentricW_radps: 1.2 },
    ] as CaptureAnalysisRepMetrics[];
    expect(analysisRepsToVelocityReps(persisted)).toEqual(captureRepsToVelocityReps(live));
  });
});
