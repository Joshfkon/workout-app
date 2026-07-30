/**
 * Cross-surface parity: ONE fixture must produce identical per-muscle counts
 * and identical zone-status on every surface — the volume page bars, the
 * Home/Train widget, the readiness sheet and the insufficient-volume warning.
 * This is the guardrail against the "12 vs 10 biceps / MEV 4 vs MRV 20 / fine
 * vs coarse" divergence that motivated the unification: all four now render the
 * same coarse rows from the same shared counter + band.
 */

import {
  computeWeeklyMuscleVolume,
  computeReachableMuscles,
  buildVolumeRows,
  coarseMevTiles,
  belowMevVolumeData,
  volumeZone,
  zoneBarClass,
  zoneFillClass,
  zoneColorToken,
  COARSE_CHILDREN,
  type WeeklyVolumeBlockRow,
  type CoarseMuscle,
} from '../weeklyVolume';
import { RESEARCH_VOLUME_BANDS, MEV_TARGETS } from '@/services/volumeBands';
import { buildReadinessRows } from '../../workout/[id]/_lib/readiness';
import { volumeRowsToMapData, readinessRowsToMapData } from '@/lib/muscleMap/adapters';
import type { RecoverySession } from '@/services/muscleRecovery';

const NOW = new Date('2026-07-11T12:00:00.000Z');

function block(id: string, primary: string, secondary: string[], workingSets: number, name = id): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name, primary_muscle: primary, secondary_muscles: secondary },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({ id: `${id}-s${i}`, is_warmup: false })),
  };
}

// A realistic mixed week: presses, a row, a squat, curls, and an isolation.
const blocks: WeeklyVolumeBlockRow[] = [
  block('bench', 'chest', ['front_delts', 'triceps'], 4, 'Barbell Bench Press'),
  block('row', 'back', ['biceps', 'rear_delts', 'forearms'], 4, 'Barbell Row'),
  block('squat', 'quads', ['glutes', 'adductors', 'erectors'], 5, 'Barbell Back Squat'),
  block('curl', 'biceps', [], 3, 'Dumbbell Curl'),
  block('be', 'erectors', [], 1, 'Machine Back Extension'),
];

const stats = computeWeeklyMuscleVolume(blocks);
const reachable = computeReachableMuscles(blocks);

// The four surfaces, all from the shared model:
const volumeRows = buildVolumeRows(stats, reachable); // volume page bars
const readinessRows = buildReadinessRows(stats, [], NOW, reachable); // readiness sheet
const tiles = coarseMevTiles(volumeRows); // Home/Train widget
const belowMev = belowMevVolumeData(volumeRows); // insufficient-volume warning

describe('cross-surface parity (one fixture, four surfaces)', () => {
  it('readiness sheet and volume page agree on every coarse count AND zone', () => {
    expect(readinessRows).toHaveLength(volumeRows.length);
    for (const vr of volumeRows) {
      const rr = readinessRows.find((r) => r.muscle === vr.muscle)!;
      expect(rr).toBeDefined();
      expect(rr.sets).toBe(vr.sets); // identical count
      expect(rr.zone).toBe(vr.zone); // identical zone-status
      expect(rr.band).toEqual(vr.band); // identical denominator band
    }
  });

  it('volume page and readiness sheet carry the IDENTICAL hierarchy (same fine children per parent)', () => {
    for (const vr of volumeRows) {
      const rr = readinessRows.find((r) => r.muscle === vr.muscle)!;
      expect(rr.children.map((c) => c.muscle)).toEqual(vr.children.map((c) => c.muscle));
    }
  });

  it('the widget lowCount equals the number of below-MEV coarse rows', () => {
    const belowRows = volumeRows.filter((r) => r.zone === 'below_mev');
    expect(tiles.lowCount).toBe(belowRows.length);
    // totalSets/totalTarget are the coarse rollups, not a separate taxonomy.
    expect(tiles.totalSets).toBe(volumeRows.reduce((s, r) => s + r.sets, 0));
    expect(tiles.totalTarget).toBe(volumeRows.reduce((s, r) => s + r.band.mev, 0));
  });

  it('the warning lists exactly the below-MEV coarse rows (+ lagging children), same sets', () => {
    const coarseBelow = volumeRows.filter((r) => r.zone === 'below_mev').map((r) => r.muscle);
    for (const muscle of coarseBelow) {
      const entry = belowMev.find((d) => d.muscleGroup === (muscle as string));
      expect(entry).toBeDefined();
      const row = volumeRows.find((r) => r.muscle === muscle)!;
      expect(entry!.totalSets).toBe(row.sets);
      // The warning's zone is below MEV against the SAME band the bar uses.
      expect(volumeZone(entry!.totalSets, { mev: entry!.landmarks.mev, mrv: entry!.landmarks.mrv })).toBe('below_mev');
    }
  });

  it('every surface uses the shared research band (no per-surface MEV/MRV table)', () => {
    for (const row of volumeRows) {
      expect(row.band).toEqual(RESEARCH_VOLUME_BANDS[row.muscle as CoarseMuscle]);
    }
  });

  it('the muscle map paints every region with the SAME zone/sets as its bar (fifth surface)', () => {
    const mapData = volumeRowsToMapData(volumeRows);
    for (const row of volumeRows) {
      const childByMuscle = new Map(row.children.map((c) => [c.muscle, c]));
      for (const std of COARSE_CHILDREN[row.muscle as CoarseMuscle]) {
        const datum = mapData[std];
        expect(datum).toBeDefined();
        // A rendered fine-child bar overrides its own region; every other
        // region shows its coarse bar's zone. Either way the map's datum is
        // byte-identical to a bar on the same screen — same zone, same sets,
        // and therefore the same color token from the same shared helper.
        const source = childByMuscle.get(std) ?? row;
        expect(datum!.zone).toBe(source.zone);
        expect(datum!.value).toBe(source.sets);
        expect(zoneColorToken(datum!.zone!, datum!.value)).toBe(
          zoneColorToken(source.zone, source.sets)
        );
      }
    }
  });

  it('biceps mid-band is green on the map AND the bar, via the same zone helper', () => {
    // 10 sets sits inside the biceps 6–20 band.
    const midBand = [block('curl', 'biceps', [], 10, 'Dumbbell Curl')];
    const s = computeWeeklyMuscleVolume(midBand);
    const r = computeReachableMuscles(midBand);
    const rows = buildVolumeRows(s, r);
    const bicepsRow = rows.find((x) => x.muscle === 'biceps')!;
    expect(bicepsRow.zone).toBe('in_zone');

    const datum = volumeRowsToMapData(rows).biceps!;
    expect(datum.zone).toBe('in_zone');
    // Same helper family, same token: bar green ⇔ map region green.
    expect(zoneBarClass(bicepsRow.zone, bicepsRow.sets)).toBe('bg-success-500');
    expect(zoneFillClass(datum.zone!, datum.value)).toBe('fill-success-500');
  });

  it('recovery map matches the readiness rows on a shared fixture (asserted, not by construction)', () => {
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600 * 1000);
    const sets = (n: number) => Array.from({ length: n }, () => ({ repsInTank: 2 }));
    const history: RecoverySession[] = [
      // quads 6h ago → fatigued; secondary glutes credit recovers faster.
      { performedAt: hoursAgo(6), exercises: [{ primaryMuscle: 'quads', secondaryMuscles: ['glutes'], sets: sets(5) }] },
      // chest 40h ago → recovering (0.6×48h ≤ 40h < 48h window).
      { performedAt: hoursAgo(40), exercises: [{ primaryMuscle: 'chest', secondaryMuscles: [], sets: sets(4) }] },
      // biceps 60h ago → fresh (past the 36h window), lastTrainedAt set.
      { performedAt: hoursAgo(60), exercises: [{ primaryMuscle: 'biceps', secondaryMuscles: [], sets: sets(4) }] },
    ];
    const rRows = buildReadinessRows(stats, history, NOW, reachable);
    const rMap = readinessRowsToMapData(rRows);

    // Spot-check the fixture produced all three statuses (guards against a
    // vacuous loop below if the recovery heuristic changes).
    expect(rRows.find((r) => r.muscle === 'quads')!.recovery.status).toBe('fatigued');
    expect(rRows.find((r) => r.muscle === 'chest')!.recovery.status).toBe('recovering');
    expect(rRows.find((r) => r.muscle === 'biceps')!.recovery.status).toBe('fresh');

    for (const row of rRows) {
      const childByMuscle = new Map(row.children.map((c) => [c.muscle, c]));
      for (const std of COARSE_CHILDREN[row.muscle]) {
        const datum = rMap[std];
        const source = childByMuscle.get(std) ?? row;
        if (source.recovery.lastTrainedAt === null) {
          // "No recent data" badge ⇒ neutral region, never a status color.
          expect(datum).toBeUndefined();
        } else {
          expect(datum).toBeDefined();
          expect(datum!.status).toBe(source.recovery.status);
        }
      }
    }
  });

  it('child sets roll up to the parent exactly once (no double-count)', () => {
    // Mixed coarse + fine tagging in the same week: coarse 'calves'/'traps'
    // credit stays on the coarse standard bucket; fine tags credit the fine
    // member. The parent row derives from per-exercise credits with the
    // per-group cap (services/shared/volumeCredit) — an exercise whose
    // primary head + same-group secondary sum past 1.0/set credits the group
    // its performed sets, never more. Child (head) counters keep the overlap.
    const mixed = [
      block('coarse-calf', 'calves', [], 5, 'Old Coarse Calf Raise'),
      block('standing', 'gastrocnemius', ['soleus'], 4, 'Standing Calf Raise'),
      block('seated', 'soleus', ['gastrocnemius'], 2, 'Seated Calf Raise'),
      block('shrug', 'upper_traps', [], 3, 'Barbell Shrug'),
      block('carry', 'forearms', ['traps'], 2, "Farmer's Carry"),
    ];
    const s = computeWeeklyMuscleVolume(mixed);
    const r = computeReachableMuscles(mixed);
    // Rows carry ALL fine children of expandable groups — no expansion needed.
    const rows = buildVolumeRows(s, r);

    const calves = rows.find((x) => x.muscle === 'calves')!;
    const calvesChildren = new Map(calves.children.map((c) => [c.muscle, c]));
    // Heads overlap by design: gastroc 4 + 0.5×2 = 5, soleus 2 + 0.5×4 = 4.
    expect(calvesChildren.get('gastrocnemius')!.sets).toBe(5);
    expect(calvesChildren.get('soleus')!.sets).toBe(4);
    // Group: coarse bucket 5 + standing capped 4 + seated capped 2 = 11 —
    // exactly the 11 performed sets, not the 14 the head overlap would sum to.
    expect(calves.sets).toBe(11);

    const traps = rows.find((x) => x.muscle === 'traps')!;
    const trapsChildren = new Map(traps.children.map((c) => [c.muscle, c]));
    // upper 3, mid/lower 0, coarse bucket 0.5×2 = 1 → parent 4.
    expect(trapsChildren.get('upper_traps')!.sets).toBe(3);
    expect(traps.sets).toBe(4);
  });

  it('a muscle at exactly MEV is in-zone (green) on every surface — target not punished', () => {
    // chest: bench 4 (chest) + no other chest work = 4 sets. Force it to MEV.
    const atMev = [block('press', 'chest', [], RESEARCH_VOLUME_BANDS.chest.mev, 'Press')];
    const s = computeWeeklyMuscleVolume(atMev);
    const r = computeReachableMuscles(atMev);
    const vRow = buildVolumeRows(s, r).find((x) => x.muscle === 'chest')!;
    const rRow = buildReadinessRows(s, [], NOW, r).find((x) => x.muscle === 'chest')!;
    expect(vRow.zone).toBe('in_zone');
    expect(rRow.zone).toBe('in_zone');
    expect(belowMevVolumeData(buildVolumeRows(s, r)).some((d) => d.muscleGroup === ('chest' as string))).toBe(false);
  });
});
