/**
 * Taxonomy + volume-authority invariants (Bugs 1 and 3).
 *
 * The registry separates THREE concepts that this codebase historically
 * conflated in one flat table: anatomy, credited-set aggregation, and who owns
 * volume capacity. These tests exist so a future change cannot quietly
 * re-merge them — in particular so nobody infers from `completePartition` that
 * credited rows may be summed.
 */

import {
  DEFAULT_VOLUME_LANDMARKS,
  MUSCLE_VOLUME_AUTHORITY,
  STANDARD_MUSCLE_GROUPS,
  assertNoMixedCapacityAggregation,
  boundedComponentsOf,
  capacityOwnerFor,
  getVolumeAuthority,
  isBoundedComponent,
  type Experience,
  type StandardMuscleGroup,
} from '@/types/schema';
import { COARSE_CHILDREN, COARSE_MUSCLES, STANDARD_TO_COARSE } from '@/services/volumeBands';

const EXPERIENCES: Experience[] = ['novice', 'intermediate', 'advanced'];

describe('registry completeness and shape', () => {
  it('covers every standard muscle exactly once', () => {
    const keys = Object.keys(MUSCLE_VOLUME_AUTHORITY).sort();
    expect(keys).toEqual([...STANDARD_MUSCLE_GROUPS].sort());
  });

  it('every entry carries all three concepts', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const entry = getVolumeAuthority(muscle);
      expect(['completePartition', 'partialRollup', 'independent']).toContain(
        entry.anatomicalRelationship
      );
      expect(['disjoint', 'overlapping', 'independent']).toContain(entry.creditAggregation);
      expect(['independent', 'groupCapacity', 'boundedComponent']).toContain(
        entry.volumeAuthority
      );
    }
  });

  it('parent references are valid standard muscles and never self-referential', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
      if (parent === undefined) continue;
      expect(STANDARD_MUSCLE_GROUPS).toContain(parent);
      expect(parent).not.toBe(muscle);
    }
  });

  it('every bounded component has exactly one parent, and that parent owns group capacity', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      if (!isBoundedComponent(muscle)) continue;
      const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
      expect(parent).toBeDefined();
      expect(MUSCLE_VOLUME_AUTHORITY[parent!].volumeAuthority).toBe('groupCapacity');
    }
  });

  it('no independent row accidentally inherits capacity', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const entry = MUSCLE_VOLUME_AUTHORITY[muscle];
      if (entry.volumeAuthority === 'boundedComponent') continue;
      expect(entry.parent).toBeUndefined();
      expect(capacityOwnerFor(muscle)).toBe(muscle);
    }
  });

  it('parent chains are one level deep — a parent is never itself a component', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
      if (!parent) continue;
      expect(MUSCLE_VOLUME_AUTHORITY[parent].parent).toBeUndefined();
    }
  });

  it('every groupCapacity row actually has components', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      if (MUSCLE_VOLUME_AUTHORITY[muscle].volumeAuthority !== 'groupCapacity') continue;
      expect(boundedComponentsOf(muscle).length).toBeGreaterThan(0);
    }
  });
});

describe('approved Phase 1 classifications are pinned', () => {
  it('calves is a complete anatomical partition with DISJOINT credit', () => {
    expect(getVolumeAuthority('calves')).toMatchObject({
      anatomicalRelationship: 'completePartition',
      creditAggregation: 'disjoint',
      volumeAuthority: 'groupCapacity',
    });
    expect(boundedComponentsOf('calves').sort()).toEqual(['gastrocnemius', 'soleus']);
  });

  it('triceps is a complete anatomical partition with DISJOINT credit', () => {
    expect(getVolumeAuthority('triceps')).toMatchObject({
      anatomicalRelationship: 'completePartition',
      creditAggregation: 'disjoint',
      volumeAuthority: 'groupCapacity',
    });
    expect(boundedComponentsOf('triceps').sort()).toEqual(['triceps_lat_med', 'triceps_long']);
  });

  it('traps is a PARTIAL rollup — the listed children are not a complete partition', () => {
    expect(getVolumeAuthority('traps').anatomicalRelationship).toBe('partialRollup');
    expect(getVolumeAuthority('upper_traps').anatomicalRelationship).toBe('partialRollup');
    expect(getVolumeAuthority('mid_lower_traps').anatomicalRelationship).toBe('partialRollup');
  });

  it('glutes/glute_med and abs/obliques stay INDEPENDENT (not parent/component)', () => {
    for (const muscle of ['glutes', 'glute_med', 'abs', 'obliques'] as StandardMuscleGroup[]) {
      expect(getVolumeAuthority(muscle).volumeAuthority).toBe('independent');
      expect(getVolumeAuthority(muscle).parent).toBeUndefined();
    }
  });

  it('completePartition NEVER implies credited rows may be summed', () => {
    // The whole point of separating the two fields. Anything anatomically
    // partitioned here is credit-DISJOINT at runtime: coarse tags resolve
    // standard-first and never leak into the heads.
    const partitioned = STANDARD_MUSCLE_GROUPS.filter(
      (m) => MUSCLE_VOLUME_AUTHORITY[m].anatomicalRelationship === 'completePartition'
    );
    expect(partitioned.length).toBeGreaterThan(0);
    for (const muscle of partitioned) {
      expect(MUSCLE_VOLUME_AUTHORITY[muscle].creditAggregation).toBe('disjoint');
    }
  });
});

describe('bounded components are non-additive subtargets', () => {
  it('a component never claims more MRV than its parent, at any experience level', () => {
    const violations: string[] = [];
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
        if (!parent) continue;
        const child = DEFAULT_VOLUME_LANDMARKS[experience][muscle].mrv;
        const parentMrv = DEFAULT_VOLUME_LANDMARKS[experience][parent].mrv;
        if (child > parentMrv) {
          violations.push(`${experience}.${muscle} MRV ${child} > ${parent} MRV ${parentMrv}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the approved compatibility clamp is in place (and is the ONLY numeric change)', () => {
    expect(DEFAULT_VOLUME_LANDMARKS.intermediate.triceps_lat_med.mrv).toBe(18);
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.triceps_lat_med.mrv).toBe(22);
    // Untouched siblings — proof we did not renormalize the whole family.
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.triceps_lat_med.mev).toBe(8);
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.triceps_lat_med.mav).toBe(15);
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.gastrocnemius).toEqual({ mev: 8, mav: 14, mrv: 20 });
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.soleus).toEqual({ mev: 4, mav: 10, mrv: 14 });
    expect(DEFAULT_VOLUME_LANDMARKS.advanced.upper_traps).toEqual({ mev: 4, mav: 10, mrv: 14 });
  });

  it('ordering holds everywhere: 0 <= MEV <= MAV <= MRV', () => {
    for (const experience of EXPERIENCES) {
      for (const muscle of STANDARD_MUSCLE_GROUPS) {
        const lm = DEFAULT_VOLUME_LANDMARKS[experience][muscle];
        expect(lm.mev).toBeGreaterThanOrEqual(0);
        expect(lm.mev).toBeLessThanOrEqual(lm.mav);
        expect(lm.mav).toBeLessThanOrEqual(lm.mrv);
      }
    }
  });

  it('deliberate zero MEVs survive (glute_med, obliques, mid_lower_traps)', () => {
    for (const experience of EXPERIENCES) {
      expect(DEFAULT_VOLUME_LANDMARKS[experience].glute_med.mev).toBe(0);
      expect(DEFAULT_VOLUME_LANDMARKS[experience].obliques.mev).toBe(0);
      expect(DEFAULT_VOLUME_LANDMARKS[experience].mid_lower_traps.mev).toBe(0);
    }
  });

  it('monotonic across experience levels, elementwise', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const n = DEFAULT_VOLUME_LANDMARKS.novice[muscle];
      const i = DEFAULT_VOLUME_LANDMARKS.intermediate[muscle];
      const a = DEFAULT_VOLUME_LANDMARKS.advanced[muscle];
      for (const field of ['mev', 'mav', 'mrv'] as const) {
        expect(n[field]).toBeLessThanOrEqual(i[field]);
        expect(i[field]).toBeLessThanOrEqual(a[field]);
      }
    }
  });
});

describe('aggregation guard', () => {
  const isDev = process.env.NODE_ENV !== 'production';

  it('accepts a set with no parent/component collision', () => {
    expect(() =>
      assertNoMixedCapacityAggregation(['gastrocnemius', 'soleus', 'quads'], 'test')
    ).not.toThrow();
    expect(() =>
      assertNoMixedCapacityAggregation(['calves', 'quads', 'abs'], 'test')
    ).not.toThrow();
  });

  it('rejects a group-capacity row summed with its own bounded component', () => {
    expect(isDev).toBe(true); // tests must run with the dev throw enabled
    expect(() =>
      assertNoMixedCapacityAggregation(['calves', 'gastrocnemius'], 'test')
    ).toThrow(/calves\+gastrocnemius/);
    expect(() =>
      assertNoMixedCapacityAggregation(['triceps', 'triceps_long'], 'test')
    ).toThrow(/triceps\+triceps_long/);
    expect(() =>
      assertNoMixedCapacityAggregation(['traps', 'mid_lower_traps'], 'test')
    ).toThrow(/traps\+mid_lower_traps/);
  });

  it('does NOT reject glutes+glute_med or abs+obliques — they are independent rows', () => {
    expect(() =>
      assertNoMixedCapacityAggregation(['glutes', 'glute_med'], 'test')
    ).not.toThrow();
    expect(() => assertNoMixedCapacityAggregation(['abs', 'obliques'], 'test')).not.toThrow();
  });

  it('names every offending pair, not just the first', () => {
    expect(() =>
      assertNoMixedCapacityAggregation(
        ['calves', 'gastrocnemius', 'triceps', 'triceps_lat_med'],
        'test'
      )
    ).toThrow(/calves\+gastrocnemius[\s\S]*triceps\+triceps_lat_med/);
  });
});

describe('registry agrees with the coarse display taxonomy', () => {
  it('a bounded component shares its parent coarse group with its parent row', () => {
    for (const muscle of STANDARD_MUSCLE_GROUPS) {
      const parent = MUSCLE_VOLUME_AUTHORITY[muscle].parent;
      if (!parent) continue;
      expect(STANDARD_TO_COARSE[muscle]).toBe(STANDARD_TO_COARSE[parent]);
    }
  });

  it('every standard muscle still has exactly one coarse parent (no double-count path)', () => {
    const seen = new Set<string>();
    for (const coarse of COARSE_MUSCLES) {
      for (const std of COARSE_CHILDREN[coarse]) {
        expect(seen.has(std)).toBe(false);
        seen.add(std);
      }
    }
    expect(seen.size).toBe(STANDARD_MUSCLE_GROUPS.length);
  });

  it('COARSE_CHILDREN never lets a caller blindly sum a parent with its components', () => {
    // Documents the live shape: the three families DO appear as siblings in
    // COARSE_CHILDREN, which is exactly why the credit pipeline computes a
    // capped per-exercise group credit instead of summing children, and why
    // the guard above exists.
    for (const coarse of COARSE_MUSCLES) {
      const children = COARSE_CHILDREN[coarse] as StandardMuscleGroup[];
      const hasFamily = children.some((c) => MUSCLE_VOLUME_AUTHORITY[c].parent !== undefined);
      if (!hasFamily) continue;
      expect(() => assertNoMixedCapacityAggregation(children, `COARSE_CHILDREN.${coarse}`)).toThrow();
    }
  });
});
