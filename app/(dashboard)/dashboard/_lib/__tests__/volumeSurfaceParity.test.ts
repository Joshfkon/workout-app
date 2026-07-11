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
  RESEARCH_VOLUME_BANDS,
  type WeeklyVolumeBlockRow,
  type CoarseMuscle,
} from '../weeklyVolume';
import { buildReadinessRows } from '../../workout/[id]/_lib/readiness';

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
