/**
 * volumeProjection — per-day bucketing of credited group sets and the rolling
 * 7-day decay forecast ("when does this muscle's weekly count fall off?").
 *
 * The bucketing must agree with the canonical crediting the coarse rows use
 * (weighted primary split, 0.5 secondary, within-group cap), so the last test
 * reconciles Σ(daily buckets) against buildVolumeRows' own row totals over the
 * same blocks.
 */

import {
  computeDailyGroupSets,
  projectRollingSets,
  firstDayBelow,
  ROLLING_WINDOW_DAYS,
  FORECAST_HORIZON_DAYS,
  type DatedVolumeBlock,
} from '../volumeProjection';
import {
  buildVolumeRows,
  computeWeeklyMuscleVolume,
  type WeeklyVolumeBlockRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';

/** Fixed local "now" (mid-day, away from day boundaries). */
const NOW = new Date(2026, 7, 21, 14, 30); // Aug 21 2026, 14:30 local

/** ISO timestamp `daysAgo` local days before NOW (same wall-clock time). */
function daysAgoISO(daysAgo: number): string {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo, 10, 0);
  return d.toISOString();
}

function block(
  daysAgo: number,
  primary: string | null,
  secondaries: string[],
  workingSets: number
): DatedVolumeBlock {
  return {
    completedAt: daysAgo >= 0 ? daysAgoISO(daysAgo) : null,
    primaryMuscle: primary,
    secondaryMuscles: secondaries,
    workingSets,
  };
}

describe('computeDailyGroupSets', () => {
  it('buckets credited sets by local day, indexed by days ago', () => {
    const daily = computeDailyGroupSets(
      [block(0, 'biceps', [], 3), block(3, 'biceps', [], 2)],
      NOW
    );
    expect(daily.biceps).toEqual([3, 0, 0, 2, 0, 0, 0]);
  });

  it('applies secondary (0.5) credit like the row counter', () => {
    // Lat pulldown: back work with biceps secondary credit.
    const daily = computeDailyGroupSets([block(1, 'lats', ['biceps'], 4)], NOW);
    expect(daily.back?.[1]).toBe(4);
    expect(daily.biceps?.[1]).toBe(2);
  });

  it('caps within-group credit at 1.0 per performed set', () => {
    // Primary one chest head + secondary the other: the GROUP still gets at
    // most 1.0 per set (4 sets -> 4 chest sets, never 6).
    const daily = computeDailyGroupSets(
      [block(0, 'chest_upper', ['chest_lower'], 4)],
      NOW
    );
    expect(daily.chest?.[0]).toBe(4);
  });

  it('skips blocks outside the window, future blocks, and unusable rows', () => {
    const daily = computeDailyGroupSets(
      [
        block(ROLLING_WINDOW_DAYS, 'biceps', [], 3), // aged out
        block(-1, 'biceps', [], 3), // null completedAt (guarded in helper)
        { completedAt: daysAgoISO(-2), primaryMuscle: 'biceps', secondaryMuscles: [], workingSets: 3 }, // future
        { completedAt: 'not-a-date', primaryMuscle: 'biceps', secondaryMuscles: [], workingSets: 3 },
        block(0, null, [], 3), // no primary tag
        block(0, 'biceps', [], 0), // no working sets
      ],
      NOW
    );
    expect(daily.biceps).toBeUndefined();
  });

  it('buckets by LOCAL calendar day, not 24h distance', () => {
    // Yesterday 23:50 local is <15h before NOW but is still "1 day ago".
    const lateYesterday = new Date(
      NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1, 23, 50
    ).toISOString();
    const daily = computeDailyGroupSets(
      [{ completedAt: lateYesterday, primaryMuscle: 'biceps', secondaryMuscles: [], workingSets: 2 }],
      NOW
    );
    expect(daily.biceps).toEqual([0, 2, 0, 0, 0, 0, 0]);
  });
});

describe('projectRollingSets', () => {
  it('decays as buckets age out and reaches 0 at the horizon', () => {
    // today 3, 3 days ago 2, 6 days ago 4.
    const projection = projectRollingSets([3, 0, 0, 2, 0, 0, 4]);
    expect(projection).toEqual([9, 5, 5, 5, 3, 3, 3, 0]);
    expect(projection).toHaveLength(FORECAST_HORIZON_DAYS + 1);
  });

  it('is monotonically non-increasing (nothing new is ever assumed)', () => {
    const projection = projectRollingSets([1, 2, 0.5, 3, 0, 4, 1.5]);
    for (let d = 1; d < projection.length; d++) {
      expect(projection[d]).toBeLessThanOrEqual(projection[d - 1]);
    }
  });

  it('rounds to one decimal at emission, drift-guarded', () => {
    // Three 1/3-credits per day accumulate float dust below a rational total.
    const third = 1 / 3;
    const projection = projectRollingSets([third + third + third + 0.8, 0, 0, 0, 0, 0, 0]);
    expect(projection[0]).toBe(1.8);
  });

  it('handles an empty window', () => {
    expect(projectRollingSets([])).toEqual(new Array(FORECAST_HORIZON_DAYS + 1).fill(0));
  });
});

describe('firstDayBelow', () => {
  const projection = [9, 5, 5, 5, 3, 3, 3, 0];

  it('returns 0 when already below the threshold', () => {
    expect(firstDayBelow(projection, 10)).toBe(0);
  });

  it('returns the first future day the projection dips below', () => {
    expect(firstDayBelow(projection, 6)).toBe(1);
    expect(firstDayBelow(projection, 4)).toBe(4);
    // Strictly below: a day AT the threshold still holds.
    expect(firstDayBelow(projection, 5)).toBe(4);
    expect(firstDayBelow(projection, 1)).toBe(7);
  });

  it('returns null when the projection never goes below', () => {
    expect(firstDayBelow(projection, 0)).toBeNull();
  });
});

describe('reconciliation with the shared row model', () => {
  it('Σ(daily buckets) equals the coarse row totals for the same blocks', () => {
    // A small realistic week: bench (chest + shoulder/tricep spillover),
    // curls, lat pulldown (back + biceps secondary), spread over 3 days.
    const exercises = [
      { id: 'bench', name: 'Bench Press', primary_muscle: 'chest', secondary_muscles: ['front_delts', 'triceps'] },
      { id: 'curl', name: 'Bicep Curl', primary_muscle: 'biceps', secondary_muscles: [] },
      { id: 'row', name: 'Lat Pulldown', primary_muscle: 'lats', secondary_muscles: ['biceps'] },
    ];
    const plan: { daysAgo: number; ex: (typeof exercises)[number]; sets: number }[] = [
      { daysAgo: 0, ex: exercises[0], sets: 4 },
      { daysAgo: 2, ex: exercises[1], sets: 3 },
      { daysAgo: 2, ex: exercises[2], sets: 4 },
      { daysAgo: 5, ex: exercises[0], sets: 3 },
    ];

    const weeklyBlocks: WeeklyVolumeBlockRow[] = plan.map(({ ex, sets }) => ({
      exercises: ex,
      set_logs: Array.from({ length: sets }, (_, i) => ({ id: `${ex.id}-${i}`, is_warmup: false })),
    }));
    const rows = buildVolumeRows(computeWeeklyMuscleVolume(weeklyBlocks));

    const daily = computeDailyGroupSets(
      plan.map(({ daysAgo, ex, sets }) =>
        block(daysAgo, ex.primary_muscle, ex.secondary_muscles, sets)
      ),
      NOW
    );

    for (const row of rows) {
      const bucketTotal = projectRollingSets(
        daily[row.muscle as keyof typeof daily] ?? []
      )[0];
      expect(bucketTotal).toBe(row.sets);
    }
  });
});
