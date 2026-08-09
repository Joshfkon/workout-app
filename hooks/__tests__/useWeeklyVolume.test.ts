/**
 * Regression tests for the "Train page and Home disagree on sets this week"
 * bug: Train read 208 sets while the home glance tile read 181.5 for the same
 * week.
 *
 * Cause: `useWeeklyVolume` ran its OWN accumulation and summed the 26 per-head
 * standard-muscle rows for the week total — uncapped (so within-group overlap
 * counted twice) and with `Math.round` applied to direct and indirect credit
 * separately on every row (so fractional credit rounded up 26 times over).
 *
 * The invariants below lock the fix down:
 *  1. PARITY — the hook's week totals are byte-identical to what the home
 *     glance tile computes (DashboardClient's `coarseMevTiles(buildVolumeRows)`)
 *     from the same rows.
 *  2. GROUP CAP — a group can never be credited more sets than were performed,
 *     while the per-head rows keep their (intentional) overlap.
 *  3. ROUND ONCE — direct + indirect always reconciles to the row total.
 */
import {
  buildVolumeRows,
  coarseMevTiles,
  computeReachableMuscles,
  computeWeeklyMuscleVolume,
  type WeeklyVolumeBlockRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { VolumeLandmarks } from '@/types/schema';
import { deriveWeeklyVolume } from '../useWeeklyVolume';

const landmarks = (): VolumeLandmarks => ({ mev: 6, mav: 12, mrv: 18 });

function block(
  id: string,
  primary_muscle: string,
  workingSets: number,
  secondary_muscles: string[] = []
): WeeklyVolumeBlockRow {
  return {
    exercises: { id, name: id, primary_muscle, secondary_muscles },
    set_logs: [
      ...Array.from({ length: workingSets }, (_, i) => ({
        id: `${id}-w${i}`,
        is_warmup: false,
        feedback: { repsInTank: 2 },
      })),
      { id: `${id}-warmup`, is_warmup: true, feedback: null },
    ],
  };
}

/**
 * A week whose exercises exercise every inflation path the old hook had:
 * within-group head pairs (pushdown, calf raise, incline press), cross-group
 * secondary inflow (bench -> delts/triceps), and fractional legacy splits.
 */
const WEEK: WeeklyVolumeBlockRow[] = [
  block('pushdown', 'triceps_lat_med', 4, ['triceps_long']),
  block('calf-raise', 'gastrocnemius', 4, ['soleus']),
  block('incline-press', 'chest_upper', 4, ['chest_lower', 'front_delts', 'triceps']),
  block('bench', 'chest', 4, ['front_delts', 'triceps']),
  block('row', 'back', 5, ['biceps', 'rear_delts']),
  block('squat', 'quads', 5, ['glutes']),
  block('curl', 'biceps', 3),
];

/** Exactly what DashboardClient does for the home glance tile. */
function homeGlanceTile(blocks: WeeklyVolumeBlockRow[]) {
  return coarseMevTiles(
    buildVolumeRows(computeWeeklyMuscleVolume(blocks), computeReachableMuscles(blocks))
  );
}

describe('useWeeklyVolume — parity with the home glance tile', () => {
  it('reports the same week totals the home tile computes from the same rows', () => {
    const { tiles } = deriveWeeklyVolume(WEEK, landmarks);
    expect(tiles).toEqual(homeGlanceTile(WEEK));
  });

  it('agrees on how many muscle groups are below MEV', () => {
    const { tiles } = deriveWeeklyVolume(WEEK, landmarks);
    // The Train page renders `lowCount` as "N muscle groups below minimum" and
    // the home tile as "N muscles below MEV" — one number, one taxonomy.
    expect(tiles.lowCount).toBe(homeGlanceTile(WEEK).lowCount);
  });

  it('carries effective volume, so the RIR weighting is not silently dropped', () => {
    const { tiles } = deriveWeeklyVolume(WEEK, landmarks);
    expect(tiles.totalEffectiveSets).toBeGreaterThan(0);
    expect(tiles.totalEffectiveSets).toBeLessThanOrEqual(tiles.totalSets);
  });
});

describe('useWeeklyVolume — the week total is not the per-head sum', () => {
  it('never credits a group more sets than were performed on it', () => {
    const { rows } = deriveWeeklyVolume(
      [block('pushdown', 'triceps_lat_med', 4, ['triceps_long'])],
      landmarks
    );
    // 4 performed sets crediting two heads of the same group is 1.0 + 0.5 per
    // set uncapped; the group may only ever receive the 4 sets performed.
    expect(rows.find((r) => r.muscle === 'triceps')!.sets).toBe(4);
  });

  it('keeps the per-head overlap that the group total caps away', () => {
    const { volumeData } = deriveWeeklyVolume(
      [block('pushdown', 'triceps_lat_med', 4, ['triceps_long'])],
      landmarks
    );
    const byMuscle = new Map(volumeData.map((v) => [v.muscleGroup, v]));
    // Per-head counters are independent and MAY overlap — correct for per-head
    // programming decisions, and why they must never be summed for a week total.
    expect(byMuscle.get('triceps_lat_med')!.totalSets).toBe(4);
    expect(byMuscle.get('triceps_long')!.totalSets).toBe(2);
  });

  it('reports fewer sets than summing the per-head rows would', () => {
    const { volumeData, tiles } = deriveWeeklyVolume(WEEK, landmarks);
    // This sum is what the Train page used to print (208 against the tile's
    // 181.5). It must stay strictly above the capped total, or the fixture no
    // longer covers the bug.
    const perHeadSum = volumeData.reduce((s, v) => s + v.totalSets, 0);
    expect(perHeadSum).toBeGreaterThan(tiles.totalSets);
  });
});

describe('useWeeklyVolume — rounding', () => {
  it('reconciles direct + indirect against the row total on every muscle', () => {
    const { volumeData } = deriveWeeklyVolume(WEEK, landmarks);
    for (const row of volumeData) {
      expect(row.directSets + row.indirectSets).toBe(row.totalSets);
    }
  });

  it('rounds the total once instead of rounding direct and indirect apart', () => {
    // chest_upper lands on exactly 2.5 direct (legacy 'chest' splits its 5 sets
    // across both heads) + 2.5 indirect (a dip crediting it as a secondary) =
    // 5.0 credited. Rounding the two components separately and adding them —
    // the old path — reports 3 + 3 = 6.
    const { volumeData } = deriveWeeklyVolume(
      [
        block('bench', 'chest', 5),
        block('dip', 'triceps_lat_med', 5, ['chest_upper']),
      ],
      landmarks
    );
    const chestUpper = volumeData.find((v) => v.muscleGroup === 'chest_upper')!;
    expect(chestUpper.totalSets).toBe(5);
    expect(chestUpper.directSets + chestUpper.indirectSets).toBe(5);
  });
});

describe('useWeeklyVolume — empty week', () => {
  it('reports zeros rather than "14 groups below MEV" when nothing is logged', () => {
    const { tiles, volumeData } = deriveWeeklyVolume([], landmarks);
    expect(tiles).toEqual({
      totalSets: 0,
      totalEffectiveSets: 0,
      totalTarget: 0,
      lowCount: 0,
    });
    expect(volumeData.every((v) => v.totalSets === 0)).toBe(true);
  });

  it('drops fine members no logged exercise can feed', () => {
    // A coarse-only week must not surface un-clearable below-MEV rows for the
    // fine heads (same reachability gate the shared row model applies).
    const { volumeData } = deriveWeeklyVolume([block('ohp', 'shoulders', 4)], landmarks);
    const muscles = volumeData.map((v) => v.muscleGroup);
    expect(muscles).not.toContain('glute_med');
    expect(muscles).not.toContain('soleus');
  });
});
