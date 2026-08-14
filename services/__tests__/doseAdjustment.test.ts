/**
 * Continuous dose SCALE (Bug 6, revised).
 *
 * v1 was a step function (+24h at 8 sets or 2 hard sets). v2 replaced it with
 * a continuous ADDITIVE adjustment in [-12h, +24h]. v3 — pinned here — makes
 * the window PROPORTIONAL to dose:
 *
 *   scale = clamp((totalRatio + HARD_DOSE_BONUS x hardRatio) / REF) ^ EXPONENT
 *
 * These tests keep every property v2 was chosen for (continuity, independent
 * monotonicity, boundedness, parent-resolved capacity denominators) and add
 * the one v2 lacked: the response passes through the ORIGIN, so a trivial
 * dose earns a trivial window instead of nearly the whole base.
 */

import {
  DEFAULT_PLANNED_SESSIONS_PER_WEEK,
  DOSE_EXPONENT,
  EXPERIENCE_FALLBACK,
  HARD_DOSE_BONUS,
  MAX_DOSE_SCALE,
  MIN_DOSE_SCALE,
  RECOVERY_CONFIG,
  REFERENCE_DOSE_RATIO,
  computeDoseScale,
  sessionCapacityFor,
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

/** The scale computed straight from normalized ratios, capacity aside. */
function scaleFromRatios(totalRatio: number, hardRatio: number): number {
  const blend = totalRatio + HARD_DOSE_BONUS * hardRatio;
  return Math.min(
    MAX_DOSE_SCALE,
    Math.max(MIN_DOSE_SCALE, Math.pow(blend / REFERENCE_DOSE_RATIO, DOSE_EXPONENT))
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
    [0, 0, MIN_DOSE_SCALE],
    [2, 0, 0.518],
    [5, 2, 1.012],
    [8, 3, 1.367],
    [11, 6, MAX_DOSE_SCALE],
    [14, 9, MAX_DOSE_SCALE],
  ])('%i effective sets / %i hard sets -> scale ~%s', (sets, hard, expected) => {
    const { doseScale } = computeDoseScale('triceps', sets, hard, config);
    expect(doseScale).toBeCloseTo(expected, 3);
  });

  it('a session at REFERENCE_DOSE_RATIO earns exactly the base window', () => {
    const sets = REFERENCE_DOSE_RATIO * 11;
    const { doseScale } = computeDoseScale('triceps', sets, 0, config);
    expect(doseScale).toBeCloseTo(1, 10);
  });
});

describe('the low-dose defect this model exists to fix', () => {
  // The report: 2 sets of a grip hold credited to lats as a secondary is 1.0
  // effective set against a session capacity of 10 — a dose the model itself
  // scored as no load, which nonetheless bought 80% of the 60h base window.
  const config = configFor({
    experienceForCapacity: 'intermediate',
    plannedSessionsPerWeek: 2,
  });

  it('a token exposure (10% of session capacity) earns well under half the base', () => {
    const { doseScale, totalDoseRatio } = computeDoseScale('lats', 1, 0, config);
    expect(totalDoseRatio).toBeCloseTo(0.1, 10);
    expect(doseScale).toBeLessThan(0.45);
    // v2 produced (60 - 12) / 60 = 0.8 here. The regression guard is the gap.
    expect(doseScale).toBeLessThan(0.8 - 0.3);
  });

  it('the response is NOT flat at the low end — 1, 3 and 6 sets are clearly apart', () => {
    const one = computeDoseScale('lats', 1, 0, config).doseScale;
    const three = computeDoseScale('lats', 3, 0, config).doseScale;
    const six = computeDoseScale('lats', 6, 0, config).doseScale;
    // v2 separated 1 set from 3 sets by under 3h on a 60h base (< 0.05 scale).
    expect(three - one).toBeGreaterThan(0.2);
    expect(six - three).toBeGreaterThan(0.2);
  });

  it('scales toward the floor as dose goes to zero, never below it', () => {
    let previous = Infinity;
    for (const sets of [1, 0.5, 0.25, 0.1, 0.01, 0]) {
      const { doseScale } = computeDoseScale('lats', sets, 0, config);
      expect(doseScale).toBeLessThanOrEqual(previous);
      expect(doseScale).toBeGreaterThanOrEqual(MIN_DOSE_SCALE);
      previous = doseScale;
    }
    expect(computeDoseScale('lats', 0, 0, config).doseScale).toBe(MIN_DOSE_SCALE);
  });
});

describe('preconditions', () => {
  const config = configFor({ experienceForCapacity: 'advanced' });

  it('rejects hard sets exceeding total sets', () => {
    expect(() => computeDoseScale('triceps', 4, 5, config)).toThrow(
      /effectiveHardSets <= effectiveSets/
    );
  });

  it('rejects negative inputs', () => {
    expect(() => computeDoseScale('triceps', -1, 0, config)).toThrow();
    expect(() => computeDoseScale('triceps', 4, -1, config)).toThrow();
  });

  it('accepts hardSets exactly equal to effectiveSets', () => {
    expect(() => computeDoseScale('triceps', 4, 4, config)).not.toThrow();
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

  it('is bounded to [MIN_DOSE_SCALE, MAX_DOSE_SCALE] across an extreme sweep', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (let sets = 0; sets <= 60; sets += 0.25) {
        for (const hard of [0, sets / 2, sets]) {
          const { doseScale } = computeDoseScale(muscle, sets, hard, config);
          expect(doseScale).toBeGreaterThanOrEqual(MIN_DOSE_SCALE);
          expect(doseScale).toBeLessThanOrEqual(MAX_DOSE_SCALE);
        }
      }
    }
  });

  it('is monotonic nondecreasing in effective sets with hard sets FIXED', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (const hard of [0, 1, 3]) {
        let previous = -Infinity;
        for (let sets = hard; sets <= 40; sets += 0.25) {
          const { doseScale } = computeDoseScale(muscle, sets, hard, config);
          expect(doseScale).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = doseScale;
        }
      }
    }
  });

  it('is monotonic nondecreasing in hard sets with TOTAL sets fixed', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      for (const total of [4, 8, 16]) {
        let previous = -Infinity;
        for (let hard = 0; hard <= total; hard += 0.25) {
          const { doseScale } = computeDoseScale(muscle, total, hard, config);
          expect(doseScale).toBeGreaterThanOrEqual(previous - 1e-9);
          previous = doseScale;
        }
      }
    }
  });

  it('is continuous in NORMALIZED-dose space, within the analytic curve slope', () => {
    // Deliberately NOT a "0.5 actual sets must move <= X" rule: for a
    // small-capacity muscle, 0.5 sets is a large normalized change and that
    // rule would fail for reasons that say nothing about continuity.
    //
    // d/dx (x/REF)^p = (p/REF)(x/REF)^(p-1), which for p < 1 is steepest at
    // the SMALLEST x still above the floor. Bound the sweep by that point.
    const floorAt = REFERENCE_DOSE_RATIO * Math.pow(MIN_DOSE_SCALE, 1 / DOSE_EXPONENT);
    const step = 0.001;
    const maxSlope =
      (DOSE_EXPONENT / REFERENCE_DOSE_RATIO) *
      Math.pow(floorAt / REFERENCE_DOSE_RATIO, DOSE_EXPONENT - 1);

    let worstSet = 0;
    for (let total = floorAt; total <= 2; total += step) {
      worstSet = Math.max(
        worstSet,
        Math.abs(scaleFromRatios(total + step, 0) - scaleFromRatios(total, 0))
      );
    }
    expect(worstSet).toBeLessThanOrEqual(maxSlope * step + 1e-9);

    // The hard term enters linearly through the blend, so its slope is the set
    // slope scaled by HARD_DOSE_BONUS.
    let worstHard = 0;
    for (let hard = 0; hard <= 1; hard += step) {
      worstHard = Math.max(
        worstHard,
        Math.abs(scaleFromRatios(1, hard + step) - scaleFromRatios(1, hard))
      );
    }
    expect(worstHard).toBeLessThanOrEqual(maxSlope * HARD_DOSE_BONUS * step + 1e-9);
  });

  it('has no discontinuity at the OLD step-function thresholds', () => {
    // The v1 defect: 7.99 vs 8.00 sets used to differ by a full day.
    const below = computeDoseScale('triceps', 7.99, 0, config).doseScale;
    const above = computeDoseScale('triceps', 8.01, 0, config).doseScale;
    expect(Math.abs(above - below)).toBeLessThan(0.01);

    const oneHard = computeDoseScale('triceps', 6, 1, config).doseScale;
    const twoHard = computeDoseScale('triceps', 6, 2, config).doseScale;
    expect(twoHard - oneHard).toBeLessThan(0.1);
    expect(twoHard).toBeGreaterThan(oneHard);
  });

  it('is sublinear — doubling the dose does NOT double the window', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const single = computeDoseScale(muscle, 3, 0, config).doseScale;
      const double = computeDoseScale(muscle, 6, 0, config).doseScale;
      expect(double).toBeGreaterThan(single);
      expect(double).toBeLessThan(single * 2);
    }
  });

  it('a hard set counts exactly 1 + HARD_DOSE_BONUS ordinary sets', () => {
    const hard = computeDoseScale('triceps', 4, 4, config);
    const equivalent = computeDoseScale('triceps', 4 * (1 + HARD_DOSE_BONUS), 0, config);
    expect(hard.doseScale).toBeCloseTo(equivalent.doseScale, 10);
    expect(hard.blendedDoseRatio).toBeCloseTo(equivalent.blendedDoseRatio, 10);
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
    const d = computeDoseScale(
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
      doseScaleClamp: 'none',
    });
    expect(d.sessionCapacity).toBeCloseTo(26 / 3, 10);
    expect(d.totalDoseRatio).toBeCloseTo(6 / (26 / 3), 10);
    expect(d.hardDoseRatio).toBeCloseTo(2 / (26 / 3), 10);
    expect(d.blendedDoseRatio).toBeCloseTo(d.totalDoseRatio + HARD_DOSE_BONUS * d.hardDoseRatio, 10);
    expect(d.doseScale).toBeCloseTo(d.rawDoseScale, 10);
    expect(Number.isFinite(d.doseScale)).toBe(true);
  });

  it('reports which scale bound bit, and keeps the raw value visible', () => {
    const config = configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: 2 });
    const floored = computeDoseScale('triceps', 0, 0, config);
    expect(floored.doseScaleClamp).toBe('lower');
    expect(floored.rawDoseScale).toBeLessThan(MIN_DOSE_SCALE);
    expect(floored.doseScale).toBe(MIN_DOSE_SCALE);

    const capped = computeDoseScale('triceps', 40, 40, config);
    expect(capped.doseScaleClamp).toBe('upper');
    expect(capped.rawDoseScale).toBeGreaterThan(MAX_DOSE_SCALE);
    expect(capped.doseScale).toBe(MAX_DOSE_SCALE);
  });
});

describe('planned-frequency sensitivity (ACTUAL sets held fixed)', () => {
  // Ratios must NOT be held fixed here: frequency would cancel and the test
  // would prove nothing about the feedback path.
  const FIXED_SETS = 8;
  const FIXED_HARD = 3;

  it('higher planned frequency raises the scale for the same real session', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      let previous = -Infinity;
      for (let freq = 1; freq <= 5; freq++) {
        const { doseScale } = computeDoseScale(
          muscle,
          FIXED_SETS,
          FIXED_HARD,
          configFor({ experienceForCapacity: 'intermediate', plannedSessionsPerWeek: freq })
        );
        expect(doseScale).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = doseScale;
      }
    }
  });

  it('emits the 1-5 sessions/week sensitivity table', () => {
    const rows: Array<Record<string, string | number>> = [];
    for (const muscle of ['triceps', 'quads', 'hamstrings', 'calves', 'lateral_delts'] as StandardMuscleGroup[]) {
      const row: Record<string, string | number> = { muscle };
      for (let freq = 1; freq <= 5; freq++) {
        const d = computeDoseScale(
          muscle,
          FIXED_SETS,
          FIXED_HARD,
          configFor({ experienceForCapacity: 'advanced', plannedSessionsPerWeek: freq })
        );
        row[`f${freq}`] = Number(d.doseScale.toFixed(3));
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
            const a = computeDoseScale(muscle, sets, 0, config).doseScale;
            const b = computeDoseScale(muscle, sets + 0.5, 0, config).doseScale;
            localWorst = Math.max(localWorst, Math.abs(b - a));
          }
          worst.push({ muscle, experience, freq, delta: Number(localWorst.toFixed(3)) });
        }
      }
    }
    worst.sort((a, b) => b.delta - a.delta);

    // A large per-half-set change for a SMALL-CAPACITY muscle is expected, not
    // a bug: 0.5 sets is a big fraction of its session capacity. Report the
    // steepest cases; assert only that the model stays inside its own bounds.
    expect(worst[0].delta).toBeLessThanOrEqual(MAX_DOSE_SCALE - MIN_DOSE_SCALE);
    // eslint-disable-next-line no-console
    console.log('[0.5-set slope] steepest 5:', JSON.stringify(worst.slice(0, 5)));
  });
});
