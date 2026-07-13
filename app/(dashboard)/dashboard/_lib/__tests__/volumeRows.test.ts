/**
 * The unified presentation model: coarse rows with fine children, the shared
 * MEV–MRV band, and the one zone rule (green across the whole band, red only
 * past MRV). Every surface renders from buildVolumeRows so counts and
 * zone-status can't diverge.
 */

import {
  buildVolumeRows,
  volumeZone,
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  RESEARCH_VOLUME_BANDS,
  COARSE_MUSCLES,
  type MuscleVolumeStats,
  type WeeklyVolumeBlockRow,
} from '../weeklyVolume';

function stat(muscle: string, sets: number): MuscleVolumeStats {
  return { muscle, sets, target: 0, status: 'optimal', exercises: [{ id: muscle, name: `${muscle} ex`, sets }] };
}

function block(id: string, primary: string, secondary: string[], workingSets: number, name = id): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({ id: `${id}-s${i}`, is_warmup: false })),
  };
}

describe('volumeZone — green across the whole band, red only past MRV', () => {
  const band = { mev: 8, mrv: 20 };
  it('below MEV', () => expect(volumeZone(7, band)).toBe('below_mev'));
  it('exactly at MEV is in-zone (hitting target is not punished)', () =>
    expect(volumeZone(8, band)).toBe('in_zone'));
  it('mid-band', () => expect(volumeZone(14, band)).toBe('in_zone'));
  it('exactly at MRV is still in-zone', () => expect(volumeZone(20, band)).toBe('in_zone'));
  it('past MRV is over', () => expect(volumeZone(21, band)).toBe('over_mrv'));
});

describe('buildVolumeRows — coarse rows + fine children', () => {
  it('rolls fine standard muscles up into their coarse parent count', () => {
    // 6 upper-chest + 6 lower-chest sets → one "Chest" row at 12.
    const rows = buildVolumeRows([stat('chest_upper', 6), stat('chest_lower', 6)]);
    const chest = rows.find((r) => r.muscle === 'chest')!;
    expect(chest.sets).toBe(12);
    expect(chest.band).toEqual(RESEARCH_VOLUME_BANDS.chest);
    expect(chest.zone).toBe('in_zone'); // 12 within 8–22
  });

  it('always emits exactly the 13 coarse rows', () => {
    const rows = buildVolumeRows([stat('biceps', 5)]);
    expect(rows).toHaveLength(COARSE_MUSCLES.length);
  });

  it('carries a fine child only when the user\'s exercises can feed it (reachable)', () => {
    // Coarse back trained via lats; erectors untrained (0) and unreachable.
    const blocks = [block('pd', 'lats', [], 10, 'Lat Pulldown')];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const back = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'back')!;
    // erectors is a fine child but unreachable from coarse-ish lat work → dropped
    // from the hierarchy entirely (its target rolls up into the parent).
    expect(back.children.some((c) => c.muscle === 'erectors')).toBe(false);
  });

  it('surfaces a reachable, lagging fine child under its parent', () => {
    // Directly trains erectors (reachable) but only 1 set < MEV(4).
    const blocks = [
      block('be', 'erectors', [], 1, 'Machine Back Extension'),
      block('pd', 'lats', [], 8, 'Lat Pulldown'),
    ];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const back = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'back')!;
    const erectors = back.children.find((c) => c.muscle === 'erectors');
    expect(erectors).toBeDefined();
    expect(erectors!.belowMev).toBe(true);
  });

  it('carries an in-zone fine child (flagged not-lagging) — visibility is the list component\'s job', () => {
    const blocks = [block('ab', 'glute_med', [], 5, 'Cable Hip Abduction')]; // 5 > MEV(2)
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);

    // The data layer always carries reachable children; whether an in-zone
    // child is shown (behind the chevron) or pinned (lagging) is decided by
    // the shared MuscleGroupList / withVisibleChildren, not here.
    const glutes = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'glutes')!;
    const gluteMed = glutes.children.find((c) => c.muscle === 'glute_med');
    expect(gluteMed).toBeDefined();
    expect(gluteMed!.belowMev).toBe(false);
  });

  it('sorts below-MEV coarse rows first', () => {
    const rows = buildVolumeRows([stat('biceps', 30)]); // biceps way over, rest at 0
    // The first row must be below MEV (untrained), never the over-target one.
    expect(rows[0].belowMev).toBe(true);
    expect(rows[rows.length - 1].muscle).toBe('biceps');
  });

  it('applies a learned/override band when supplied', () => {
    const rows = buildVolumeRows([stat('biceps', 10)], undefined, { bands: { biceps: { mev: 12, mrv: 24 } } });
    const biceps = rows.find((r) => r.muscle === 'biceps')!;
    expect(biceps.band).toEqual({ mev: 12, mrv: 24 });
    expect(biceps.zone).toBe('below_mev'); // 10 < learned MEV 12
  });
});
