/**
 * Planned-schedule load estimation (volumeTracker) — the load-driven
 * successor to the schedule builder's hrs-per-week banding.
 *
 * Pins: canonical attribution (primary 1.0 / secondary 0.5 / within-group
 * cap), RIR weighting on top of the cap, the rear-delt warning exemption,
 * peak-week selection across mesocycle weeks, threshold scaling
 * (capacity multiplier + Enhanced Athlete Mode), and the warning copy.
 */

import {
  plannedRirWeight,
  plannedSessionWeightedHardSets,
  estimatePlannedWeeklyGroupLoad,
  assessPlannedMuscleLoad,
  WARNING_EXEMPT_MUSCLES,
  HARD_SET_WARNING_GROUPS,
  type PlannedExerciseLoadInput,
  type PlannedWeekLoadInput,
} from '@/services/volumeTracker';
import {
  RESEARCH_VOLUME_BANDS,
  ENHANCED_MRV_MULTIPLIERS,
} from '@/services/volumeBands';

const bench = (sets: number, targetRir: number | null = 1): PlannedExerciseLoadInput => ({
  primaryMuscle: 'chest',
  secondaryMuscles: ['front_delts', 'triceps'],
  sets,
  targetRir,
});

const week = (
  weekNumber: number | undefined,
  ...exercises: PlannedExerciseLoadInput[]
): PlannedWeekLoadInput => ({
  weekNumber,
  sessions: [{ exercises }],
});

describe('plannedRirWeight', () => {
  it('mirrors EFFECTIVE_VOLUME_WEIGHTS: 0-2 full, 3 reduced, 4 near-cruise', () => {
    expect(plannedRirWeight(0)).toBe(1);
    expect(plannedRirWeight(2)).toBe(1);
    expect(plannedRirWeight(3)).toBe(0.6);
    expect(plannedRirWeight(4)).toBe(0.25);
  });

  it('unknown targets count at FULL weight — missing data must not hide load', () => {
    expect(plannedRirWeight(null)).toBe(1);
    expect(plannedRirWeight(undefined)).toBe(1);
    expect(plannedRirWeight(Number.NaN)).toBe(1);
  });

  it('out-of-range targets clamp instead of vanishing', () => {
    expect(plannedRirWeight(7)).toBe(0.25);
    expect(plannedRirWeight(-1)).toBe(1);
  });
});

describe('plannedSessionWeightedHardSets', () => {
  it('sums sets × weight without attribution', () => {
    // 4 @ RIR1 (4.0) + 4 @ RIR3 (2.4) + 8 @ RIR4 (2.0)
    expect(
      plannedSessionWeightedHardSets([
        { primaryMuscle: 'chest', sets: 4, targetRir: 1 },
        { primaryMuscle: 'lats', sets: 4, targetRir: 3 },
        { primaryMuscle: 'biceps', sets: 8, targetRir: 4 },
      ])
    ).toBeCloseTo(8.4);
  });

  it('negative set counts are ignored', () => {
    expect(
      plannedSessionWeightedHardSets([{ primaryMuscle: 'chest', sets: -3, targetRir: 1 }])
    ).toBe(0);
  });
});

describe('estimatePlannedWeeklyGroupLoad', () => {
  it('credits primary 1.0 and secondaries 0.5 per set, rolled to coarse groups', () => {
    const load = estimatePlannedWeeklyGroupLoad([{ exercises: [bench(4, 1)] }]);
    expect(load.get('chest')).toBeCloseTo(4);
    expect(load.get('shoulders')).toBeCloseTo(2);
    expect(load.get('triceps')).toBeCloseTo(2);
  });

  it('caps within-group credit at 1.0 per set (primary + same-group secondary)', () => {
    const load = estimatePlannedWeeklyGroupLoad([
      {
        exercises: [
          {
            primaryMuscle: 'chest_upper',
            secondaryMuscles: ['chest_lower'],
            sets: 4,
            targetRir: 1,
          },
        ],
      },
    ]);
    // Uncapped chest credit is 1.5/set; the cap keeps a 4-set exercise at 4.
    expect(load.get('chest')).toBeCloseTo(4);
  });

  it('applies the RIR weight on top of the cap', () => {
    const load = estimatePlannedWeeklyGroupLoad([{ exercises: [bench(4, 3)] }]);
    expect(load.get('chest')).toBeCloseTo(4 * 0.6);
  });

  it('accumulates across sessions', () => {
    const load = estimatePlannedWeeklyGroupLoad([
      { exercises: [bench(4, 1)] },
      { exercises: [bench(3, 1)] },
    ]);
    expect(load.get('chest')).toBeCloseTo(7);
  });

  it('excludeMuscles drops a standard muscle before the rollup', () => {
    const rearDeltFlys: PlannedExerciseLoadInput = {
      primaryMuscle: 'rear_delts',
      secondaryMuscles: [],
      sets: 6,
      targetRir: 1,
    };
    const withRear = estimatePlannedWeeklyGroupLoad([{ exercises: [rearDeltFlys] }]);
    const without = estimatePlannedWeeklyGroupLoad([{ exercises: [rearDeltFlys] }], {
      excludeMuscles: WARNING_EXEMPT_MUSCLES,
    });
    expect(withRear.get('shoulders')).toBeCloseTo(6);
    expect(without.get('shoulders')).toBeUndefined();
  });
});

describe('assessPlannedMuscleLoad', () => {
  it('warns on the PEAK week and names it in the copy', () => {
    const { warnings } = assessPlannedMuscleLoad([
      week(1, bench(18, 1)),
      week(2, bench(20, 1)),
      week(3, bench(24, 1)),
      week(4, bench(28, 1)),
    ]);
    const chest = warnings.find((w) => w.group === 'chest');
    expect(chest).toBeDefined();
    expect(chest!.weekNumber).toBe(4);
    expect(chest!.weightedHardSets).toBeCloseTo(28);
    expect(chest!.message).toBe(
      `Chest peaks at 28 weighted hard sets in week 4 — above the ~${RESEARCH_VOLUME_BANDS.chest.mrv}-set range where returns flatten.`
    );
  });

  it('a lone week gets the estimated-per-week phrasing', () => {
    const { warnings } = assessPlannedMuscleLoad([week(undefined, bench(28, 1))]);
    expect(warnings[0].message).toBe(
      `Chest estimated at 28 hard sets/week — above the ~${RESEARCH_VOLUME_BANDS.chest.mrv}-set range where returns flatten.`
    );
  });

  it('no warning at or under the band MRV', () => {
    const { warnings, peaksByGroup } = assessPlannedMuscleLoad([
      week(1, bench(RESEARCH_VOLUME_BANDS.chest.mrv, 1)),
    ]);
    expect(warnings).toHaveLength(0);
    expect(peaksByGroup.get('chest')?.weightedHardSets).toBeCloseTo(
      RESEARCH_VOLUME_BANDS.chest.mrv
    );
  });

  it('3+ RIR volume counts at reduced weight toward the total', () => {
    // 30 raw sets at RIR 3 is only 18 weighted — under chest's MRV of 22.
    const { warnings } = assessPlannedMuscleLoad([week(1, bench(30, 3))]);
    expect(warnings).toHaveLength(0);
  });

  it('rear-delt volume never trips the shoulders warning; lateral-delt volume does', () => {
    const flys = (primary: string): PlannedWeekLoadInput =>
      week(1, { primaryMuscle: primary, secondaryMuscles: [], sets: 30, targetRir: 1 });
    expect(assessPlannedMuscleLoad([flys('rear_delts')]).warnings).toHaveLength(0);
    const lateral = assessPlannedMuscleLoad([flys('lateral_delts')]).warnings;
    expect(lateral.map((w) => w.group)).toEqual(['shoulders']);
  });

  it('small-muscle accessory volume is exempt however large', () => {
    const { warnings } = assessPlannedMuscleLoad([
      week(
        1,
        { primaryMuscle: 'forearms', secondaryMuscles: [], sets: 40, targetRir: 0 },
        { primaryMuscle: 'calves', secondaryMuscles: [], sets: 40, targetRir: 0 },
        { primaryMuscle: 'traps', secondaryMuscles: [], sets: 40, targetRir: 0 },
        { primaryMuscle: 'abs', secondaryMuscles: [], sets: 40, targetRir: 0 }
      ),
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('only the six major groups can warn', () => {
    expect([...HARD_SET_WARNING_GROUPS].sort()).toEqual(
      ['back', 'chest', 'glutes', 'hamstrings', 'quads', 'shoulders'].sort()
    );
  });

  it('the capacity multiplier scales the threshold', () => {
    const weeks = [week(1, bench(24, 1))]; // over 22, under 22 × 1.2 ≈ 26
    expect(assessPlannedMuscleLoad(weeks).warnings).toHaveLength(1);
    expect(
      assessPlannedMuscleLoad(weeks, { capacityMultiplier: 1.2 }).warnings
    ).toHaveLength(0);
    // Garbage multipliers fall back to 1 instead of disabling the warning.
    expect(
      assessPlannedMuscleLoad(weeks, { capacityMultiplier: Number.NaN }).warnings
    ).toHaveLength(1);
  });

  it('Enhanced Athlete Mode raises the threshold by the group multiplier', () => {
    const enhancedThreshold = Math.round(
      RESEARCH_VOLUME_BANDS.chest.mrv * ENHANCED_MRV_MULTIPLIERS.chest
    );
    const weeks = [week(1, bench(enhancedThreshold, 1))]; // over natural MRV
    expect(assessPlannedMuscleLoad(weeks).warnings).toHaveLength(1);
    expect(
      assessPlannedMuscleLoad(weeks, { enhancedAthleteMode: true }).warnings
    ).toHaveLength(0);
  });

  it('sorts warnings by worst relative overshoot', () => {
    const squats: PlannedExerciseLoadInput = {
      primaryMuscle: 'quads',
      secondaryMuscles: [],
      sets: 40, // 200% of quads' 20 MRV
      targetRir: 1,
    };
    const { warnings } = assessPlannedMuscleLoad([week(1, bench(24, 1), squats)]);
    expect(warnings.map((w) => w.group)).toEqual(['quads', 'chest']);
  });
});
