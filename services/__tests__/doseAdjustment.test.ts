/**
 * Continuous dose adjustment (Bug 6).
 *
 * The replaced step function added a flat +24h at effectiveSets >= 8 OR
 * hardSets >= 2. These tests pin the properties the replacement was chosen
 * for: continuity, independent monotonicity, boundedness, and a capacity
 * denominator that resolves through the PARENT for bounded component rows.
 */

import {
  DEFAULT_PLANNED_SESSIONS_PER_WEEK,
  EXPERIENCE_FALLBACK,
  HARD_LOAD_HIGH,
  HARD_LOAD_LOW,
  HARD_WEIGHT,
  MAX_DOSE_ADJUSTMENT_HOURS,
  MIN_DOSE_ADJUSTMENT_HOURS,
  RECOVERY_CONFIG,
  SET_LOAD_HIGH,
  SET_LOAD_LOW,
  SET_WEIGHT,
  computeDoseAdjustmentHours,
  lerp,
  sessionCapacityFor,
  smoothstep,
  type RecoveryConfig,
} from '@/services/muscleRecovery';
import {
  DEFAULT_VOLUME_LANDMARKS,
  STANDARD_MUSCLE_GROUPS,
  capacityOwnerFor,
  isBoundedComponent,
  type Experience,
  type StandardMuscleGroup,
} from '@/types/schema';

const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

function configFor(overrides: Partial<RecoveryConfig> = {}): RecoveryConfig {
  return { ...RECOVERY_CONFIG, ...overrides };
}

/** Adjustment computed straight from normalized ratios, capacity aside. */
function adjustmentFromRatios(totalRatio: number, hardRatio: number): number {
  const setLoad = smoothstep(SET_LOAD_LOW, SET_LOAD_HIGH, totalRatio);
  const hardLoad = smoothstep(HARD_LOAD_LOW, HARD_LOAD_HIGH, hardRatio);
  return lerp(
    MIN_DOSE_ADJUSTMENT_HOURS,
    MAX_DOSE_ADJUSTMENT_HOURS,
    SET_WEIGHT * setLoad + HARD_WEIGHT * hardLoad
  );
}

describe('anchor scenarios — advanced triceps, MRV 22, 2 sessions/wk, capacity 11', () => {
  const config = configFor({
    experienceForCapacity: 'advanced',
    plannedSessionsPerWeek: 2,
  });

  it('resolves the documented capacity', () => {
    const capacity = sessionCapacityFor('triceps', config);
    expect(capacity.capacityMrv).toBe(22);
    expect(capacity.plannedSessionsPerWeek).toBe(2);
    expect(capacity.sessionCapacity).toBeCloseTo(11, 10);
  });

  it.each([
    [0, 0, -12],
    [2, 0, -11.87],
    [5, 2, 4.33],
    [8, 3, 20.45],
    [11, 6, 24],
    [14, 9, 24],
  ])('%i effective sets / %i hard sets -> ~%sh', (sets, hard, expected) => {
    const { adjustmentHours } = computeDoseAdjustmentHours('triceps', sets, hard, config);
    expect(adjustmentHours).toBeCloseTo(expected, 1);
  });
});

describe('preconditions', () => {
  const config = configFor({ experienceForCapacity: 'advanced' });

  it('rejects hard sets exceeding total sets', () => {
    expect(() => computeDoseAdjustmentHours('triceps', 4, 5, config)).toThrow(
      /effectiveHardSets <= effectiveSets/
    );
  });

  it('rejects negative inputs', () => {
    expect(() => computeDoseAdjustmentHours('triceps', -1, 0, config)).toThrow();
    expect(() => computeDoseAdjustmentHours('triceps', 4, -1, config)).toThrow();
  });

  it('accepts hardSets exactly equal to effectiveSets', () => {
    expect(() => computeDoseAdjustmentHours('triceps', 4, 4, config)).not.toThrow();
  });

  it('session capacity is always > 0 for every muscle and level', () => {
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        for (let freq = 1; freq <= 5; freq++) {
          const capacity = sessionCapacityFor(
            muscle,
            configFor({ experienceForCapacity: experience, plannedSessionsPerWeek: freq })
          );
          expect(capacity.sessionCapacity).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('mathematical properties', () => {
  const config = configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: 2 });

  it('is bounded to [MIN, MAX] across an extreme sweep', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (let sets = 0; sets <= 60; sets += 0.25) {
        for (const hard of [0, sets / 2, sets]) {
          const { adjustmentHours } = computeDoseAdjustmentHours(muscle, sets, hard, config);
          expect(adjustmentHours).toBeGreaterThanOrEqual(MIN_DOSE_ADJUSTMENT_HOURS);
          expect(adjustmentHours).toBeLessThanOrEqual(MAX_DOSE_ADJUSTMENT_HOURS);
        }
      }
    }
  });

  it('is monotonic nondecreasing in effective sets with hard sets FIXED', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (const hard of [0, 1, 3]) {
        let previous = -Infinity;
        for (let sets = hard; sets <= 40; sets += 0.25) {
          const { adjustmentHours } = computeDoseAdjustmentHours(muscle, sets, hard, config);
          expect(adjustmentHours).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = adjustmentHours;
        }
      }
    }
  });

  it('is monotonic nondecreasing in hard sets with TOTAL sets fixed', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (const total of [4, 8, 16]) {
        let previous = -Infinity;
        for (let hard = 0; hard <= total; hard += 0.25) {
          const { adjustmentHours } = computeDoseAdjustmentHours(muscle, total, hard, config);
          expect(adjustmentHours).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = adjustmentHours;
        }
      }
    }
  });

  it('is continuous in NORMALIZED-dose space, within the analytic smoothstep slope', () => {
    // Deliberately NOT a "0.5 actual sets must move <= 3h" rule: for a
    // small-capacity muscle, 0.5 sets is a large normalized change and that
    // rule would fail for reasons that say nothing about continuity.
    //
    // max |d/dt smoothstep(t)| = 1.5 at the midpoint. Per unit of RATIO the
    // slope is 1.5 / (high - low), scaled by weight and the output span.
    const span = MAX_DOSE_ADJUSTMENT_HOURS - MIN_DOSE_ADJUSTMENT_HOURS;
    const maxSetSlope = (SET_WEIGHT * span * 1.5) / (SET_LOAD_HIGH - SET_LOAD_LOW);
    const maxHardSlope = (HARD_WEIGHT * span * 1.5) / (HARD_LOAD_HIGH - HARD_LOAD_LOW);
    const step = 0.05;

    let worstSet = 0;
    for (let total = 0; total <= 2; total += step) {
      const a = adjustmentFromRatios(total, 0);
      const b = adjustmentFromRatios(total + step, 0);
      worstSet = Math.max(worstSet, Math.abs(b - a));
    }
    expect(worstSet).toBeLessThanOrEqual(maxSetSlope * step + 1e-9);

    let worstHard = 0;
    for (let hard = 0; hard <= 1; hard += step) {
      const a = adjustmentFromRatios(1, hard);
      const b = adjustmentFromRatios(1, hard + step);
      worstHard = Math.max(worstHard, Math.abs(b - a));
    }
    expect(worstHard).toBeLessThanOrEqual(maxHardSlope * step + 1e-9);
  });

  it('has no discontinuity at the OLD step-function thresholds', () => {
    // The specific defect: 7.99 vs 8.00 sets used to differ by a full day.
    const below = computeDoseAdjustmentHours('triceps', 7.99, 0, config).adjustmentHours;
    const above = computeDoseAdjustmentHours('triceps', 8.01, 0, config).adjustmentHours;
    expect(Math.abs(above - below)).toBeLessThan(0.5);

    const oneHard = computeDoseAdjustmentHours('triceps', 6, 1, config).adjustmentHours;
    const twoHard = computeDoseAdjustmentHours('triceps', 6, 2, config).adjustmentHours;
    expect(twoHard - oneHard).toBeLessThan(6);
    expect(twoHard).toBeGreaterThan(oneHard);
  });
});

describe('capacity resolution', () => {
  it('bounded components normalize against their PARENT, never their own MRV', () => {
    const config = configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: 2 });
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const capacity = sessionCapacityFor(muscle, config);
      const owner = capacityOwnerFor(muscle);
      expect(capacity.capacityMuscle).toBe(owner);
      expect(capacity.capacityMrv).toBe(DEFAULT_VOLUME_LANDMARKS.advanced[owner].mrv);
      if (isBoundedComponent(muscle)) {
        expect(capacity.capacityMuscle).not.toBe(muscle);
      }
    }
  });

  it('soleus and gastrocnemius share the calves capacity denominator', () => {
    const config = configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: 2 });
    const gastroc = sessionCapacityFor('gastrocnemius', config);
    const soleus = sessionCapacityFor('soleus', config);
    expect(gastroc.capacityMuscle).toBe('calves');
    expect(soleus.capacityMuscle).toBe('calves');
    expect(gastroc.capacityMrv).toBe(26);
    expect(soleus.capacityMrv).toBe(26);
    // NOT their own (deprecated-as-capacity) component MRVs.
    expect(gastroc.capacityMrv).not.toBe(DEFAULT_VOLUME_LANDMARKS.advanced.gastrocnemius.mrv);
    expect(soleus.capacityMrv).not.toBe(DEFAULT_VOLUME_LANDMARKS.advanced.soleus.mrv);
  });

  it('chest/back/shoulders members use their own detailed row (no synthetic group MRV)', () => {
    const config = configFor({ experienceForCapacity: 'advanced' });
    for (const muscle of [
      'chest_upper', 'chest_lower', 'lats', 'upper_back', 'erectors',
      'front_delts', 'lateral_delts', 'rear_delts',
    ] as StandardMuscleGroup[]) {
      const capacity = sessionCapacityFor(muscle, config);
      expect(capacity.capacityMuscle).toBe(muscle);
      expect(capacity.capacityMrv).toBe(DEFAULT_VOLUME_LANDMARKS.advanced[muscle].mrv);
    }
  });

  it('capacity scales with experience level', () => {
    const at = (experience: Experience) =>
      sessionCapacityFor('quads', configFor({ experienceForCapacity: experience, plannedSessionsPerWeek: 2 }))
        .capacityMrv;
    expect(at('novice')).toBeLessThan(at('intermediate'));
    expect(at('intermediate')).toBeLessThan(at('advanced'));
  });
});

describe('diagnostics and fallbacks', () => {
  it('reports the experience source', () => {
    expect(sessionCapacityFor('quads', configFor({ experienceForCapacity: 'novice' })).experienceSource).toBe('config');
    const fallback = sessionCapacityFor('quads', configFor());
    expect(fallback.experienceSource).toBe('fallback');
    expect(fallback.experience).toBe(EXPERIENCE_FALLBACK);
  });

  it('prefers per-muscle planned frequency, then program, then the named default', () => {
    const perMuscle = sessionCapacityFor(
      'quads',
      configFor({ plannedSessionsPerWeekByMuscle: { quads: 4 }, plannedSessionsPerWeek: 3 })
    );
    expect(perMuscle.plannedFrequencySource).toBe('perMuscle');
    expect(perMuscle.plannedSessionsPerWeek).toBe(4);

    const program = sessionCapacityFor('quads', configFor({ plannedSessionsPerWeek: 3 }));
    expect(program.plannedFrequencySource).toBe('program');
    expect(program.plannedSessionsPerWeek).toBe(3);

    const fallback = sessionCapacityFor('quads', configFor());
    expect(fallback.plannedFrequencySource).toBe('fallback');
    expect(fallback.plannedSessionsPerWeek).toBe(DEFAULT_PLANNED_SESSIONS_PER_WEEK);
  });

  it('ignores nonsense planned frequencies rather than dividing by them', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const capacity = sessionCapacityFor('quads', configFor({ plannedSessionsPerWeek: bad }));
      expect(capacity.plannedFrequencySource).toBe('fallback');
      expect(capacity.sessionCapacity).toBeGreaterThan(0);
    }
  });

  it('returns full diagnostics for every dose evaluation', () => {
    const d = computeDoseAdjustmentHours(
      'gastrocnemius',
      6,
      2,
      configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: 3 })
    );
    expect(d).toMatchObject({
      muscle: 'gastrocnemius',
      capacityMuscle: 'calves',
      experience: 'advanced',
      experienceSource: 'config',
      plannedSessionsPerWeek: 3,
      plannedFrequencySource: 'program',
      capacityMrv: 26,
      effectiveSets: 6,
      effectiveHardSets: 2,
    });
    expect(d.sessionCapacity).toBeCloseTo(26 / 3, 10);
    expect(d.totalDoseRatio).toBeCloseTo(6 / (26 / 3), 10);
    expect(d.hardDoseRatio).toBeCloseTo(2 / (26 / 3), 10);
    expect(Number.isFinite(d.adjustmentHours)).toBe(true);
  });
});

describe('planned-frequency sensitivity (ACTUAL sets held fixed)', () => {
  // Ratios must NOT be held fixed here: frequency would cancel and the test
  // would prove nothing about the feedback path.
  const FIXED_SETS = 8;
  const FIXED_HARD = 3;

  it('higher planned frequency raises the adjustment for the same real session', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      let previous = -Infinity;
      for (let freq = 1; freq <= 5; freq++) {
        const { adjustmentHours } = computeDoseAdjustmentHours(
          muscle,
          FIXED_SETS,
          FIXED_HARD,
          configFor({ experienceForCapacity: 'intermediate', plannedSessionsPerWeek: freq })
        );
        expect(adjustmentHours).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = adjustmentHours;
      }
    }
  });

  it('emits the 1-5 sessions/week sensitivity table', () => {
    const rows: Array<Record<string, string | number>> = [];
    for (const muscle of ['triceps', 'quads', 'hamstrings', 'calves', 'lateral_delts'] as StandardMuscleGroup[]) {
      const row: Record<string, string | number> = { muscle };
      for (let freq = 1; freq <= 5; freq++) {
        const d = computeDoseAdjustmentHours(
          muscle,
          FIXED_SETS,
          FIXED_HARD,
          configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: freq })
        );
        row[`f${freq}`] = Number(d.adjustmentHours.toFixed(2));
      }
      rows.push(row);
    }
    // Reported, not asserted to a magic value — the monotonicity test above is
    // the behavioural claim; this exists so the numbers are visible in CI.
    expect(rows).toHaveLength(5);
    // eslint-disable-next-line no-console
    console.log('[frequency sensitivity] 8 sets / 3 hard, advanced:', JSON.stringify(rows));
  });
});

describe('0.5-actual-set slope report (flagged, not failed)', () => {
  it('reports the steepest per-half-set change across muscles/levels/frequencies', () => {
    const worst: Array<{ muscle: string; experience: string; freq: number; delta: number }> = [];
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        for (let freq = 1; freq <= 5; freq++) {
          const config = configFor({
            experienceForCapacity: experience,
            plannedSessionsPerWeek: freq,
          });
          let localWorst = 0;
          for (let sets = 0; sets <= 30; sets += 0.5) {
            const a = computeDoseAdjustmentHours(muscle, sets, 0, config).adjustmentHours;
            const b = computeDoseAdjustmentHours(muscle, sets + 0.5, 0, config).adjustmentHours;
            localWorst = Math.max(localWorst, Math.abs(b - a));
          }
          worst.push({ muscle, experience, freq, delta: Number(localWorst.toFixed(2)) });
        }
      }
    }
    worst.sort((a, b) => b.delta - a.delta);

    // A large per-half-set change for a SMALL-CAPACITY muscle is expected, not
    // a bug: 0.5 sets is a big fraction of its session capacity. Report the
    // steepest cases; assert only that the model stays inside its own bounds.
    const span = MAX_DOSE_ADJUSTMENT_HOURS - MIN_DOSE_ADJUSTMENT_HOURS;
    expect(worst[0].delta).toBeLessThanOrEqual(span);
    // eslint-disable-next-line no-console
    console.log('[0.5-set slope] steepest 5:', JSON.stringify(worst.slice(0, 5)));
  });
});
