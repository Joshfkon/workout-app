/**
 * resolveIsBodyweight — which exercises are loaded by the lifter's own body.
 *
 * `exercises.is_bodyweight` is NOT NULL DEFAULT false and was only ever
 * backfilled for rows whose scalar `equipment` was 'bodyweight' AND whose
 * equipment tags were empty, so station movements (dead hang, pull-up, dip,
 * L-sit) can sit at `false` while being pure bodyweight work. A false flag
 * used to read as "externally loaded", which asks for a weight that doesn't
 * exist, prescribes against 0, and leaves "Log set" unusable.
 */

import { resolveIsBodyweight } from '../bodyweightClassification';

describe('resolveIsBodyweight', () => {
  it('trusts an explicit flag', () => {
    expect(resolveIsBodyweight({ isBodyweight: true, name: 'Barbell Bench Press' })).toBe(true);
    expect(resolveIsBodyweight({ is_bodyweight: true, name: 'Anything' })).toBe(true);
  });

  it('accepts an explicit bodyweight equipment value or tag', () => {
    expect(resolveIsBodyweight({ equipment: 'bodyweight', name: 'Plank' })).toBe(true);
    expect(resolveIsBodyweight({ equipmentRequired: ['bodyweight'], name: 'Plank' })).toBe(true);
  });

  describe('flag unset — the catalog rows that regressed', () => {
    it('classifies a dead hang from its pull-up bar tag', () => {
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'Dead Hang',
          equipmentRequired: ['pull-up bar'],
          exerciseType: 'duration_based',
        })
      ).toBe(true);
    });

    it('classifies station movements (pull-up, dip, L-sit)', () => {
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Pull-Up', equipmentRequired: ['pull-up bar'] })
      ).toBe(true);
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Dip', equipmentRequired: ['dip bars'] })
      ).toBe(true);
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'L-Sit',
          equipmentRequired: ['dip bars'],
          exerciseType: 'duration_based',
        })
      ).toBe(true);
    });

    it('classifies untagged timed holds', () => {
      for (const name of ['Plank', 'Wall Sit', 'Hollow Body Hold', 'Dead Hang']) {
        expect(
          resolveIsBodyweight({
            isBodyweight: false,
            name,
            equipmentRequired: [],
            exerciseType: 'duration_based',
          })
        ).toBe(true);
      }
    });

    it('treats a support-only tag as no load (Copenhagen Plank on a bench)', () => {
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'Copenhagen Plank',
          equipmentRequired: ['bench'],
          exerciseType: 'duration_based',
        })
      ).toBe(true);
    });
  });

  describe('externally loaded work stays externally loaded', () => {
    it('excludes loaded timed holds', () => {
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'Plate Pinch Hold',
          equipmentRequired: ['weight plates'],
          exerciseType: 'duration_based',
        })
      ).toBe(false);
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: "Farmer's Carry",
          equipmentRequired: ['dumbbells'],
          exerciseType: 'duration_based',
        })
      ).toBe(false);
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'Overhead Carry',
          equipmentRequired: ['dumbbells'],
          exerciseType: 'duration_based',
        })
      ).toBe(false);
    });

    it('excludes rep-based loaded exercises', () => {
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Barbell Bench Press', equipmentRequired: ['barbell'] })
      ).toBe(false);
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Leg Extension', equipmentRequired: ['leg extension machine'] })
      ).toBe(false);
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Cable Crunch', equipmentRequired: ['cable machine'] })
      ).toBe(false);
    });

    it('does not promote an untagged REP-based exercise on a missing flag', () => {
      // The timed-hold fallback is scoped to duration exercises: a rep-based
      // row with no tags stays unknown rather than being called bodyweight.
      expect(
        resolveIsBodyweight({ isBodyweight: false, name: 'Mystery Movement', equipmentRequired: [] })
      ).toBe(false);
    });

    it('keeps an assisted machine a machine', () => {
      expect(
        resolveIsBodyweight({
          isBodyweight: false,
          name: 'Assisted Pull-Up Machine',
          equipmentRequired: ['assisted pull-up machine'],
        })
      ).toBe(false);
    });
  });

  it('a weighted hold is still a bodyweight movement carrying load', () => {
    expect(
      resolveIsBodyweight({
        isBodyweight: false,
        name: 'Weighted Plank',
        equipmentRequired: [],
        exerciseType: 'duration_based',
      })
    ).toBe(true);
  });
});
