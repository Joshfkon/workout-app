/**
 * Phase 4 — triceps head split (long vs lateral+medial) through the SHARED
 * volume pipeline. The motivating week: 11 credited triceps sets, all from
 * pushdowns + pressing, reads mid-zone at group level while containing ZERO
 * overhead work — the long head gap must surface as a lagging fine child.
 */

import {
  buildVolumeRows,
  computeReachableMuscles,
  computeWeeklyMuscleVolume,
  type WeeklyVolumeBlockRow,
} from '../weeklyVolume';
import { getEffectiveBand, FINE_CHILD_MUSCLES, COARSE_CHILDREN } from '@/services/volumeBands';
import { resolvePrimaryMuscleCredits } from '@/services/volumeTracker';
import { muscleMatchesGroup, resolveMuscleToStandard, toLegacyMuscleGroup } from '@/types/schema';

function block(
  id: string,
  name: string,
  primary: string,
  secondary: string[],
  workingSets: number
): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({
      id: `${id}-s${i}`,
      is_warmup: false,
      feedback: { repsInTank: 2 },
    })),
  };
}

describe('taxonomy: the heads are fine members, coarse stays coarse', () => {
  it('coarse triceps NEVER smears across the heads (the banned rule)', () => {
    expect(resolvePrimaryMuscleCredits('triceps')).toEqual([{ muscle: 'triceps', weight: 1 }]);
    // Secondary credit likewise stays on the coarse member (standard-first).
    expect(resolveMuscleToStandard('triceps')).toEqual(['triceps']);
  });

  it('coarse triceps still MATCHES head-tagged exercises (filters, pickers, injury exclusion)', () => {
    // Credit resolution and match expansion are different questions: a
    // 'triceps' program slot or injury exclusion must catch a retagged
    // pushdown, even though coarse credit never flows to the heads.
    expect(muscleMatchesGroup('triceps_lat_med', 'triceps')).toBe(true);
    expect(muscleMatchesGroup('triceps_long', 'triceps')).toBe(true);
    // The REVERSE is deliberately false (traps precedent): a coarse-tagged
    // exercise doesn't claim to hit one specific head.
    expect(muscleMatchesGroup('triceps', 'triceps_long')).toBe(false);
    expect(muscleMatchesGroup('biceps', 'triceps')).toBe(false);
    // Legacy round-trip for coarse-keyed tables (fiber profile, rep ranges).
    expect(toLegacyMuscleGroup('triceps_lat_med')).toBe('triceps');
    expect(toLegacyMuscleGroup('triceps_long')).toBe('triceps');
  });

  it('the triceps group carries both heads as fine children', () => {
    expect(COARSE_CHILDREN.triceps).toEqual(['triceps', 'triceps_long', 'triceps_lat_med']);
    expect(FINE_CHILD_MUSCLES.has('triceps_long')).toBe(true);
    expect(FINE_CHILD_MUSCLES.has('triceps_lat_med')).toBe(true);
  });

  it('approved bands: long 4–18 (near direct literature), lat+med 6–20 (total-inclusive)', () => {
    expect(getEffectiveBand('triceps_long')).toEqual({ mev: 4, mrv: 18 });
    expect(getEffectiveBand('triceps_lat_med')).toEqual({ mev: 6, mrv: 20 });
    expect(getEffectiveBand('triceps')).toEqual({ mev: 8, mrv: 24 });
  });
});

describe('the motivating week: pushdowns + pressing, zero overhead work', () => {
  // Post-retag tags: pushdowns are lat/med-primary with a 0.5 long-head
  // secondary; presses carry triceps_lat_med secondaries.
  const blocks: WeeklyVolumeBlockRow[] = [
    block('rope', 'Rope Tricep Pushdown', 'triceps_lat_med', ['triceps_long'], 3),
    block('press-machine', 'Triceps Press Machine', 'triceps_lat_med', ['chest_lower', 'front_delts'], 3),
    block('bb', 'Barbell Bench Press', 'chest', ['front_delts', 'triceps_lat_med'], 3),
    block('db', 'Dumbbell Bench Press', 'chest', ['front_delts', 'triceps_lat_med'], 3),
    block('mcp', 'Machine Chest Press', 'chest', ['front_delts', 'triceps_lat_med'], 2),
    block('ohp', 'Overhead Press', 'front_delts', ['triceps_lat_med', 'chest_upper'], 2),
  ];
  const rows = buildVolumeRows(computeWeeklyMuscleVolume(blocks), computeReachableMuscles(blocks));
  const triceps = rows.find((r) => r.muscle === 'triceps')!;
  const child = (m: string) => triceps.children.find((c) => c.muscle === m)!;

  it('group total is mid-zone — the number that used to hide the gap', () => {
    // lat/med: 6 direct (rope 3 + machine 3) + 0.5 × 10 press sets = 11;
    // long: 0.5 × 3 rope sets = 1.5; group = 12.5.
    expect(triceps.sets).toBe(12.5);
    expect(triceps.zone).toBe('in_zone');
  });

  it('the long head surfaces as a lagging, reachable child (only 0.5-credit pushdown scraps)', () => {
    const long = child('triceps_long');
    expect(long.sets).toBe(1.5); // rope 3 × 0.5 — no overhead work
    expect(long.reachable).toBe(true);
    expect(long.belowMev).toBe(true);
    // The group row may not render success while the long head lags.
    expect(triceps.laggingChildren).toBe(true);
  });

  it('lateral+medial collects the pressing inflow and reads in zone', () => {
    const latMed = child('triceps_lat_med');
    expect(latMed.sets).toBe(11); // 6 direct + 0.5 × 10 press sets
    expect(latMed.zone).toBe('in_zone');
  });

  it('overhead work fills the gap: two overhead-extension sessions clear the long head', () => {
    const withOverhead = [
      ...blocks,
      block('ohx', 'Overhead Tricep Extension', 'triceps_long', ['triceps_lat_med'], 3),
    ];
    const rows2 = buildVolumeRows(
      computeWeeklyMuscleVolume(withOverhead),
      computeReachableMuscles(withOverhead)
    );
    const triceps2 = rows2.find((r) => r.muscle === 'triceps')!;
    const long2 = triceps2.children.find((c) => c.muscle === 'triceps_long')!;
    expect(long2.sets).toBe(4.5); // 3 direct + rope's 1.5
    expect(long2.belowMev).toBe(false);
    expect(triceps2.laggingChildren).toBe(false);
  });
});

describe('reachability gating: a coarse-only library never shows the split', () => {
  it('coarse-triceps work leaves the heads unreachable and unexpanded', () => {
    const blocks: WeeklyVolumeBlockRow[] = [
      block('custom', 'My Triceps Thing', 'triceps', [], 5),
    ];
    const rows = buildVolumeRows(computeWeeklyMuscleVolume(blocks), computeReachableMuscles(blocks));
    const triceps = rows.find((r) => r.muscle === 'triceps')!;
    expect(triceps.sets).toBe(5);
    // No fine tag anywhere → the group is not expandable, no lagging-child
    // demotion, no un-clearable amber bar.
    expect(triceps.expandable).toBe(false);
    expect(triceps.children).toEqual([]);
    expect(triceps.laggingChildren).toBe(false);
  });
});
