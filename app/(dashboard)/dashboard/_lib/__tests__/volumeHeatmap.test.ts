import {
  computeVolumeHeatmap,
  getHeatmapTimeframe,
  heatLevel,
  HEATMAP_TIMEFRAMES,
  HEAT_FILL_CLASSES,
  HEAT_LEVELS,
  type HeatmapBlockRow,
} from '../volumeHeatmap';
import { getEffectiveBand, COARSE_MUSCLES } from '@/services/volumeBands';

/** Block row with a session completion timestamp, for the window clamp. */
function datedBlock(
  exerciseId: string,
  primaryMuscle: string,
  workingSets: number,
  completedAt: string
): HeatmapBlockRow {
  return {
    exercises: { id: exerciseId, name: exerciseId, primary_muscle: primaryMuscle, secondary_muscles: [] },
    set_logs: Array.from({ length: workingSets }, (_, i) => ({ id: `${exerciseId}-${completedAt}-${i}`, is_warmup: false })),
    workout_sessions: { completed_at: completedAt },
  };
}

const NOW = new Date(2026, 7, 23, 18, 0, 0); // local Aug 23 2026, 18:00

describe('heatLevel — the MEV-weighted color buckets', () => {
  // chest band {mev 8, mrv 22}: span 14, thirds at 12.67 and 17.33.
  const band = getEffectiveBand('chest');

  it('reds/amber below MEV: untrained at 0, solid red under half MEV, amber under MEV', () => {
    expect(heatLevel(0, band)).toBe('untrained');
    expect(heatLevel(1, band)).toBe('critical');
    expect(heatLevel(3.9, band)).toBe('critical'); // just under mev/2 = 4
    expect(heatLevel(4, band)).toBe('below'); // exactly half MEV is amber
    expect(heatLevel(7.9, band)).toBe('below');
  });

  it('greens darken across the MEV–MRV band in thirds, darkest past MRV', () => {
    expect(heatLevel(8, band)).toBe('low'); // at MEV
    expect(heatLevel(12, band)).toBe('low'); // bottom third
    expect(heatLevel(13, band)).toBe('moderate'); // middle third
    expect(heatLevel(18, band)).toBe('high'); // top third
    expect(heatLevel(22, band)).toBe('high'); // at MRV still in-zone
    expect(heatLevel(22.1, band)).toBe('very_high'); // past MRV
  });

  it('every level has a fill class (legend/map can never miss a bucket)', () => {
    for (const level of HEAT_LEVELS) {
      expect(HEAT_FILL_CLASSES[level]).toMatch(/^fill-/);
    }
  });
});

describe('getHeatmapTimeframe', () => {
  it('resolves every advertised timeframe id', () => {
    for (const t of HEATMAP_TIMEFRAMES) {
      expect(getHeatmapTimeframe(t.id)).toBe(t);
    }
  });
});

describe('computeVolumeHeatmap', () => {
  it('averages window totals into weekly sets and buckets them against the group band', () => {
    // 4 weekly chest sessions of 6 working sets across a 28-day window →
    // 24 total, 6/wk average — under chest's MEV of 8, within reach → amber.
    const blocks = [0, 7, 14, 21].map((daysAgo) =>
      datedBlock('bench', 'chest', 6, new Date(2026, 7, 23 - daysAgo, 10).toISOString())
    );
    const result = computeVolumeHeatmap(blocks, 28, NOW);

    expect(result.effectiveDays).toBe(22); // earliest session 21 days ago, inclusive
    const chest = result.rows.find((r) => r.muscle === 'chest')!;
    expect(chest.totalSets).toBe(24);
    // 24 sets over 22 effective days → 7.6/wk.
    expect(chest.avgWeeklySets).toBeCloseTo(7.6, 5);
    expect(chest.heat).toBe('below');
  });

  it('clamps the averaging window to the user\'s data span (a short history is not painted as a starved year)', () => {
    // 2 weeks of solid quad work, viewed on the 1-year timeframe: without the
    // clamp the average would be ~0.5 sets/wk (red everywhere by artifact).
    const blocks = [0, 3, 7, 10].map((daysAgo) =>
      datedBlock('squat', 'quads', 5, new Date(2026, 7, 23 - daysAgo, 10).toISOString())
    );
    const result = computeVolumeHeatmap(blocks, 365, NOW);

    expect(result.clamped).toBe(true);
    expect(result.effectiveDays).toBe(11); // earliest 10 days ago, inclusive
    const quads = result.rows.find((r) => r.muscle === 'quads')!;
    // 20 sets over 11 days → 12.7/wk, inside quads' 8–20 band.
    expect(quads.avgWeeklySets).toBeCloseTo(12.7, 5);
    expect(quads.heat).toBe('moderate');
  });

  it('never extrapolates a lone fresh session below a one-week window', () => {
    const blocks = [datedBlock('curl', 'biceps', 6, new Date(2026, 7, 23, 9).toISOString())];
    const result = computeVolumeHeatmap(blocks, 14, NOW);
    // Span since the only session is 1 day; the floor keeps the divisor at 7
    // days so 6 sets read as 6/wk, not 42/wk.
    expect(result.effectiveDays).toBe(7);
    const biceps = result.rows.find((r) => r.muscle === 'biceps')!;
    expect(biceps.avgWeeklySets).toBe(6);
  });

  it('carries every coarse group (untrained ones at 0) so the map paints gaps red', () => {
    const blocks = [datedBlock('bench', 'chest', 10, new Date(2026, 7, 20, 10).toISOString())];
    const result = computeVolumeHeatmap(blocks, 14, NOW);

    expect(result.rows.map((r) => r.muscle).sort()).toEqual([...COARSE_MUSCLES].sort());
    const calves = result.rows.find((r) => r.muscle === 'calves')!;
    expect(calves.avgWeeklySets).toBe(0);
    expect(calves.heat).toBe('untrained');
  });

  it('sorts hottest first and reports an unclamped full window when data spans it', () => {
    const blocks = [
      datedBlock('bench', 'chest', 12, new Date(2026, 7, 22, 10).toISOString()),
      datedBlock('old-bench', 'chest', 12, new Date(2026, 7, 23 - 13, 10).toISOString()),
      datedBlock('curl', 'biceps', 2, new Date(2026, 7, 21, 10).toISOString()),
    ];
    const result = computeVolumeHeatmap(blocks, 14, NOW);

    expect(result.clamped).toBe(false);
    expect(result.effectiveDays).toBe(14);
    expect(result.rows[0].muscle).toBe('chest'); // 24 total → 12/wk leads
    // Ties at 0 fall back to stable name ordering.
    const zeros = result.rows.filter((r) => r.avgWeeklySets === 0).map((r) => r.displayName);
    expect(zeros).toEqual([...zeros].sort((a, b) => a.localeCompare(b)));
  });

  it('enhanced recovery profile widens the green ramp via the scaled MRV', () => {
    // 25 chest sets/wk: past the standard MRV (22) but inside the enhanced
    // ceiling (27.5) — the bucket must move with the profile's band.
    const blocks = [0, 13].map((daysAgo) =>
      datedBlock('bench', 'chest', 25, new Date(2026, 7, 23 - daysAgo, 10).toISOString())
    );
    const standard = computeVolumeHeatmap(blocks, 14, NOW);
    const enhanced = computeVolumeHeatmap(blocks, 14, NOW, { recoveryProfile: 'enhanced' });

    expect(standard.rows.find((r) => r.muscle === 'chest')!.heat).toBe('very_high');
    expect(enhanced.rows.find((r) => r.muscle === 'chest')!.heat).toBe('high');
  });
});
