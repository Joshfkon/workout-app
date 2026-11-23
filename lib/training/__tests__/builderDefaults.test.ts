import { builderDefaultsFromHistory, priorityVolumeAdjustments, plannedVolumeWithBands } from '@/lib/training/builderDefaults';
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
