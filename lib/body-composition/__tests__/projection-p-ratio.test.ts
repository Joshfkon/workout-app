import {
  computeProjectionPRatio,
  PROJECTION_PRATIO_CLAMP,
} from '@/lib/body-composition/projection-p-ratio';
import type { CompositionObservation } from '@/services/compositionSpace';

const HEIGHT_CM = 188;

const profile = {
  goal: 'bulk' as const,
  sex: 'male' as const,
  age: 32,
  trainingAge: 'intermediate' as const,
  isEnhanced: false,
};

// Two clean surplus pairs (fat fractions ≈ 0.42 and 0.40) plus one clean
// deficit pair (fat fraction ≈ 0.83) and one suppressed pair.
const scans: CompositionObservation[] = [
  { date: '2025-07-10', leanMassKg: 58.6, fatMassKg: 18.0, weightKg: 80.1, boneMassKg: 3.1, bodyFatPercent: 22.5 },
  { date: '2025-11-20', leanMassKg: 58.0, fatMassKg: 15.0, weightKg: 76.5, boneMassKg: 3.1, bodyFatPercent: 19.6 },
  { date: '2026-03-10', leanMassKg: 59.4, fatMassKg: 16.1, weightKg: 79.1, boneMassKg: 3.1, bodyFatPercent: 20.4 },
  { date: '2026-04-20', leanMassKg: 59.8, fatMassKg: 16.5, weightKg: 80.0, boneMassKg: 3.1, bodyFatPercent: 20.6 },
  { date: '2026-07-05', leanMassKg: 61.3, fatMassKg: 17.5, weightKg: 82.5, boneMassKg: 3.1, bodyFatPercent: 21.2 },
];

describe('computeProjectionPRatio — fallback paths (must yield the 0.5 default)', () => {
  it('returns null without a profile', () => {
    expect(computeProjectionPRatio({ scans, heightCm: HEIGHT_CM, profile: null })).toBeNull();
  });

  it('returns null without a height', () => {
    expect(computeProjectionPRatio({ scans, heightCm: null, profile })).toBeNull();
    expect(computeProjectionPRatio({ scans, heightCm: 0, profile })).toBeNull();
  });

  it('returns null below 2 scans (no pairs possible)', () => {
    expect(
      computeProjectionPRatio({ scans: scans.slice(0, 1), heightCm: HEIGHT_CM, profile })
    ).toBeNull();
    expect(computeProjectionPRatio({ scans: [], heightCm: HEIGHT_CM, profile })).toBeNull();
  });

  it('returns null for maintenance/recomp/unknown goals (no direction)', () => {
    for (const goal of ['maintenance', 'recomp', null] as const) {
      expect(
        computeProjectionPRatio({ scans, heightCm: HEIGHT_CM, profile: { ...profile, goal } })
      ).toBeNull();
    }
  });

  it('returns null when no pair matches the phase direction', () => {
    // Only the two gain segments — a cut has no deficit history to learn from.
    const gainOnly = scans.slice(1);
    expect(
      computeProjectionPRatio({
        scans: gainOnly,
        heightCm: HEIGHT_CM,
        profile: { ...profile, goal: 'cut' },
      })
    ).toBeNull();
  });
});

describe('computeProjectionPRatio — engaged paths', () => {
  it('bulk learns only from surplus pairs and returns the anchor lean fraction', () => {
    const result = computeProjectionPRatio({ scans, heightCm: HEIGHT_CM, profile });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('surplus');
    // 3 gain segments exist but one (+0.9 kg) is suppressed → 2 usable.
    expect(result!.pairsUsed).toBe(2);
    // Personal fat fractions ≈ 0.41 average; heuristic (gain model) blends
    // at 45% weight for 2 pairs — the result must sit between the two and
    // inside the clamp.
    expect(result!.fatFraction).toBeGreaterThan(PROJECTION_PRATIO_CLAMP[0]);
    expect(result!.fatFraction).toBeLessThan(PROJECTION_PRATIO_CLAMP[1]);
    expect(result!.leanRatio).toBeCloseTo(1 - result!.fatFraction, 10);
    // Learned-lean bulk history (~0.58 lean) must pull the split above the
    // anchor's neutral 0.5.
    expect(result!.leanRatio).toBeGreaterThan(0.5);
  });

  it('cut learns only from deficit pairs via calculatePRatio', () => {
    const result = computeProjectionPRatio({
      scans,
      heightCm: HEIGHT_CM,
      profile: { ...profile, goal: 'cut' },
    });
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('deficit');
    expect(result!.pairsUsed).toBe(1);
    // The one deficit pair lost ~83% as fat; blended output stays a
    // mostly-fat loss → lean fraction well below 0.5.
    expect(result!.fatFraction).toBeGreaterThan(0.6);
    expect(result!.leanRatio).toBeLessThan(0.4);
  });

  it('clamps an absurd implied p-ratio to ≤ 0.90 fat', () => {
    // Recomp-shaped "loss": −5.0 kg scale weight while fat dropped 7 kg and
    // lean rose 2 kg → implied fat fraction 1.4. Three copies drive the
    // personal average to 1.4 with 75% trust; the clamp must cap the blend.
    const absurd: CompositionObservation[] = [
      { date: '2025-01-01', leanMassKg: 60, fatMassKg: 25, weightKg: 88, boneMassKg: 3, bodyFatPercent: 28.4 },
      { date: '2025-04-01', leanMassKg: 62, fatMassKg: 18, weightKg: 83, boneMassKg: 3, bodyFatPercent: 21.7 },
      { date: '2025-07-01', leanMassKg: 64, fatMassKg: 11, weightKg: 78, boneMassKg: 3, bodyFatPercent: 14.1 },
      { date: '2025-10-01', leanMassKg: 66, fatMassKg: 4, weightKg: 73, boneMassKg: 3, bodyFatPercent: 5.5 },
    ];
    const result = computeProjectionPRatio({
      scans: absurd,
      heightCm: HEIGHT_CM,
      profile: { ...profile, goal: 'cut' },
    });
    expect(result).not.toBeNull();
    expect(result!.pairsUsed).toBe(3);
    expect(result!.fatFraction).toBeLessThanOrEqual(PROJECTION_PRATIO_CLAMP[1]);
    expect(result!.fatFraction).toBe(PROJECTION_PRATIO_CLAMP[1]);
    expect(result!.leanRatio).toBeCloseTo(0.1, 10);
  });

  it('clamps the other bound at ≥ 0.30 fat', () => {
    // Gains that were implausibly all-lean (fat fraction ≈ 0): the blend
    // must not project a gain as < 30% fat.
    const allLean: CompositionObservation[] = [
      { date: '2025-01-01', leanMassKg: 55, fatMassKg: 15, weightKg: 73, boneMassKg: 3, bodyFatPercent: 20.5 },
      { date: '2025-04-01', leanMassKg: 58, fatMassKg: 15, weightKg: 76, boneMassKg: 3, bodyFatPercent: 19.7 },
      { date: '2025-07-01', leanMassKg: 61, fatMassKg: 15, weightKg: 79, boneMassKg: 3, bodyFatPercent: 19.0 },
      { date: '2025-10-01', leanMassKg: 64, fatMassKg: 15, weightKg: 82, boneMassKg: 3, bodyFatPercent: 18.3 },
    ];
    const result = computeProjectionPRatio({
      scans: allLean,
      heightCm: HEIGHT_CM,
      profile,
    });
    expect(result).not.toBeNull();
    expect(result!.fatFraction).toBeGreaterThanOrEqual(PROJECTION_PRATIO_CLAMP[0]);
  });
});
