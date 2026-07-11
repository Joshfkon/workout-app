import {
  projectWeightTrajectory,
  projectionInputsKey,
  type WeightProjectionInput,
  type CompositionAnchors,
} from '@/services/weightProjection';

const NOW = new Date('2026-07-11T12:00:00');

const anchors: CompositionAnchors = {
  heightCm: 180,
  currentBodyFatPercent: 19,
  avgDailyProteinGrams: 170,
  avgWeeklyTrainingSets: 16,
  trainingAge: 'intermediate',
  isEnhanced: false,
  biologicalSex: 'male',
  chronologicalAge: 30,
};

function baseInput(overrides: Partial<WeightProjectionInput> = {}): WeightProjectionInput {
  return {
    now: NOW,
    currentWeightLbs: 176.4,
    tdee: 2935,
    targetCalories: 3100,
    phase: 'bulk',
    standardError: 250,
    horizonDays: [7, 14, 28, 56],
    composition: anchors,
    ...overrides,
  };
}

describe('projectWeightTrajectory', () => {
  it('projects a gain on a bulk with a surplus target', () => {
    const result = projectWeightTrajectory(baseInput());

    // 3100 - 2935 = +165 kcal/day surplus -> +165/3500 lb/day ≈ +0.33 lb/week
    expect(result.dailyWeightChangeLbs).toBeGreaterThan(0);
    expect(result.dailyWeightChangeLbs * 7).toBeCloseTo(0.33, 1);
    expect(result.directionMismatch).toBe(false);

    // Weight trends UP across horizons.
    const weights = result.horizons.map((h) => h.predictedWeightLbs);
    expect(weights[0]).toBeGreaterThan(176.4);
    expect(weights[weights.length - 1]).toBeGreaterThan(weights[0]);

    // Surplus-appropriate composition: gaining lean mass raises FFMI vs current.
    const currentFfmi = result.horizons[0].ffmi;
    const lastFfmi = result.horizons[result.horizons.length - 1].ffmi;
    expect(lastFfmi).not.toBeNull();
    expect(lastFfmi!).toBeGreaterThan(currentFfmi!);
  });

  it('projects a loss on a cut with a deficit target and moves BF% down', () => {
    const result = projectWeightTrajectory(
      baseInput({ phase: 'cut', targetCalories: 2400 })
    );

    expect(result.dailyWeightChangeLbs).toBeLessThan(0);
    expect(result.directionMismatch).toBe(false);

    const first = result.horizons[0];
    const last = result.horizons[result.horizons.length - 1];
    expect(last.predictedWeightLbs).toBeLessThan(first.predictedWeightLbs);
    // Deficit-appropriate composition: body fat % declines toward the horizon.
    expect(last.bodyFatPercent!).toBeLessThan(anchors.currentBodyFatPercent);
  });

  it('flags a direction mismatch when a below-TDEE target is used on a bulk', () => {
    // This is the reported bug: phase = bulk but a stale 2,558 cal target leaks
    // in against a ~2,935 TDEE -> projected LOSS while bulking.
    const result = projectWeightTrajectory(
      baseInput({ phase: 'bulk', targetCalories: 2558 })
    );

    expect(result.dailyWeightChangeLbs).toBeLessThan(0);
    expect(result.directionMismatch).toBe(true);
  });

  it('flags a direction mismatch when an above-TDEE target is used on a cut', () => {
    const result = projectWeightTrajectory(
      baseInput({ phase: 'cut', targetCalories: 3200 })
    );
    expect(result.directionMismatch).toBe(true);
  });

  it('does not flag maintenance regardless of direction', () => {
    const surplus = projectWeightTrajectory(
      baseInput({ phase: 'maintenance', targetCalories: 3100 })
    );
    const deficit = projectWeightTrajectory(
      baseInput({ phase: 'maintenance', targetCalories: 2400 })
    );
    expect(surplus.directionMismatch).toBe(false);
    expect(deficit.directionMismatch).toBe(false);
  });

  it('uses exactly the TDEE it is given (single source of truth)', () => {
    const tdee = 2935;
    const result = projectWeightTrajectory(baseInput({ tdee }));
    expect(result.tdee).toBe(tdee);
    expect(result.usedCalories).toBe(3100);
    // Sanity: the projected daily change equals (target - tdee)/3500 exactly.
    expect(result.dailyWeightChangeLbs).toBeCloseTo((3100 - tdee) / 3500, 6);
  });

  it('returns weight horizons but null composition when anchors are missing', () => {
    const result = projectWeightTrajectory(baseInput({ composition: null }));
    expect(result.horizons).toHaveLength(4);
    for (const h of result.horizons) {
      expect(h.bodyFatPercent).toBeNull();
      expect(h.ffmi).toBeNull();
      expect(typeof h.predictedWeightLbs).toBe('number');
    }
  });

  it('is pure: identical inputs (including now) yield identical output', () => {
    const a = projectWeightTrajectory(baseInput());
    const b = projectWeightTrajectory(baseInput());
    expect(a).toEqual(b);
  });

  it('grows the uncertainty margin with the horizon', () => {
    const result = projectWeightTrajectory(baseInput());
    const margins = result.horizons.map((h) => h.marginLbs);
    for (let i = 1; i < margins.length; i++) {
      expect(margins[i]).toBeGreaterThanOrEqual(margins[i - 1]);
    }
  });

  it('derives target dates from the injected now, not the wall clock', () => {
    const result = projectWeightTrajectory(baseInput());
    expect(result.horizons[0].targetDate).toBe('2026-07-18'); // now + 7
    expect(result.horizons[3].targetDate).toBe('2026-09-05'); // now + 56
  });
});

describe('projectionInputsKey (cache-bust on phase / target / TDEE change)', () => {
  const key = () =>
    projectionInputsKey({
      phase: 'cut',
      targetCalories: 2558,
      tdee: 2935,
      currentWeightLbs: 176.4,
    });

  it('busts when the phase changes cut -> bulk', () => {
    const before = key();
    const after = projectionInputsKey({
      phase: 'bulk',
      targetCalories: 2558,
      tdee: 2935,
      currentWeightLbs: 176.4,
    });
    expect(after).not.toBe(before);
  });

  it('busts when the calorie target changes', () => {
    const before = key();
    const after = projectionInputsKey({
      phase: 'cut',
      targetCalories: 3100,
      tdee: 2935,
      currentWeightLbs: 176.4,
    });
    expect(after).not.toBe(before);
  });

  it('busts when the TDEE estimate changes', () => {
    const before = key();
    const after = projectionInputsKey({
      phase: 'cut',
      targetCalories: 2558,
      tdee: 3050,
      currentWeightLbs: 176.4,
    });
    expect(after).not.toBe(before);
  });

  it('is stable when nothing relevant changes', () => {
    expect(key()).toBe(key());
  });

  it('models the reported bug: recompute after a stale cut target is replaced by the bulk target', () => {
    // Stale state: phase already flipped to bulk but the target is still the
    // old cut value -> mismatch, projected loss.
    const stale = projectWeightTrajectory({
      now: NOW,
      currentWeightLbs: 176.4,
      tdee: 2935,
      targetCalories: 2558,
      phase: 'bulk',
      standardError: 250,
      horizonDays: [7, 56],
      composition: anchors,
    });
    expect(stale.directionMismatch).toBe(true);
    expect(stale.dailyWeightChangeLbs).toBeLessThan(0);

    // After recompute with the correct bulk target, the projection flips to gain.
    const fresh = projectWeightTrajectory({
      now: NOW,
      currentWeightLbs: 176.4,
      tdee: 2935,
      targetCalories: 3100,
      phase: 'bulk',
      standardError: 250,
      horizonDays: [7, 56],
      composition: anchors,
    });
    expect(fresh.directionMismatch).toBe(false);
    expect(fresh.dailyWeightChangeLbs).toBeGreaterThan(0);

    // The cache key differs, so a memoized card would have recomputed.
    expect(
      projectionInputsKey({ phase: 'bulk', targetCalories: 2558, tdee: 2935, currentWeightLbs: 176.4 })
    ).not.toBe(
      projectionInputsKey({ phase: 'bulk', targetCalories: 3100, tdee: 2935, currentWeightLbs: 176.4 })
    );
  });
});
