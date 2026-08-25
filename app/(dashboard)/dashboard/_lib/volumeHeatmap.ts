/**
 * Long-window volume heatmap — "which muscles actually got grown-worthy volume
 * over the last 2 weeks / month / 3 months / 6 months / year?"
 *
 * The weekly surfaces answer "how is THIS week going"; this module answers the
 * retrospective question by averaging credited weekly sets over a longer
 * window and judging the AVERAGE against the same shared MEV–MRV band every
 * other volume surface uses (services/volumeBands via buildVolumeRows). It
 * computes through the exact same pipeline — computeWeeklyMuscleVolume →
 * buildVolumeRows, with the within-group credit cap — so a muscle can never
 * read green here while the weekly counter would have credited it differently.
 *
 * Color semantics (per the body-map heat paint):
 *   - below MEV is a growth problem and reads red/amber: solid red when the
 *     average is under half the MEV (or the muscle is untrained), amber when
 *     it is under MEV but within reach;
 *   - at/above MEV the greens DARKEN with volume — light green just over MEV,
 *     through the middle of the band, darkest past MRV — so the map doubles as
 *     a "where does my volume actually go" heatmap. Sustained over-MRV volume
 *     is still surfaced (its own bucket + aria/detail text), it just isn't
 *     painted red: on a multi-month average the interesting contrast is
 *     starved-vs-fed, and the weekly surfaces already police MRV overruns.
 *
 * Pure: no React, no Supabase, no clock reads — callers pass `now`.
 */

import type { VolumeBand } from '@/services/volumeBands';
import {
  buildVolumeRows,
  computeReachableMuscles,
  computeWeeklyMuscleVolume,
  round1Sets,
  type BuildVolumeRowsOptions,
  type CoarseMuscle,
  type WeeklyVolumeBlockRow,
} from './weeklyVolume';
import { localDaysBetween } from '@/lib/date/localDay';

// ============================================
// TIMEFRAMES
// ============================================

export type HeatmapTimeframeId = '2w' | '1m' | '3m' | '6m' | '1y';

export interface HeatmapTimeframe {
  id: HeatmapTimeframeId;
  /** Chip label. */
  label: string;
  /** Human name for captions ("last 3 months"). */
  name: string;
  /** Trailing local-day window length (rollingWindowStart semantics). */
  days: number;
}

export const HEATMAP_TIMEFRAMES: readonly HeatmapTimeframe[] = [
  { id: '2w', label: '2W', name: 'last 2 weeks', days: 14 },
  { id: '1m', label: '1M', name: 'last month', days: 30 },
  { id: '3m', label: '3M', name: 'last 3 months', days: 91 },
  { id: '6m', label: '6M', name: 'last 6 months', days: 182 },
  { id: '1y', label: '1Y', name: 'last year', days: 365 },
] as const;

export const DEFAULT_HEATMAP_TIMEFRAME: HeatmapTimeframeId = '3m';

export function getHeatmapTimeframe(id: HeatmapTimeframeId): HeatmapTimeframe {
  return HEATMAP_TIMEFRAMES.find((t) => t.id === id) ?? HEATMAP_TIMEFRAMES[2];
}

// ============================================
// HEAT LEVELS (MEV-weighted color buckets)
// ============================================

/**
 * Ordered coldest → hottest. The below-MEV side is judged against the muscle's
 * OWN MEV (that's the "weighted by MEV required" part — 4 sets is fine for
 * adductors and starvation for shoulders); the green ramp is position within
 * the muscle's MEV–MRV band, in thirds, so groups with wide and narrow bands
 * grade comparably.
 */
export type HeatLevel =
  | 'untrained' // 0 credited sets/week on average
  | 'critical' // under half of MEV — not growing, solid red
  | 'below' // under MEV but within reach — amber
  | 'low' // bottom third of the MEV–MRV band — light green
  | 'moderate' // middle third — green
  | 'high' // top third — dark green
  | 'very_high'; // past MRV — darkest green (surfaced, not painted red)

export const HEAT_LEVELS: readonly HeatLevel[] = [
  'untrained',
  'critical',
  'below',
  'low',
  'moderate',
  'high',
  'very_high',
] as const;

/** The one avg-weekly-sets → heat bucket rule. */
export function heatLevel(avgWeeklySets: number, band: VolumeBand): HeatLevel {
  if (avgWeeklySets <= 0) return 'untrained';
  if (avgWeeklySets < band.mev / 2) return 'critical';
  if (avgWeeklySets < band.mev) return 'below';
  if (avgWeeklySets > band.mrv) return 'very_high';
  const span = Math.max(band.mrv - band.mev, 1);
  const position = (avgWeeklySets - band.mev) / span;
  if (position < 1 / 3) return 'low';
  if (position < 2 / 3) return 'moderate';
  return 'high';
}

/**
 * SVG fills per heat level — the heat-mode twin of weeklyVolume's
 * ZONE_FILL_CLASSES, kept here so the map, the legend and any future surface
 * paint identically. The reds deliberately reuse the app's below-MEV family
 * (danger-300 soft / danger-500 solid / warning-500 amber); the green ramp
 * darkens 300 → 700 with volume.
 */
export const HEAT_FILL_CLASSES: Record<HeatLevel, string> = {
  untrained: 'fill-danger-300',
  critical: 'fill-danger-500',
  below: 'fill-warning-500',
  low: 'fill-success-300',
  moderate: 'fill-success-500',
  high: 'fill-success-600',
  very_high: 'fill-success-700',
};

/** Legend-swatch backgrounds, same tokens as the fills. */
export const HEAT_SWATCH_CLASSES: Record<HeatLevel, string> = {
  untrained: 'bg-danger-300',
  critical: 'bg-danger-500',
  below: 'bg-warning-500',
  low: 'bg-success-300',
  moderate: 'bg-success-500',
  high: 'bg-success-600',
  very_high: 'bg-success-700',
};

/** Short legend / detail labels per bucket. */
export const HEAT_LABELS: Record<HeatLevel, string> = {
  untrained: 'Untrained',
  critical: 'Well below MEV',
  below: 'Below MEV',
  low: 'Lower zone',
  moderate: 'Mid zone',
  high: 'Upper zone',
  very_high: 'Above MRV',
};

/** Aria status half of a region's label in heat mode. */
export const HEAT_ARIA_STATUS: Record<HeatLevel, string> = {
  untrained: 'untrained in this period',
  critical: 'well below the minimum effective volume',
  below: 'below the minimum effective volume',
  low: 'lower end of the optimal volume zone',
  moderate: 'middle of the optimal volume zone',
  high: 'upper end of the optimal volume zone',
  very_high: 'above the maximum recoverable volume',
};

// ============================================
// COMPUTATION
// ============================================

/** Block row + its session's completion timestamp (for window clamping). */
export interface HeatmapBlockRow extends WeeklyVolumeBlockRow {
  workout_sessions?: { completed_at: string | null } | null;
}

/** One coarse muscle group's heat reading over the window. */
export interface VolumeHeatmapRow {
  muscle: CoarseMuscle;
  displayName: string;
  /** Credited sets per week, averaged over the effective window (one decimal). */
  avgWeeklySets: number;
  /** Total credited sets across the whole window (one decimal). */
  totalSets: number;
  /** The same shared MEV–MRV band the weekly surfaces use. */
  band: VolumeBand;
  heat: HeatLevel;
}

export interface VolumeHeatmapResult {
  /** All 14 coarse groups, hottest first (then by name for stable ties). */
  rows: VolumeHeatmapRow[];
  /** The requested trailing window, in local days. */
  windowDays: number;
  /**
   * The window the average was actually taken over: `windowDays`, clamped to
   * the span since the user's earliest completed session INSIDE the window
   * (min 7 days). Without this, a lifter with 6 weeks of history selecting
   * "1 year" would read solid red everywhere — an artifact of the empty
   * months, not of their training.
   */
  effectiveDays: number;
  /** True when effectiveDays < windowDays (caption the clamp in the UI). */
  clamped: boolean;
}

/**
 * Blocks in the trailing window → per-coarse-group heat rows.
 *
 * The totals come from the SAME pipeline as every weekly surface
 * (computeWeeklyMuscleVolume → buildVolumeRows: 0.5-secondary crediting,
 * legacy splits, the within-group per-exercise credit cap) run over the whole
 * window at once; only then is the group total divided by the effective weeks.
 * The zones buildVolumeRows stamps on window TOTALS are meaningless here and
 * are discarded — heat is judged on the weekly average via `heatLevel`.
 */
export function computeVolumeHeatmap(
  blocks: HeatmapBlockRow[],
  windowDays: number,
  now: Date,
  opts: BuildVolumeRowsOptions = {}
): VolumeHeatmapResult {
  let earliest: Date | null = null;
  for (const block of blocks) {
    const completedAt = block.workout_sessions?.completed_at;
    if (!completedAt) continue;
    const date = new Date(completedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (!earliest || date < earliest) earliest = date;
  }

  // Span since the earliest in-window session, inclusive of today. Clamped to
  // [7, windowDays]: never below a week (a single fresh session shouldn't
  // extrapolate to a 7× weekly rate), never above the requested window.
  const spanDays = earliest ? localDaysBetween(earliest, now) + 1 : windowDays;
  const effectiveDays = Math.min(windowDays, Math.max(7, spanDays));

  const stats = computeWeeklyMuscleVolume(blocks);
  const reachable = computeReachableMuscles(blocks);
  const volumeRows = buildVolumeRows(stats, reachable, opts);

  const weeklyScale = 7 / effectiveDays;
  const rows: VolumeHeatmapRow[] = volumeRows.map((row) => {
    const avgWeeklySets = round1Sets(row.sets * weeklyScale);
    return {
      muscle: row.muscle as CoarseMuscle,
      displayName: row.displayName,
      avgWeeklySets,
      totalSets: row.sets,
      band: row.band,
      heat: heatLevel(avgWeeklySets, row.band),
    };
  });

  rows.sort(
    (a, b) =>
      b.avgWeeklySets - a.avgWeeklySets || a.displayName.localeCompare(b.displayName)
  );

  return { rows, windowDays, effectiveDays, clamped: effectiveDays < windowDays };
}
