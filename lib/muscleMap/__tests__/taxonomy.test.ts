import { STANDARD_MUSCLE_GROUPS } from '@/types/schema';
import { ALL_REGION_IDS, FRONT_REGIONS, BACK_REGIONS } from '../paths';
import {
  MUSCLE_TO_REGIONS,
  MUSCLE_IDS,
  REGION_TO_MUSCLE,
  REGIONLESS_COARSE_MEMBERS,
  REGIONLESS_DEEP_MUSCLES,
} from '../taxonomy';

describe('muscleMap taxonomy', () => {
  it('covers every standard muscle group', () => {
    expect([...MUSCLE_IDS].sort()).toEqual([...STANDARD_MUSCLE_GROUPS].sort());
  });

  it('maps every taxonomy member to regions — directly, or via regionless-coarse members', () => {
    for (const muscle of MUSCLE_IDS) {
      const members = REGIONLESS_COARSE_MEMBERS[muscle];
      if (members) {
        // A regionless coarse id ('traps','calves') owns no path itself but its
        // fine members must fully cover the area (≥1 region each), so a coarse
        // tag still brightens the parent region through the adapters.
        expect(MUSCLE_TO_REGIONS[muscle]).toHaveLength(0);
        expect(members.length).toBeGreaterThanOrEqual(2);
        for (const member of members) {
          expect(MUSCLE_TO_REGIONS[member].length).toBeGreaterThanOrEqual(1);
        }
      } else if (REGIONLESS_DEEP_MUSCLES.has(muscle)) {
        // Deep tissue with no surface path of its own (rotator cuff): never
        // paints — its area belongs to another muscle and sharing region ids
        // would break the one-owner reverse lookup below.
        expect(MUSCLE_TO_REGIONS[muscle]).toHaveLength(0);
      } else {
        expect(MUSCLE_TO_REGIONS[muscle].length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('references only region ids that exist in the vendored paths', () => {
    for (const muscle of MUSCLE_IDS) {
      for (const region of MUSCLE_TO_REGIONS[muscle]) {
        if (!ALL_REGION_IDS.has(region)) {
          throw new Error(`${muscle} references unknown region '${region}'`);
        }
      }
    }
  });

  it('assigns each region to at most one muscle', () => {
    const seen = new Map<string, string>();
    for (const muscle of MUSCLE_IDS) {
      for (const region of MUSCLE_TO_REGIONS[muscle]) {
        const owner = seen.get(region);
        if (owner) {
          throw new Error(`region '${region}' mapped to both '${owner}' and '${muscle}'`);
        }
        seen.set(region, muscle);
      }
    }
  });

  it('keeps left/right region pairs under the same logical muscle', () => {
    // For every mapped region ending in -left, its -right twin (when it
    // exists in the artwork) must belong to the same muscle, and vice versa.
    REGION_TO_MUSCLE.forEach((muscle, region) => {
      const twin = region.endsWith('-left')
        ? region.replace(/-left$/, '-right')
        : region.endsWith('-right')
          ? region.replace(/-right$/, '-left')
          : null;
      if (twin && ALL_REGION_IDS.has(twin)) {
        expect(REGION_TO_MUSCLE.get(twin)).toBe(muscle);
      }
    });
  });

  it('has unique region ids within each view in the vendored artwork', () => {
    for (const regions of [FRONT_REGIONS, BACK_REGIONS]) {
      const ids = regions.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
