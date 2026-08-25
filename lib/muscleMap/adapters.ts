/**
 * Adapters that feed the <MuscleMap /> view from the models each surface
 * ALREADY renders. The map is a view: these functions do zero new number
 * computation — they only re-key zone / recovery-status / emphasis values the
 * bars, readiness rows and exercise record already carry onto the map's
 * per-standard-muscle data shape. If a map region could disagree with a
 * bar/row on the same screen, that's a bug (see volumeSurfaceParity tests).
 */

import { resolveMuscleToStandard } from '@/types/schema';
import {
  COARSE_CHILDREN,
  type CoarseMuscle,
  type VolumeRow,
  type VolumeZone,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type { ReadinessRow } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type {
  HeatLevel,
  VolumeHeatmapRow,
} from '@/app/(dashboard)/dashboard/_lib/volumeHeatmap';
import type { RecoveryStatus } from '@/services/muscleRecovery';
import { REGIONLESS_COARSE_MEMBERS, type MuscleId } from './taxonomy';

/** Per-muscle datum the map renders. Which field matters depends on mode. */
export interface MuscleMapDatum {
  /**
   * Mode-dependent magnitude: credited weekly sets in volume/recovery mode
   * (volume mode only uses it for the untrained-gray vs below-MEV-amber
   * distinction, mirroring zoneBarClass), emphasis 0–1 in highlight mode.
   */
  value: number;
  /** Volume mode: the row's zone, from the shared volumeZone helper. */
  zone?: VolumeZone;
  /**
   * Volume mode, coarse-sourced regions only: the source row has a reachable
   * fine child below its own MEV, so its color demotes from success to
   * warning (rowColorToken) — the map must match the bar it mirrors.
   */
  lagging?: boolean;
  /** Recovery mode: the row's status, matching the readiness badges. */
  status?: RecoveryStatus;
  /** Heat mode: the row's MEV-weighted long-window bucket (volumeHeatmap). */
  heat?: HeatLevel;
}

export type MuscleMapData = Partial<Record<MuscleId, MuscleMapDatum>>;

/** Secondary muscles render at this fill opacity in highlight mode. */
export const SECONDARY_HIGHLIGHT_EMPHASIS = 0.4;

/**
 * Volume page: coarse rows paint all their standard children; a rendered fine
 * child row (already gated to below-MEV-or-expanded by buildVolumeRows)
 * overrides its own muscle so the map always matches the most specific bar
 * visible on screen.
 */
export function volumeRowsToMapData(rows: VolumeRow[]): MuscleMapData {
  const out: MuscleMapData = {};
  for (const row of rows) {
    const children = COARSE_CHILDREN[row.muscle as CoarseMuscle];
    if (!children) continue;
    for (const std of children) {
      out[std] = { value: row.sets, zone: row.zone, lagging: row.laggingChildren };
    }
    for (const child of row.children) {
      out[child.muscle as MuscleId] = { value: child.sets, zone: child.zone };
    }
  }
  return out;
}

/**
 * Readiness sheet: each datum carries BOTH paints so the sheet's
 * recovery/volume map toggle switches `mode` without rebuilding data —
 * guaranteeing the two modes are views of the same rows the list shows.
 *
 * Recovery: coarse rows paint their children with the row's recovery status
 * (already worst-of-children per buildReadinessRows, i.e. exactly what the
 * row's badge shows); rendered fine children override with their own status.
 * Muscles with no recovery estimate (never trained in the window — the
 * "No recent data" badge) get no `status` so they render in the neutral base
 * tone.
 *
 * Volume: the row's zone/lagging (and a rendered fine child's own zone),
 * exactly as volumeRowsToMapData paints the volume page.
 */
export function readinessRowsToMapData(rows: ReadinessRow[]): MuscleMapData {
  const out: MuscleMapData = {};
  for (const row of rows) {
    const status = row.recovery.lastTrainedAt !== null ? row.recovery.status : undefined;
    for (const std of COARSE_CHILDREN[row.muscle]) {
      out[std] = { value: row.sets, zone: row.zone, lagging: row.laggingChildren, status };
    }
    for (const child of row.children) {
      out[child.muscle] = {
        value: child.sets,
        zone: child.zone,
        status: child.recovery.lastTrainedAt !== null ? child.recovery.status : undefined,
      };
    }
  }
  return out;
}

/**
 * Volume heatmap: each coarse row paints ALL its standard children with the
 * row's heat bucket — the heatmap is deliberately a coarse-group view (its
 * averages come from the group-capped coarse totals), so every sub-region of a
 * group reads the group's color, exactly like the card's legend/detail rows.
 */
export function heatmapRowsToMapData(rows: VolumeHeatmapRow[]): MuscleMapData {
  const out: MuscleMapData = {};
  for (const row of rows) {
    const children = COARSE_CHILDREN[row.muscle];
    if (!children) continue;
    for (const std of children) {
      out[std] = { value: row.avgWeeklySets, heat: row.heat };
    }
  }
  return out;
}

/**
 * Exercise detail: primary muscle at full emphasis, secondaries at
 * SECONDARY_HIGHLIGHT_EMPHASIS. Tokens come straight off the exercise record
 * (legacy / standard / detailed, any casing) and go through the canonical
 * resolver. Primary is applied last so a muscle that is both stays primary.
 */
export function exerciseHighlightData(
  primaryMuscle: string | null | undefined,
  secondaryMuscles: readonly string[] | null | undefined
): MuscleMapData {
  const out: MuscleMapData = {};
  // A regionless coarse id ('traps', 'calves') owns no artwork path of its
  // own — brighten its fine members so the whole parent region lights up.
  const paint = (std: MuscleId, datum: MuscleMapDatum) => {
    out[std] = datum;
    for (const member of REGIONLESS_COARSE_MEMBERS[std] ?? []) {
      out[member] = datum;
    }
  };
  for (const secondary of secondaryMuscles ?? []) {
    for (const std of resolveMuscleToStandard(secondary)) {
      paint(std, { value: SECONDARY_HIGHLIGHT_EMPHASIS });
    }
  }
  if (primaryMuscle) {
    for (const std of resolveMuscleToStandard(primaryMuscle)) {
      paint(std, { value: 1 });
    }
  }
  return out;
}
