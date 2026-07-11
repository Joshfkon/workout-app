/**
 * Unit tests for the interval-based adaptive TDEE estimator.
 *
 * These exercise the physics and behavioral contracts from the design:
 * a useful answer from day zero, a smooth (non-discontinuous) blend, correct
 * handling of sparse weigh-ins, intake-completeness gating, phase-transition
 * exclusion, and noise robustness.
 */

import {
  estimateIntervalTDEE,
  computeTrendWeights,
  detectPhaseBoundaries,
  type WeighIn,
  type IntakeDay,
} from '../interval-tdee';

const NOW = '2026-02-01';

/** Build a date string offset by `n` days from a base date. */
function dateAt(base: string, n: number): string {
  const d = new Date(`${base}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Generate daily intake at a fixed level over [startOffset, endOffset). */
function dailyIntake(
  startBase: string,
  startOffset: number,
  endOffset: number,
  calories: number
): IntakeDay[] {
  const out: IntakeDay[] = [];
  for (let k = startOffset; k < endOffset; k++) {
    out.push({ date: dateAt(startBase, k), calories });
  }
  return out;
}

describe('estimateIntervalTDEE — day zero', () => {
  it('returns the formula TDEE with prior-only weighting and never null/locked', () => {
    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns: [],
      intakeDays: [],
      formulaTDEE: 2500,
      formulaWeightLb: 180,
    });

    expect(result).not.toBeNull();
    expect(result.estimatedTDEE).toBe(2500);
    expect(result.source).toBe('formula');
    expect(result.priorWeight).toBe(1);
    expect(result.observedTDEE).toBeNull();
    expect(result.personalizationLabel).toBe('Formula estimate');
    // Low confidence, but a real answer — not zero, not "collecting data".
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeLessThan(40);
  });
});

describe('estimateIntervalTDEE — blend progression is monotonic and continuous', () => {
  it('drifts monotonically from the prior toward the true TDEE with no jump', () => {
    // Prior 2900, true TDEE 2600. Maintenance-ish intake 2600 with flat weight
    // over each interval → each interval observes ~2600.
    const formulaTDEE = 2900;
    const trueTDEE = 2600;

    // Build a long series of weigh-ins every 6 days at constant weight (true
    // maintenance) with daily intake at trueTDEE.
    const totalDays = 60;
    const intakeDays = dailyIntake(NOW, -totalDays, 0, trueTDEE);
    const allWeighIns: WeighIn[] = [];
    for (let k = -totalDays; k <= 0; k += 6) {
      allWeighIns.push({ date: dateAt(NOW, k), weightLb: 180 });
    }

    const estimates: number[] = [];
    // Feed intervals in one at a time by revealing more weigh-ins.
    for (let n = 1; n <= allWeighIns.length; n++) {
      const result = estimateIntervalTDEE({
        now: NOW,
        weighIns: allWeighIns.slice(0, n),
        intakeDays,
        formulaTDEE,
        formulaWeightLb: 180,
      });
      estimates.push(result.estimatedTDEE);
    }

    // Starts at the prior.
    expect(estimates[0]).toBe(formulaTDEE);
    // Monotonically non-increasing (drifts down toward 2600).
    for (let i = 1; i < estimates.length; i++) {
      expect(estimates[i]).toBeLessThanOrEqual(estimates[i - 1] + 1);
    }
    // No discontinuous jump between consecutive states.
    for (let i = 1; i < estimates.length; i++) {
      expect(Math.abs(estimates[i] - estimates[i - 1])).toBeLessThan(150);
    }
    // Ends much closer to the truth than the prior.
    const final = estimates[estimates.length - 1];
    expect(final).toBeLessThan(2750);
    expect(final).toBeGreaterThan(trueTDEE - 100);
  });
});

describe('estimateIntervalTDEE — daily intake, sparse weigh-ins, real surplus', () => {
  it('21 days at 3000 kcal with +0.5 lb/wk trend → TDEE ≈ 2750, high confidence', () => {
    // +0.5 lb/week surplus = 0.5 * 3500 / 7 = 250 cal/day surplus.
    // TDEE = 3000 - 250 = 2750.
    const intakeDays = dailyIntake(NOW, -21, 0, 3000);

    // Weigh-ins every 3–4 days over 21 days, gaining 0.5 lb/week.
    const weighIns: WeighIn[] = [];
    const offsets = [-21, -18, -14, -11, -7, -4, 0];
    const startWeight = 180;
    for (const off of offsets) {
      const weeks = (off + 21) / 7;
      weighIns.push({ date: dateAt(NOW, off), weightLb: startWeight + 0.5 * weeks });
    }

    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2400, // deliberately off — data should pull the estimate up
      formulaWeightLb: 181,
    });

    expect(result.source).toBe('blended');
    expect(result.estimatedTDEE).toBeGreaterThan(2650);
    expect(result.estimatedTDEE).toBeLessThan(2850);
    expect(result.confidenceScore).toBeGreaterThan(70);
  });
});

describe('estimateIntervalTDEE — incomplete intake', () => {
  it('40% of intake days missing → intervals excluded, low confidence, names food logging', () => {
    // Same weigh-ins as the good case, but drop 40% of intake days.
    const full = dailyIntake(NOW, -21, 0, 3000);
    const intakeDays = full.filter((_, i) => i % 5 >= 2); // keep ~60%

    const weighIns: WeighIn[] = [];
    const offsets = [-21, -18, -14, -11, -7, -4, 0];
    for (const off of offsets) {
      weighIns.push({ date: dateAt(NOW, off), weightLb: 180 });
    }

    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2500,
      formulaWeightLb: 180,
    });

    // Intervals excluded for incomplete intake → prior-dominant.
    expect(result.intervalsUsed).toBe(0);
    expect(result.priorWeight).toBe(1);
    expect(result.confidenceScore).toBeLessThan(40);
    expect(result.warnings.some((w) => w.kind === 'missing_calories')).toBe(true);
  });
});

describe('estimateIntervalTDEE — single weigh-in', () => {
  it('no interval possible → formula-dominant, warns to weigh in', () => {
    const intakeDays = dailyIntake(NOW, -21, 0, 3000);
    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns: [{ date: dateAt(NOW, -10), weightLb: 180 }],
      intakeDays,
      formulaTDEE: 2500,
      formulaWeightLb: 180,
    });

    expect(result.source).toBe('formula');
    expect(result.estimatedTDEE).toBe(2500);
    expect(result.warnings.some((w) => w.kind === 'missing_weight')).toBe(true);
  });
});

// Shared fixture for the phase-transition scenario: 30 days of maintenance
// intake at 2600, a cut→bulk change on day -20 with a 4 lb water jump over the
// following 5 days, then a stable higher level. Without phase handling the
// boundary interval reads intake 2600 - (4*3500/5) ≈ -200 → an absurd collapse.
function phaseScenario() {
  const intakeDays = dailyIntake(NOW, -30, 0, 2600);
  const weighIns: WeighIn[] = [];
  for (let k = -30; k <= -20; k += 5) weighIns.push({ date: dateAt(NOW, k), weightLb: 180 });
  weighIns.push({ date: dateAt(NOW, -15), weightLb: 184 }); // water jump
  for (let k = -10; k <= 0; k += 5) weighIns.push({ date: dateAt(NOW, k), weightLb: 184 });
  return { intakeDays, weighIns };
}

describe('estimateIntervalTDEE — phase transition from the phase setting', () => {
  it('an explicit boundary excludes the water-jump window, no TDEE collapse', () => {
    const { intakeDays, weighIns } = phaseScenario();
    const withPhase = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2600,
      formulaWeightLb: 182,
      phaseChanges: [dateAt(NOW, -20)],
      // Isolate the setting-driven path from data-driven detection.
      options: { detectPhaseChangesFromData: false },
    });

    expect(withPhase.estimatedTDEE).toBeGreaterThan(2300);
    expect(withPhase.warnings.some((w) => w.kind === 'phase_transition')).toBe(true);

    // With no boundary at all, the jump interval drags the estimate far lower.
    const noHandling = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2600,
      formulaWeightLb: 182,
      options: { detectPhaseChangesFromData: false },
    });
    expect(withPhase.estimatedTDEE).toBeGreaterThan(noHandling.estimatedTDEE);
  });
});

describe('estimateIntervalTDEE — phase transition inferred from the data', () => {
  it('detects the boundary with no phase setting and avoids the collapse', () => {
    const { intakeDays, weighIns } = phaseScenario();

    // No phaseChanges passed — detection is on by default.
    const detected = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2600,
      formulaWeightLb: 182,
    });

    expect(detected.inferredPhaseChanges).toContain(dateAt(NOW, -20));
    expect(detected.estimatedTDEE).toBeGreaterThan(2300);
    expect(detected.warnings.some((w) => w.kind === 'phase_transition')).toBe(true);

    // Turning detection off (and passing no setting) lets it collapse — proving
    // the data-driven detector is what prevents the crash here.
    const undetected = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      formulaTDEE: 2600,
      formulaWeightLb: 182,
      options: { detectPhaseChangesFromData: false },
    });
    expect(detected.estimatedTDEE).toBeGreaterThan(undetected.estimatedTDEE);
  });

  it('does NOT flag reverting scale noise as a phase change', () => {
    // ±1.5 lb noise around a flat 200 lb, daily intake at maintenance. Steps
    // are small and revert, so nothing should be inferred.
    const intakeDays = dailyIntake(NOW, -42, 0, 2700);
    const noise = [0.8, -1.3, 1.5, -0.6, 1.1, -1.5, 0.4, -0.9, 1.2, -1.1, 0.6, -0.3, 1.4, -1.2, 0.9];
    const weighIns: WeighIn[] = [];
    let idx = 0;
    for (let k = -42; k <= 0; k += 3) {
      weighIns.push({ date: dateAt(NOW, k), weightLb: 200 + noise[idx % noise.length] });
      idx++;
    }

    const intakeMap = new Map(intakeDays.map((d) => [d.date, d.calories]));
    expect(detectPhaseBoundaries(weighIns, intakeMap, 200, 0.85)).toEqual([]);
  });
});

describe('estimateIntervalTDEE — noise robustness', () => {
  it('±1.5 lb weigh-in noise stays within ~150 kcal of truth via trend smoothing', () => {
    // True maintenance at 2700, flat weight 200 lb, daily intake 2700.
    const trueTDEE = 2700;
    const intakeDays = dailyIntake(NOW, -42, 0, trueTDEE);

    // Deterministic pseudo-noise (±1.5 lb) so the test is stable.
    const noise = [0.8, -1.3, 1.5, -0.6, 1.1, -1.5, 0.4, -0.9, 1.2, -1.1, 0.6, -0.3, 1.4, -1.2, 0.9];
    const weighIns: WeighIn[] = [];
    let idx = 0;
    for (let k = -42; k <= 0; k += 3) {
      weighIns.push({ date: dateAt(NOW, k), weightLb: 200 + noise[idx % noise.length] });
      idx++;
    }

    const result = estimateIntervalTDEE({
      now: NOW,
      weighIns,
      intakeDays,
      // Prior deliberately off-target: staying within 150 kcal of the truth
      // requires the observed intervals to survive (i.e. NOT be falsely excluded
      // as noise-driven phase boundaries) and pull the estimate toward 2700.
      formulaTDEE: 2450,
      formulaWeightLb: 200,
    });

    expect(result.inferredPhaseChanges).toEqual([]);
    expect(Math.abs(result.estimatedTDEE - trueTDEE)).toBeLessThan(150);
  });
});

describe('computeTrendWeights', () => {
  it('smooths a single spike toward the surrounding trend', () => {
    const weighIns: WeighIn[] = [
      { date: dateAt(NOW, -12), weightLb: 180 },
      { date: dateAt(NOW, -9), weightLb: 180 },
      { date: dateAt(NOW, -6), weightLb: 185 }, // spike
      { date: dateAt(NOW, -3), weightLb: 180 },
      { date: dateAt(NOW, 0), weightLb: 180 },
    ];
    const trend = computeTrendWeights(weighIns);
    const spike = trend.find((t) => t.raw === 185)!;
    // The trend at the spike is pulled well below the raw 185.
    expect(spike.trend).toBeLessThan(184);
    expect(spike.trend).toBeGreaterThan(180);
  });
});
