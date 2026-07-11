import { calculateVolumeFromSets } from '@/services/volumeTracker';
import { makeExercise, makeExerciseBlock, makeSetLog } from '@/test-utils/factories';
import type { VolumeLandmarks } from '@/types/schema';

/**
 * Location-scoped calibration scopes LOAD history only. Volume, muscle-group
 * counts, and readiness aggregate ACROSS locations — a calf set is a calf set
 * anywhere (rule 7). This is structurally guaranteed because the domain SetLog
 * carries no location, but we pin it: sets from two different locations
 * (modeled as two blocks/sessions) all count toward the same muscle.
 */
describe('weekly volume aggregates across locations (rule 7)', () => {
  const landmarks: Record<string, VolumeLandmarks> = {
    calves: { mev: 8, mav: 16, mrv: 20 },
  };

  it('counts calf sets from location A and location B together', () => {
    const calf = makeExercise({
      id: 'calf',
      name: 'Seated Calf Raise (Machine)',
      primaryMuscle: 'calves',
      secondaryMuscles: [],
      mechanic: 'isolation',
      equipmentRequired: ['calf_raise'],
    });

    // Two blocks = two sessions at two different gyms.
    const blockAtA = makeExerciseBlock({ id: 'block-A', exerciseId: 'calf' });
    const blockAtB = makeExerciseBlock({ id: 'block-B', exerciseId: 'calf' });

    const setsAtA = [
      makeSetLog({ id: 'a1', exerciseBlockId: 'block-A' }),
      makeSetLog({ id: 'a2', exerciseBlockId: 'block-A' }),
    ];
    const setsAtB = [
      makeSetLog({ id: 'b1', exerciseBlockId: 'block-B' }),
      makeSetLog({ id: 'b2', exerciseBlockId: 'block-B' }),
      makeSetLog({ id: 'b3', exerciseBlockId: 'block-B' }),
    ];

    const volume = calculateVolumeFromSets(
      [...setsAtA, ...setsAtB],
      new Map([['calf', calf]]),
      new Map([
        ['block-A', blockAtA],
        ['block-B', blockAtB],
      ]),
      landmarks
    );

    // All 5 sets (2 at A + 3 at B) count toward calves — no location scoping.
    expect(volume.get('calves')?.totalSets).toBe(5);
  });
});
