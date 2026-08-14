/**
 * Recovery-window guardrails and saturation (Bug 7).
 *
 * The 24–120h clamp is a PRODUCT guardrail, not evidence the upstream model is
 * calibrated — so the ordinary grid is measured FROM THE IMPLEMENTATION and
 * gated at 5%. If that gate ever trips, the fix is the model, not a wider
 * clamp.
 */

import {
  RECOVERY_CONFIG,
  RECOVERY_MULTIPLIER_BOUNDS,
  RECOVERY_WINDOW_BOUNDS_HOURS,
  clampRecoveryMultiplier,
  computeMuscleRecovery,
  getRecoveryClampEvents,
  resetRecoveryClampEvents,
  summarizeClamps,
  windowBreakdownForSession,
  type RecoveryConfig,
  type WindowBreakdown,
} from '@/services/muscleRecovery';
import { ENHANCED_RECOVERY_MULTIPLIER } from '@/services/shared/fatigueConstants';
import {
  STANDARD_MUSCLE_GROUPS,
  capacityOwnerFor,
  DEFAULT_VOLUME_LANDMARKS,
  type Experience,
  type StandardMuscleGroup,
} from '@/types/schema';

// ---------------------------------------------------------------------------
// Grid harness
// ---------------------------------------------------------------------------

interface Cell {
  muscle: StandardMuscleGroup;
  enhanced: boolean;
  learned: number;
  totalDoseRatio: number;
  hardDoseRatio: number;
  plannedSessionsPerWeek: number;
  sleep: number;
  wearable: number;
}

const EXPERIENCE: Experience = 'advanced';

/**
 * Build a breakdown for one grid cell. The grid specifies normalized DOSE
 * RATIOS, so actual sets are reconstructed from the cell's own session
 * capacity — that is what makes ratio the controlled variable.
 */
function evaluate(cell: Cell): WindowBreakdown {
  const baseScale = cell.enhanced ? 1 / ENHANCED_RECOVERY_MULTIPLIER : 1;
  const config: RecoveryConfig = {
    ...RECOVERY_CONFIG,
    windowScale: Math.min(1.25, baseScale * cell.wearable),
    sleepWindowMultiplier: cell.sleep,
    recoveryMultiplierByMuscle: { [cell.muscle]: cell.learned },
    experienceForCapacity: EXPERIENCE,
    plannedSessionsPerWeek: cell.plannedSessionsPerWeek,
  };
  const capacityMrv =
    DEFAULT_VOLUME_LANDMARKS[EXPERIENCE][capacityOwnerFor(cell.muscle)].mrv;
  const sessionCapacity = capacityMrv / cell.plannedSessionsPerWeek;
  return windowBreakdownForSession(
    cell.muscle,
    {
      performedAt: new Date(0),
      dose: cell.totalDoseRatio * sessionCapacity,
      hardSets: cell.hardDoseRatio * sessionCapacity,
    },
    config
  );
}

/** The approved ordinary grid. Frequency is an explicit dimension. */
function ordinaryGrid(): Cell[] {
  const cells: Cell[] = [];
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    for (const enhanced of [false, true]) {
      for (const learned of [0.9, 0.95, 1.0, 1.05, 1.1]) {
        for (const totalDoseRatio of [0.2, 0.4, 0.6, 0.8, 1.0]) {
          for (const hardDoseRatio of [0.0, 0.0875, 0.175, 0.2625, 0.35]) {
            if (hardDoseRatio > totalDoseRatio) continue; // rejected combination
            for (const plannedSessionsPerWeek of [2, 3]) {
              cells.push({
                muscle,
                enhanced,
                learned,
                totalDoseRatio,
                hardDoseRatio,
                plannedSessionsPerWeek,
                sleep: 1.0,
                wearable: 1.0,
              });
            }
          }
        }
      }
    }
  }
  return cells;
}

describe('learned multiplier bounds', () => {
  it('is narrowed to 0.85-1.35', () => {
    expect(RECOVERY_MULTIPLIER_BOUNDS.min).toBe(0.85);
    expect(RECOVERY_MULTIPLIER_BOUNDS.max).toBe(1.35);
  });

  it('clamps legacy persisted values on READ (the migration policy)', () => {
    // Every value the old 0.70-1.50 range could hold, at the 0.05 step.
    for (const stored of [0.7, 0.75, 0.8]) {
      expect(clampRecoveryMultiplier(stored)).toBe(0.85);
    }
    for (const stored of [1.4, 1.45, 1.5]) {
      expect(clampRecoveryMultiplier(stored)).toBe(1.35);
    }
    for (const stored of [0.85, 1.0, 1.35]) {
      expect(clampRecoveryMultiplier(stored)).toBe(stored);
    }
    expect(clampRecoveryMultiplier(Number.NaN)).toBe(1);
  });

  it('stays OUTSIDE the global environmental cap so modifiers cannot suppress it', () => {
    const involvement = { performedAt: new Date(0), dose: 6, hardSets: 2 };
    const base: RecoveryConfig = {
      ...RECOVERY_CONFIG,
      experienceForCapacity: 'advanced',
      plannedSessionsPerWeek: 2,
      // Deliberately saturate the global cap (1.25) with sleep + profile.
      windowScale: 1.25,
      sleepWindowMultiplier: 1.15,
    };
    const neutral = windowBreakdownForSession('quads', involvement, base);
    const personalized = windowBreakdownForSession('quads', involvement, {
      ...base,
      recoveryMultiplierByMuscle: { quads: 1.35 },
    });
    // Global scale is already capped for BOTH, yet the learned multiplier
    // still moves the window — that is the property being protected.
    expect(neutral.globalScale).toBe(personalized.globalScale);
    expect(personalized.preClampHours).toBeCloseTo(neutral.preClampHours * 1.35, 6);
  });
});

describe('window guardrails', () => {
  it('final values always land inside 24-120h', () => {
    for (const cell of ordinaryGrid()) {
      const b = evaluate(cell);
      expect(b.windowHours).toBeGreaterThanOrEqual(RECOVERY_WINDOW_BOUNDS_HOURS.min);
      expect(b.windowHours).toBeLessThanOrEqual(RECOVERY_WINDOW_BOUNDS_HOURS.max);
    }
  });

  it('pre-clamp values are computed and exposed SEPARATELY from the final value', () => {
    // A tiny window that must clamp up, so pre != final and both are visible.
    const b = windowBreakdownForSession(
      'biceps',
      { performedAt: new Date(0), dose: 0, hardSets: 0 },
      {
        ...RECOVERY_CONFIG,
        experienceForCapacity: 'advanced',
        plannedSessionsPerWeek: 2,
        windowScale: 1 / ENHANCED_RECOVERY_MULTIPLIER,
        recoveryMultiplierByMuscle: { biceps: 0.85 },
      }
    );
    expect(b.preClampHours).toBeLessThan(RECOVERY_WINDOW_BOUNDS_HOURS.min);
    expect(b.windowHours).toBe(RECOVERY_WINDOW_BOUNDS_HOURS.min);
    expect(b.clamp).toBe('lower');
    expect(b.preClampHours).not.toBe(b.windowHours);
  });

  it('records every contributing modifier when a clamp fires', () => {
    resetRecoveryClampEvents();
    computeMuscleRecovery(
      [
        {
          performedAt: new Date(0),
          exercises: [{ primaryMuscle: 'hamstrings', secondaryMuscles: [], sets: Array.from({ length: 30 }, () => ({ repsInTank: 0 })) }],
        },
      ],
      'hamstrings',
      new Date(1),
      {
        ...RECOVERY_CONFIG,
        experienceForCapacity: 'advanced',
        plannedSessionsPerWeek: 2,
        windowScale: 1.25,
        sleepWindowMultiplier: 1.15,
        recoveryMultiplierByMuscle: { hamstrings: 1.35 },
      }
    );
    const events = getRecoveryClampEvents();
    expect(events.length).toBe(1);
    const e = events[0];
    expect(e.muscle).toBe('hamstrings');
    expect(e.clamp).toBe('upper');
    expect(e.baseWindowHours).toBe(72);
    expect(e.learnedMultiplier).toBe(1.35);
    expect(e.sleepWindowMultiplier).toBe(1.15);
    expect(e.windowScale).toBe(1.25);
    expect(e.dose.doseScale).toBeGreaterThan(1);
    expect(e.dose.capacityMuscle).toBe('hamstrings');
    expect(e.preClampHours).toBeGreaterThan(RECOVERY_WINDOW_BOUNDS_HOURS.max);
    expect(e.windowHours).toBe(RECOVERY_WINDOW_BOUNDS_HOURS.max);
    resetRecoveryClampEvents();
  });
});

describe('ordinary-grid saturation', () => {
  const cells = ordinaryGrid();
  const breakdowns = cells.map(evaluate);
  const metrics = summarizeClamps(breakdowns);

  it('has the expected shape (26 muscles x grid, invalid combinations rejected)', () => {
    expect(cells.length).toBe(11960);
    const uniqueStates = new Set(
      cells.map((c) => `${c.muscle}|${c.enhanced}|${c.learned}|${c.totalDoseRatio}|${c.hardDoseRatio}`)
    );
    expect(uniqueStates.size).toBe(5980);
  });

  it('keeps combined clamp saturation under 5% — measured, never hard-coded', () => {
    const combined = metrics.lowerRate + metrics.upperRate;
    // eslint-disable-next-line no-console
    console.log(
      '[ordinary grid]',
      JSON.stringify({
        cases: metrics.total,
        lower: metrics.lower,
        upper: metrics.upper,
        lowerRatePct: Number((metrics.lowerRate * 100).toFixed(2)),
        upperRatePct: Number((metrics.upperRate * 100).toFixed(2)),
        byMuscle: metrics.byMuscle,
        byProfile: metrics.byProfile,
      })
    );
    // If this trips, investigate the model — do NOT widen the clamp.
    expect(combined).toBeLessThanOrEqual(0.05);
  });

  it('never hits the UPPER bound on ordinary inputs', () => {
    expect(metrics.upper).toBe(0);
  });

  it('reports lower-bound pressure by muscle and by profile', () => {
    // Behavioural claim, not a magic number: lower-bound pressure is confined
    // to short-base muscles, and enhanced (shorter windows) feels it more.
    for (const muscle of Object.keys(metrics.byMuscle)) {
      const base = RECOVERY_CONFIG.windowHoursByMuscle[muscle as StandardMuscleGroup] ?? RECOVERY_CONFIG.defaultWindowHours;
      expect(base).toBeLessThanOrEqual(36);
    }
    expect(metrics.byProfile.enhanced.lower).toBeGreaterThanOrEqual(
      metrics.byProfile.natural.lower
    );
  });
});

describe('extreme grid (may clamp — reported separately)', () => {
  const extremeCells: Cell[] = [];
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    for (const enhanced of [false, true]) {
      for (const learned of [RECOVERY_MULTIPLIER_BOUNDS.min, RECOVERY_MULTIPLIER_BOUNDS.max]) {
        for (const sleep of [0.95, 1.15]) {
          for (const wearable of [0.95, 1.15]) {
            // Minimum and maximum dose adjustment, via saturated ratios.
            for (const [totalDoseRatio, hardDoseRatio] of [[0, 0], [3, 3]] as const) {
              extremeCells.push({
                muscle,
                enhanced,
                learned,
                totalDoseRatio,
                hardDoseRatio,
                plannedSessionsPerWeek: 2,
                sleep,
                wearable,
              });
            }
          }
        }
      }
    }
  }

  const breakdowns = extremeCells.map(evaluate);

  it('covers all 26 muscles at both multiplier bounds and both dose extremes', () => {
    expect(new Set(extremeCells.map((c) => c.muscle)).size).toBe(STANDARD_MUSCLE_GROUPS.length);
    expect(extremeCells.length).toBe(STANDARD_MUSCLE_GROUPS.length * 2 * 2 * 2 * 2 * 2);
  });

  it('final values stay inside the guardrails even at the extremes', () => {
    for (const b of breakdowns) {
      expect(b.windowHours).toBeGreaterThanOrEqual(RECOVERY_WINDOW_BOUNDS_HOURS.min);
      expect(b.windowHours).toBeLessThanOrEqual(RECOVERY_WINDOW_BOUNDS_HOURS.max);
    }
  });

  it('pre-clamp values DO escape the guardrails — which is why the clamp exists', () => {
    const escaping = breakdowns.filter(
      (b) =>
        b.preClampHours < RECOVERY_WINDOW_BOUNDS_HOURS.min ||
        b.preClampHours > RECOVERY_WINDOW_BOUNDS_HOURS.max
    );
    expect(escaping.length).toBeGreaterThan(0);
    const metrics = summarizeClamps(breakdowns);
    // eslint-disable-next-line no-console
    console.log(
      '[extreme grid]',
      JSON.stringify({
        cases: metrics.total,
        lower: metrics.lower,
        upper: metrics.upper,
        lowerRatePct: Number((metrics.lowerRate * 100).toFixed(2)),
        upperRatePct: Number((metrics.upperRate * 100).toFixed(2)),
        byProfile: metrics.byProfile,
      })
    );
  });
});
