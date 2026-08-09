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
  rowColorToken,
  rowBarClass,
  COARSE_MUSCLES,
  type MuscleVolumeStats,
  type WeeklyVolumeBlockRow,
} from '../weeklyVolume';
import { RESEARCH_VOLUME_BANDS, MEV_TARGETS } from '@/services/volumeBands';

function stat(muscle: string, sets: number): MuscleVolumeStats {
  return { muscle, sets, effectiveSets: sets, unratedSets: 0, directSets: sets, indirectSets: 0, directEffectiveSets: sets, indirectEffectiveSets: 0, target: 0, status: 'optimal', exercises: [{ id: muscle, name: `${muscle} ex`, performedSets: sets, sets, effective: sets, direct: sets, indirect: 0, directEffective: sets, indirectEffective: 0 }] };
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

  it('always emits exactly the 14 coarse rows', () => {
    const rows = buildVolumeRows([stat('biceps', 5)]);
    expect(rows).toHaveLength(COARSE_MUSCLES.length);
  });

  it('carries an unreachable fine child only as an expand-only context row', () => {
    // Back trained via lats only; upper_back untrained (0) and unreachable.
    const blocks = [block('pd', 'lats', [], 10, 'Lat Pulldown')];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const back = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'back')!;
    // The back row is expandable (lats is reachable), so it carries ALL its
    // fine children — but unreachable upper_back is flagged reachable:false:
    // a context row the shared list only shows on an explicit expand, and the
    // warning/target selectors skip (its target rolls up into the parent).
    expect(back.expandable).toBe(true);
    const upperBack = back.children.find((c) => c.muscle === 'upper_back');
    expect(upperBack).toBeDefined();
    expect(upperBack!.reachable).toBe(false);
  });

  it('surfaces a reachable, lagging fine child under its parent', () => {
    // Directly trains upper_back (reachable) but only 1 set < MEV(4).
    const blocks = [
      block('fp', 'upper_back', [], 1, 'Face Pull'),
      block('pd', 'lats', [], 8, 'Lat Pulldown'),
    ];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const back = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'back')!;
    const upperBack = back.children.find((c) => c.muscle === 'upper_back');
    expect(upperBack).toBeDefined();
    expect(upperBack!.belowMev).toBe(true);
  });

  it('erectors is a TOP-LEVEL row, not a child of back', () => {
    // A hinge: primary glutes, secondary erectors + hamstrings. Its erector
    // credit must land on the standalone Erectors row and NOT inflate Back.
    const blocks = [block('dl', 'glutes', ['hamstrings', 'erectors'], 8, 'Deadlift')];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const rows = buildVolumeRows(stats, reachable);

    const back = rows.find((r) => r.muscle === 'back')!;
    expect(back.children.map((c) => c.muscle)).toEqual(
      expect.not.arrayContaining(['erectors'])
    );
    expect(back.sets).toBe(0);

    const erectors = rows.find((r) => r.muscle === 'erectors')!;
    expect(erectors.isChild).toBe(false);
    expect(erectors.parent).toBeNull();
    expect(erectors.children).toHaveLength(0);
    // 8 sets at the 0.5 secondary credit — the regroup moves credit, it does
    // not change the crediting math.
    expect(erectors.sets).toBe(4);
    // Promoted with its existing per-muscle zone.
    expect(erectors.band).toEqual({ mev: 4, mrv: 12 });
  });

  it('keeps the Back row on its own zone, with no erector credit', () => {
    const blocks = [
      block('pd', 'lats', [], 8, 'Lat Pulldown'),
      block('dl', 'glutes', ['erectors'], 10, 'Deadlift'),
    ];
    const rows = buildVolumeRows(
      computeWeeklyMuscleVolume(blocks),
      computeReachableMuscles(blocks)
    );
    const back = rows.find((r) => r.muscle === 'back')!;
    expect(back.sets).toBe(8); // lats only — the deadlift contributes nothing
    expect(back.band).toEqual({ mev: 10, mrv: 25 });
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

describe('fine-child bands are per-subdivision research landmarks (not parent slices)', () => {
  it('shoulders heads use their own total-inclusive bands — front delts no longer capped at parent/3', () => {
    const rows = buildVolumeRows([stat('front_delts', 10)]);
    const shoulders = rows.find((r) => r.muscle === 'shoulders')!;
    const front = shoulders.children.find((c) => c.muscle === 'front_delts')!;
    // Old synthesis: mrv = max(mev+2, round(22/3)) = 7 → 10 sets read over-MRV
    // red for anyone who benches. Adopted total-inclusive band: {2, 14}
    // (pressing routinely supplies 4–6 indirect sets; MEV near 0 direct is
    // fine when pressing volume exists).
    expect(front.band).toEqual({ mev: 2, mrv: 14 });
    expect(front.zone).toBe('in_zone');
    expect(shoulders.children.find((c) => c.muscle === 'lateral_delts')!.band).toEqual({ mev: 6, mrv: 20 });
    // Rear MRV revisited with the total-inclusive shift: 18 direct-reading
    // → 20 to absorb routine pulling inflow, MEV 4 → 3.
    expect(shoulders.children.find((c) => c.muscle === 'rear_delts')!.band).toEqual({ mev: 3, mrv: 20 });
  });
});

describe('parent color is gated on child states (rowColorToken)', () => {
  it('a parent in its group zone can NEVER read green while a reachable child is under its own MEV', () => {
    // Parent 13 ≥ total-inclusive group MEV 12 (in_zone), but side delts sit
    // at 4 < their MEV 6 — a lagging subdivision behind an in-zone aggregate.
    const blocks = [
      block('fr', 'front_delts', [], 5),
      block('la', 'lateral_delts', [], 4),
      block('re', 'rear_delts', [], 4),
    ];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const shoulders = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'shoulders')!;

    expect(shoulders.zone).toBe('in_zone'); // the band alone would say green…
    expect(shoulders.laggingChildren).toBe(true); // …but children are lagging
    expect(rowColorToken(shoulders)).toBe('warning'); // so the row demotes
    expect(rowBarClass(shoulders)).toBe('bg-warning-500');
    // The zone itself is untouched — bands/markers still render correctly.
    expect(volumeZone(shoulders.sets, shoulders.band)).toBe('in_zone');
  });

  it('an in-zone parent whose children are all at/above their own MEV stays green', () => {
    const blocks = [
      block('fr', 'front_delts', [], 4),
      block('la', 'lateral_delts', [], 6),
      block('re', 'rear_delts', [], 4),
    ];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const shoulders = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'shoulders')!;

    expect(shoulders.zone).toBe('in_zone');
    expect(shoulders.laggingChildren).toBe(false);
    expect(rowColorToken(shoulders)).toBe('success');
  });

  it('an UNREACHABLE lagging child does not demote the parent (context rows never nag)', () => {
    // Only coarse-calves tagging: gastroc/soleus are unreachable context rows.
    const blocks = [block('cr', 'calves', [], 10, 'Standing Calf Raise')];
    const stats = computeWeeklyMuscleVolume(blocks);
    const reachable = computeReachableMuscles(blocks);
    const calves = buildVolumeRows(stats, reachable).find((r) => r.muscle === 'calves')!;
    expect(calves.zone).toBe('in_zone');
    expect(calves.laggingChildren).toBe(false);
    expect(rowColorToken(calves)).toBe('success');
  });
});

describe('group total vs Σ(sub-muscle rows) — the documented dedup rule', () => {
  // The rule (buildVolumeRows, GROUP SET-CREDIT CAP): per exercise, a group's
  // credit is capped at 1.0 per PERFORMED set, so one set worked across two
  // heads of the same group counts ONCE for the group. Sub-muscle rows keep
  // their uncapped per-head credit, which is what per-head programming needs.
  // The two numbers are therefore not required to agree, and the UI says so
  // (ContributingSets' group-scope footnote).

  it('reconciles exactly when no exercise spans two heads of the group', () => {
    const blocks = [
      block('pd', 'lats', [], 8, 'Lat Pulldown'),
      block('fp', 'upper_back', [], 6, 'Face Pull'),
    ];
    const back = buildVolumeRows(
      computeWeeklyMuscleVolume(blocks),
      computeReachableMuscles(blocks)
    ).find((r) => r.muscle === 'back')!;

    const childSum = back.children.reduce((s, c) => s + c.sets, 0);
    expect(back.sets).toBe(14);
    expect(childSum).toBe(14);
  });

  it('group total is LOWER than Σ(children) by exactly the within-group overlap', () => {
    // A row tagged primary lats + secondary upper_back: each head is credited
    // independently (8 + 4 = 12) but the group is capped at the 8 performed
    // sets. Gap = 4 = the secondary head's 0.5 credit on 8 sets.
    const blocks = [block('row', 'lats', ['upper_back'], 8, 'Barbell Row')];
    const back = buildVolumeRows(
      computeWeeklyMuscleVolume(blocks),
      computeReachableMuscles(blocks)
    ).find((r) => r.muscle === 'back')!;

    const childSum = back.children.reduce((s, c) => s + c.sets, 0);
    expect(childSum).toBe(12);
    expect(back.sets).toBe(8); // capped at performed sets, not 12
    expect(childSum - back.sets).toBe(4);
  });

  it('erector credit no longer participates in the back reconciliation at all', () => {
    // Pre-promotion this deadlift put 5 credited sets on back's erector child,
    // widening the gap between the group header and its sub-muscle rows.
    const blocks = [
      block('row', 'lats', ['upper_back'], 8, 'Barbell Row'),
      block('dl', 'glutes', ['erectors'], 10, 'Deadlift'),
    ];
    const rows = buildVolumeRows(
      computeWeeklyMuscleVolume(blocks),
      computeReachableMuscles(blocks)
    );
    const back = rows.find((r) => r.muscle === 'back')!;
    const erectors = rows.find((r) => r.muscle === 'erectors')!;

    expect(back.children.reduce((s, c) => s + c.sets, 0) - back.sets).toBe(4);
    expect(erectors.sets).toBe(5);
    // Erectors is its own group: nothing overlaps it, so it reconciles trivially.
    expect(erectors.children).toHaveLength(0);
  });

  it('the cap never lets a group total exceed the sets actually performed', () => {
    const blocks = [
      block('row', 'lats', ['upper_back'], 8, 'Barbell Row'),
      block('pd', 'lats', ['upper_back'], 6, 'Lat Pulldown'),
    ];
    const back = buildVolumeRows(
      computeWeeklyMuscleVolume(blocks),
      computeReachableMuscles(blocks)
    ).find((r) => r.muscle === 'back')!;

    expect(back.sets).toBe(14); // 8 + 6 performed, not 21 credited
    expect(back.sets).toBeLessThan(back.children.reduce((s, c) => s + c.sets, 0));
  });
});
