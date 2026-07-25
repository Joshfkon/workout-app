import { recommendSeedForSlot } from '../setRecommender';
import { sumDisplayVolume, inputWeightToKg } from '@/lib/utils';

/**
 * Phase 3 — rounding and units:
 *  - a held weight is returned VERBATIM, never re-rounded to the increment
 *    grid (135 lb must stay 135 lb, not 61.23 kg → 60 kg → "132.5 lb");
 *  - prescribed deltas below max(2.5%, one increment) are suppressed as
 *    noise (hold, don't "adjust" by 1.85%);
 *  - display volume is computed in the native unit per set
 *    (160 × 12 × 4 = 7,680, not the kg-roundtrip 7,679).
 */

describe('seed hold-verbatim + minimum meaningful change (Phase 3)', () => {
  const LB135_KG = inputWeightToKg(135, 'lb'); // 61.23496...

  it('bump-gate hold returns the recent working weight EXACTLY (the 135 lb case)', () => {
    // Inflated-ish anchor wants more than recent; last session did not earn a
    // bump (top set below the range ceiling) → gate holds at recent. The old
    // path then re-rounded 61.23 kg to the 5-kg grid (60 kg → "132.5 lb").
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [12, 20],
      targetRir: 2,
      minIncrementKg: 4.54, // 10 lb stack step
      anchorE1RMKg: 105, // wants ~64 kg at mid-range
      recentWorkingWeightKg: LB135_KG,
      prevWeightKg: LB135_KG,
      prevReps: 12,
      prevRir: 1,
      prevSessionSets: [
        { weightKg: LB135_KG, reps: 12, rir: 1 },
        { weightKg: LB135_KG, reps: 10, rir: 2 },
        { weightKg: LB135_KG, reps: 8, rir: 2 },
      ],
    });
    expect(seed.weightKg).toBe(LB135_KG); // verbatim — zero grid snapping
    expect(seed.clampBinder).toBe('bump_gate');
    expect(seed.preClampWeightKg).toBeGreaterThan(LB135_KG);
  });

  it('suppresses sub-threshold deltas: a ~1.9% prescribed change holds instead', () => {
    // Anchor implies 100.9 kg vs recent 100 — under max(2.5%, inc) → hold.
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 0.5, // tiny increment so the % floor is what binds
      anchorE1RMKg: 141.3, // mid 10 @ 2 → 141.3/1.4 = 100.9
      recentWorkingWeightKg: 100,
      prevWeightKg: 100,
      prevReps: 10,
      prevRir: 2,
    });
    expect(seed.weightKg).toBe(100);
    expect(seed.clampBinder).toBe('noise_floor');
  });

  it('a genuinely earned, meaningful increase still prescribes and rounds normally', () => {
    const seed = recommendSeedForSlot({
      role: 'working',
      targetRepRange: [8, 12],
      targetRir: 2,
      minIncrementKg: 2.27, // 5 lb
      anchorE1RMKg: 150, // mid 10 @ 2 → 107.1
      recentWorkingWeightKg: 100,
      prevWeightKg: 100,
      prevReps: 12,
      prevRir: 2,
      prevSessionSets: [
        { weightKg: 100, reps: 12, rir: 2 },
        { weightKg: 100, reps: 12, rir: 2 },
      ],
    });
    // 107.1 → 2.27 grid → 106.69 (47 steps) — a real, rounded prescription.
    expect(seed.weightKg).toBeCloseTo(106.69, 2);
    expect(seed.clampBinder).toBe('none');
  });
});

describe('sumDisplayVolume (native-unit tonnage)', () => {
  it('160 lb × 12 × 4 renders 7,680 — not the kg-roundtrip 7,679', () => {
    // Storage precision: DECIMAL(6,2) keeps 72.57 kg, whose kg-sum converts
    // back to 7,679.49 lb. Per-set native conversion recovers 160.0 first.
    const sets = Array.from({ length: 4 }, () => ({ weightKg: 72.57, reps: 12 }));
    expect(sumDisplayVolume(sets, 'lb')).toBe(7680);
  });

  it('kg users sum exactly in kg', () => {
    const sets = [
      { weightKg: 100, reps: 10 },
      { weightKg: 80, reps: 8 },
    ];
    expect(sumDisplayVolume(sets, 'kg')).toBe(1640);
  });
});
