import {
  builderDefaultsFromHistory,
  priorityVolumeAdjustments,
  plannedVolumeWithBands,
  deliveredSetsAtPeak,
  isUnderDelivered,
  isAtOrBelowMev,
  priorityLabel,
  headSetsAtPeak,
  weekByWeekPlan,
  weekRir,
  rampLine,
  rirLine,
  deloadSummary,
  rampExplanation,
  recoveryVolumeExplanation,
} from '@/lib/training/builderDefaults';
import { calculateRecoveryFactors } from '@/services/mesocycleBuilder';
import { getEffectiveBand } from '@/services/volumeBands';
import type { StandardMuscleGroup } from '@/types/schema';

const day = (...m: StandardMuscleGroup[]) => m;
const bodyPartWeek: StandardMuscleGroup[][] = [
  day('chest_upper', 'chest_lower'),
  day('lats', 'upper_back'),
  day('quads', 'hamstrings', 'calves'),
  day('lateral_delts', 'front_delts', 'rear_delts'),
  day('biceps', 'triceps'),
];

describe('builderDefaultsFromHistory', () => {
  it('reads sessions a week and a body-part split from 4 weeks of history', () => {
    const sessions = [...bodyPartWeek, ...bodyPartWeek, ...bodyPartWeek, ...bodyPartWeek];
    const d = builderDefaultsFromHistory(sessions);
    expect(d.daysPerWeek).toBe(5);
    expect(d.splitKind).toBe('body_part');
    expect(d.summary).toBe('From your recent training: 5 sessions a week, a body-part split.');
  });

  it('divides by the span the history covers: 15 sessions over 3 weeks is 5 a week', () => {
    const sessions = [...bodyPartWeek, ...bodyPartWeek, ...bodyPartWeek];
    expect(builderDefaultsFromHistory(sessions, 21).daysPerWeek).toBe(5);
    expect(builderDefaultsFromHistory(sessions).daysPerWeek).toBe(4); // full 4-week window
  });

  it('says nothing with too little history, and clamps to 2–7 a week', () => {
    expect(builderDefaultsFromHistory([bodyPartWeek[0]])).toEqual({ daysPerWeek: null, splitKind: null, summary: null });
    const many = Array.from({ length: 40 }, () => day('quads'));
    expect(builderDefaultsFromHistory(many).daysPerWeek).toBe(7);
    expect(builderDefaultsFromHistory(Array.from({ length: 4 }, () => day('quads'))).daysPerWeek).toBe(2);
  });
});

describe('priorityVolumeAdjustments', () => {
  it('maps Settings priorities to the imbalance engine multipliers, skipping neutral', () => {
    expect(
      priorityVolumeAdjustments([
        { muscle_group: 'shoulders', priority: 1 },
        { muscle_group: 'hamstrings', priority: 2 },
        { muscle_group: 'chest', priority: 3 },
        { muscle_group: 'quads', priority: 4 },
        { muscle_group: 'calves', priority: 5 },
      ])
    ).toEqual([
      { muscleGroup: 'shoulders', volumeMultiplier: 1.2, reason: 'user_priority' },
      { muscleGroup: 'hamstrings', volumeMultiplier: 1.1, reason: 'user_priority' },
      { muscleGroup: 'quads', volumeMultiplier: 0.95, reason: 'dominant' },
      { muscleGroup: 'calves', volumeMultiplier: 0.9, reason: 'dominant' },
    ]);
  });
});

describe('plannedVolumeWithBands', () => {
  it('pairs each planned coarse muscle with its MEV–MRV band, skipping unplanned and non-coarse keys', () => {
    const rows = plannedVolumeWithBands({ chest: { sets: 20 }, hamstrings: 12, quads: { sets: 0 }, lateral_delts: { sets: 8 } });
    expect(rows.map((r) => r.muscle)).toEqual(['chest', 'hamstrings']);
    expect(rows[0]).toEqual({ muscle: 'chest', sets: 20, ...getEffectiveBand('chest') });
  });

  it('uses the enhanced recovery profile the generator used', () => {
    const [row] = plannedVolumeWithBands({ shoulders: 35 }, { recoveryProfile: 'enhanced' });
    expect(row.mrv).toBe(getEffectiveBand('shoulders', { recoveryProfile: 'enhanced' }).mrv);
    expect(row.mrv).toBeGreaterThan(getEffectiveBand('shoulders').mrv);
  });
});

describe('deliveredSetsAtPeak', () => {
  const ex = (primaryMuscle: string, sets: number) => ({ exercise: { primaryMuscle }, sets });
  it('sums the peak (highest-volume, non-deload) week by coarse muscle, mapping fine muscles up', () => {
    const program = {
      mesocycleWeeks: [
        { isDeload: false, volumeModifier: 0.8, sessions: [{ exercises: [ex('chest', 6)] }] },
        { isDeload: false, volumeModifier: 1.0, sessions: [{ exercises: [ex('chest', 9), ex('lateral_delts', 4)] }, { exercises: [ex('shoulders', 3), ex('chest_upper', 2)] }] },
        { isDeload: true, volumeModifier: 0.5, sessions: [{ exercises: [ex('chest', 20)] }] },
      ],
    };
    expect(deliveredSetsAtPeak(program)).toEqual({ chest: 11, shoulders: 7 });
    // No generated weeks → null (unknown), not 'every muscle got 0'.
    expect(deliveredSetsAtPeak(null)).toBeNull();
    expect(deliveredSetsAtPeak({ mesocycleWeeks: [] })).toBeNull();
  });

  it('counts secondary muscles at half credit, like the targets and bands do', () => {
    const program = {
      mesocycleWeeks: [
        { isDeload: false, volumeModifier: 1, sessions: [{ exercises: [{ exercise: { primaryMuscle: 'back', secondaryMuscles: ['biceps'] }, sets: 4 }] }] },
      ],
    };
    expect(deliveredSetsAtPeak(program)).toEqual({ back: 4, biceps: 2 });
  });

  it('flags a target the sessions clearly can not fit', () => {
    expect(isUnderDelivered(17, 9)).toBe(true);
    expect(isUnderDelivered(17, 16)).toBe(false);
    // A planned muscle missing from the generated week is 0, not unknown.
    expect(isUnderDelivered(17, undefined)).toBe(true);
    expect(isUnderDelivered(0, undefined)).toBe(false);
  });
});

describe('head priorities (Settings → Muscle priorities → Target one head)', () => {
  it('a head row moves its parent group by half and carries the head', () => {
    expect(
      priorityVolumeAdjustments([
        { muscle_group: 'lateral_delts', priority: 1 },
        { muscle_group: 'chest_upper', priority: 2 },
        { muscle_group: 'front_delts', priority: 5 },
      ])
    ).toEqual([
      { muscleGroup: 'shoulders', head: 'lateral_delts', volumeMultiplier: 1.1, reason: 'user_priority' },
      { muscleGroup: 'chest', head: 'chest_upper', volumeMultiplier: 1.05, reason: 'user_priority' },
      { muscleGroup: 'shoulders', head: 'front_delts', volumeMultiplier: 0.95, reason: 'dominant' },
    ]);
  });

  it('labels a head by its display name and a group by its own', () => {
    expect(priorityLabel({ muscleGroup: 'shoulders', head: 'lateral_delts' })).toBe('Side Delts');
    expect(priorityLabel({ muscleGroup: 'hamstrings' })).toBe('Hamstrings');
  });

  it('reads a head’s peak-week sets', () => {
    const program = {
      mesocycleWeeks: [
        {
          isDeload: false,
          volumeModifier: 1,
          sessions: [{ exercises: [{ exercise: { primaryMuscle: 'lateral_delts' }, sets: 6 }, { exercise: { primaryMuscle: 'chest', secondaryMuscles: ['front_delts'] }, sets: 4 }] }],
        },
      ],
    };
    expect(headSetsAtPeak(program, ['lateral_delts', 'front_delts', 'rear_delts'])).toEqual({ lateral_delts: 6, front_delts: 2 });
  });
});

describe('week by week', () => {
  const ex = (primaryMuscle: string, sets: number, rir: number) => ({ exercise: { primaryMuscle }, sets, reps: { targetRIR: rir } });
  const program = {
    mesocycleWeeks: [
      { weekNumber: 1, isDeload: false, volumeModifier: 0.9, intensityModifier: 0.85, rpeTarget: { min: 7, max: 8 }, sessions: [{ exercises: [ex('chest', 10, 3)] }] },
      { weekNumber: 2, isDeload: false, volumeModifier: 0.95, intensityModifier: 0.9, rpeTarget: { min: 7, max: 8 }, sessions: [{ exercises: [ex('chest', 10, 3)] }] },
      { weekNumber: 3, isDeload: false, volumeModifier: 1, intensityModifier: 0.95, rpeTarget: { min: 8, max: 9 }, sessions: [{ exercises: [ex('chest', 12, 2), ex('biceps', 4, 1)] }] },
      { weekNumber: 4, isDeload: true, volumeModifier: 0.5, intensityModifier: 0.6, rpeTarget: { min: 5, max: 6 }, sessions: [{ exercises: [ex('chest', 6, 4)] }] },
    ],
  };
  const weeks = weekByWeekPlan(program);

  it('reads every week: credited sets, volume and load shares, RIR from the prescribed sets', () => {
    expect(weeks.map((w) => w.sets.chest)).toEqual([10, 10, 12, 6]);
    expect(weeks[2].rir).toEqual({ min: 1, max: 2 });
    expect(weeks[3]).toMatchObject({ isDeload: true, volumeModifier: 0.5, intensityModifier: 0.6 });
  });

  it('falls back to the week’s RPE target read as RIR when no exercise carries one', () => {
    expect(weekRir({ isDeload: true, volumeModifier: 0.5, rpeTarget: { min: 5, max: 6 }, sessions: [] })).toEqual({ min: 4, max: 5 });
    expect(weekRir({ isDeload: false, volumeModifier: 1, sessions: [] })).toBeNull();
  });

  it('draws a muscle’s ramp: week 1, each change, the last training week, the deload', () => {
    expect(rampLine(weeks, 'chest')).toBe('W1 10 → W3 12 → deload 6');
    expect(rampLine(weeks, 'biceps')).toBe('W1 0 → W3 4 → deload 0');
  });

  it('runs equal RIR weeks together', () => {
    expect(rirLine(weeks)).toBe('W1–2 3 RIR → W3 1–2 RIR → Deload 4 RIR');
  });

  it('summarises the deload’s real prescription', () => {
    expect(deloadSummary(weeks)).toEqual({ weekNumber: 4, volumePercent: 50, loadPercent: 60, rir: { min: 4, max: 4 } });
    expect(deloadSummary([])).toBeNull();
  });

  it('explains the ramp from the periodization model and the plan’s own numbers', () => {
    expect(rampExplanation('linear', weeks)).toMatch(/^Week 1 runs at 90% of the target sets and climbs to 100% by week 3/);
    expect(rampExplanation('linear', weeks)).toMatch(/deload drops to 50%/);
    const block = weekByWeekPlan({
      mesocycleWeeks: [1.1, 1.1, 0.8, 0.6, 0.5].map((v, i) => ({ weekNumber: i + 1, isDeload: i === 4, volumeModifier: v, sessions: [] })),
    });
    expect(rampExplanation('block', block)).toMatch(/weeks 1–2 at 110%, then week 3 at 80%, then week 4 at 60%/);
  });

  it('flags sets at or under MEV', () => {
    expect(isAtOrBelowMev(6, 6)).toBe(true);
    expect(isAtOrBelowMev(undefined, 6)).toBe(true);
    expect(isAtOrBelowMev(7, 6)).toBe(false);
  });
});

describe('recoveryVolumeExplanation', () => {
  it('names what moved volume off 100%', () => {
    expect(recoveryVolumeExplanation({ volumeMultiplier: 0.85, volumeReasons: ['sleep 2/5 ×0.85'] })).toBe(
      'Your recovery profile sets weekly volume to 85% of the standard targets (sleep 2/5 ×0.85). Better sleep or lower stress in Settings raises it.'
    );
    expect(recoveryVolumeExplanation({ volumeMultiplier: 1, volumeReasons: [] })).toBeNull();
  });

  it('is fed by calculateRecoveryFactors', () => {
    const rf = calculateRecoveryFactors({
      goal: 'cut', experience: 'advanced', heightCm: 180, latestDexa: null, age: 38,
      sleepQuality: 2, stressLevel: 3, trainingAge: 4, availableEquipment: [], injuryHistory: [],
    });
    expect(rf.volumeReasons).toEqual(['age 38 ×0.95', 'sleep 2/5 ×0.85']);
    expect(recoveryVolumeExplanation(rf)).toMatch(/81%/);
  });
});
