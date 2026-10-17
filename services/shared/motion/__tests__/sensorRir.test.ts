import { CLEANING_VERSION, type CleanedCapture, type CleanRep } from '../captureGating';
import { MOTION_SET_CONFIG } from '../motionSetConfig';
import { estimateSetRir } from '../sensorRir';
import type { MvtProfile } from '../velocityRir';

function rep(n: number, meanW: number): CleanRep {
  return {
    n,
    detectedIndex: n - 1,
    concentricMs: 1500,
    eccentricMs: 1200,
    peakW: meanW * 1.5,
    meanW,
    romDeg: 40,
    romGravityDeg: null,
    dwellMs: n === 1 ? null : 200,
    turnaroundAccelRadps2: null,
  };
}

/** Relative velocities per rep, scaled to 1 rad/s at the start. */
function cleaned(relative: number[], overrides: Partial<CleanedCapture> = {}): CleanedCapture {
  return {
    version: CLEANING_VERSION,
    reps: relative.map((r, i) => rep(i + 1, r)),
    rejected: [],
    rawRepCount: relative.length,
    unpairedHalfReps: 0,
    splitPauseMs: null,
    outsideBlockCount: 0,
    pc1ShareRaw: 0.95,
    pc1ShareClean: 0.95,
    ...overrides,
  };
}

// The set in the screenshot that prompted this: 42% loss, "Hard".
const HARD_SET = [0.91, 1.0, 0.86, 0.81, 0.85, 0.76, 0.65, 0.5];

describe('estimateSetRir', () => {
  it('falls back to the velocity-loss zone without a learned profile', () => {
    expect(estimateSetRir(cleaned(HARD_SET), null)).toEqual({
      rir: MOTION_SET_CONFIG.coach.zoneRir.hard,
      source: 'velocity-loss',
      zone: 'hard',
    });
    expect(estimateSetRir(cleaned([1, 0.98, 0.97, 0.96, 0.95]), null)?.rir).toBe(4);
    expect(estimateSetRir(cleaned([1, 0.9, 0.7, 0.5, 0.4]), null)).toMatchObject({ rir: 1, zone: 'near-failure' });
  });

  it('every zone prefill agrees with the coach cross-check (it can never flag its own prefill)', () => {
    const d = MOTION_SET_CONFIG.coach.rirDisagreement;
    const z = MOTION_SET_CONFIG.coach.zoneRir;
    expect(z.easy).toBeGreaterThan(d.easyButLoggedAtMost);
    expect(z.moderate).toBeGreaterThan(d.easyButLoggedAtMost);
    expect(z.hard).toBeLessThan(d.hardButLoggedAtLeast);
    expect(z['near-failure']).toBeLessThan(d.hardButLoggedAtLeast);
  });

  it('uses the learned profile when one is usable', () => {
    const profile: MvtProfile = { mvtW: 0.3, setCount: 5, relSpread: 0.1, lowConfidence: false };
    // Final 0.5, declining 0.1/rep over the tail → (0.5 − 0.3) / 0.1 = 2.
    const est = estimateSetRir(cleaned([0.9, 0.8, 0.7, 0.6, 0.5]), profile);
    expect(est).toMatchObject({ rir: 2, source: 'velocity-profile' });
  });

  it("respects the profile's refusal instead of guessing from the zone", () => {
    const profile: MvtProfile = { mvtW: 0.9, setCount: 5, relSpread: 0.1, lowConfidence: false };
    // Flat, slightly above MVT: ambiguous → the profile returns null.
    expect(estimateSetRir(cleaned([1, 1, 1, 1, 1]), profile)).toBeNull();
  });

  it('ignores an inconsistent profile and uses the zone', () => {
    const profile: MvtProfile = { mvtW: 0.3, setCount: 5, relSpread: 0.5, lowConfidence: true };
    expect(estimateSetRir(cleaned(HARD_SET), profile)?.source).toBe('velocity-loss');
  });

  it('a low-confidence capture yields no estimate', () => {
    expect(estimateSetRir(cleaned(HARD_SET, { pc1ShareClean: 0.5, pc1ShareRaw: 0.5 }), null)).toBeNull();
    expect(estimateSetRir(cleaned(HARD_SET, { splitPauseMs: 7000 }), null)).toBeNull();
  });

  it('too few reps for a velocity loss → nothing', () => {
    expect(estimateSetRir(cleaned([1, 0.6]), null)).toBeNull();
  });
});
