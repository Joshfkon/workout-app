/**
 * readiness.ts — pure assembly + ranking for the in-workout Muscle Readiness
 * sheet. Renders the SAME coarse-row model as the volume page, widget and
 * warning (buildVolumeRows over the shared 0.5-secondary counter), then pairs
 * each row with the recovery heuristic:
 *   1. weekly volume — coarse sets vs the MEV–MRV band (shared zone rule),
 *   2. recovery status — from the pure `muscleRecovery` heuristic.
 *
 * No React, no store, no Supabase — the data hook feeds it plain values and an
 * injected `now`, so the whole ranking is unit-testable in isolation.
 */

import {
  STANDARD_MUSCLE_DISPLAY_NAMES,
  type StandardMuscleGroup,
} from '@/types/schema';
import {
  computeMuscleRecovery,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
  type MuscleRecoveryResult,
} from '@/services/muscleRecovery';
import {
  buildVolumeRows,
  COARSE_CHILDREN,
  type CoarseMuscle,
  type VolumeBand,
  type VolumeZone,
  type VolumeRow,
  type MuscleVolumeStats,
} from '../../../_lib/weeklyVolume';

export type VolumeStatus = 'low' | 'optimal' | 'high';

/** How "trainable today" each recovery bucket is, for the actionability score. */
const RECOVERED_FACTOR: Record<MuscleRecoveryResult['status'], number> = {
  fresh: 1,
  recovering: 0.6,
  fatigued: 0,
};

/** A fine child of a coarse readiness row (reachable + lagging or expanded). */
export interface ReadinessChild {
  muscle: StandardMuscleGroup;
  displayName: string;
  sets: number;
  band: VolumeBand;
  zone: VolumeZone;
  belowMev: boolean;
  volumeGap: number;
  recovery: MuscleRecoveryResult;
}

export interface ReadinessRow {
  /** Coarse muscle id (chest, back, …). */
  muscle: CoarseMuscle;
  displayName: string;
  /** Weekly credited working sets (DB history + live session), rounded. */
  sets: number;
  /** Shared MEV–MRV band — the denominator shown as a zone, never n/MEV. */
  band: VolumeBand;
  zone: VolumeZone;
  belowMev: boolean;
  /** How far below MEV (0 at/above MEV). */
  volumeGap: number;
  /** Legacy tri-state kept for the bar colour fallback. */
  volumeStatus: VolumeStatus;
  recovery: MuscleRecoveryResult;
  /** Actionability score — higher = better target today. */
  score: number;
  /** Reachable lagging fine children to surface under this row. */
  children: ReadinessChild[];
}

/** A "good target today" — a coarse row or a fine child, behind and recovered. */
export interface ReadinessTarget {
  muscle: string;
  displayName: string;
  isChild: boolean;
  score: number;
}

function volumeStatusForZone(zone: VolumeZone): VolumeStatus {
  if (zone === 'below_mev') return 'low';
  if (zone === 'over_mrv') return 'high';
  return 'optimal';
}

/** Recovery for a coarse group = its least-recovered child (fatigued wins). */
const RECOVERY_RANK: Record<MuscleRecoveryResult['status'], number> = {
  fatigued: 2,
  recovering: 1,
  fresh: 0,
};
function coarseRecovery(
  coarse: CoarseMuscle,
  history: RecoverySession[],
  now: Date,
  config: RecoveryConfig
): MuscleRecoveryResult {
  let worst: MuscleRecoveryResult | null = null;
  for (const child of COARSE_CHILDREN[coarse]) {
    const rec = computeMuscleRecovery(history, child, now, config);
    if (
      !worst ||
      RECOVERY_RANK[rec.status] > RECOVERY_RANK[worst.status] ||
      (RECOVERY_RANK[rec.status] === RECOVERY_RANK[worst.status] && rec.hoursUntilReady > worst.hoursUntilReady)
    ) {
      worst = rec;
    }
  }
  return worst ?? computeMuscleRecovery(history, COARSE_CHILDREN[coarse][0], now, config);
}

/**
 * Actionability sort: the best candidates (behind on volume AND recovered)
 * float to the top; Fatigued muscles sink to the bottom regardless of how far
 * behind they are; within ties, the bigger volume gap wins.
 */
export function compareByActionability(a: ReadinessRow, b: ReadinessRow): number {
  const aFatigued = a.recovery.status === 'fatigued' ? 1 : 0;
  const bFatigued = b.recovery.status === 'fatigued' ? 1 : 0;
  if (aFatigued !== bFatigued) return aFatigued - bFatigued;
  if (b.score !== a.score) return b.score - a.score;
  if (b.volumeGap !== a.volumeGap) return b.volumeGap - a.volumeGap;
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Build one coarse row per muscle group, sorted by actionability, each carrying
 * its reachable lagging fine children. Untrained groups (0 sets) are included on
 * purpose — they're the strongest targets.
 *
 * @param stats     shared per-muscle credited stats (DB + live session)
 * @param history   sessions for the recovery heuristic (incl. live)
 * @param now       injected clock
 * @param reachable muscles the user's exercises can feed (gates fine children)
 */
export function buildReadinessRows(
  stats: MuscleVolumeStats[],
  history: RecoverySession[],
  now: Date,
  reachable?: Set<StandardMuscleGroup>,
  config: RecoveryConfig = RECOVERY_CONFIG
): ReadinessRow[] {
  const volumeRows = buildVolumeRows(stats, reachable);

  const rows = volumeRows.map((vr: VolumeRow): ReadinessRow => {
    const coarse = vr.muscle as CoarseMuscle;
    const recovery = coarseRecovery(coarse, history, now, config);
    const volumeGap = Math.max(0, vr.band.mev - vr.sets);
    const score = volumeGap * RECOVERED_FACTOR[recovery.status];

    const children: ReadinessChild[] = vr.children.map((child) => {
      const childRecovery = computeMuscleRecovery(history, child.muscle as StandardMuscleGroup, now, config);
      return {
        muscle: child.muscle as StandardMuscleGroup,
        displayName: child.displayName,
        sets: child.sets,
        band: child.band,
        zone: child.zone,
        belowMev: child.belowMev,
        volumeGap: Math.max(0, child.band.mev - child.sets),
        recovery: childRecovery,
      };
    });

    return {
      muscle: coarse,
      displayName: vr.displayName,
      sets: vr.sets,
      band: vr.band,
      zone: vr.zone,
      belowMev: vr.belowMev,
      volumeGap,
      volumeStatus: volumeStatusForZone(vr.zone),
      recovery,
      score,
      children,
    };
  });

  return rows.sort(compareByActionability);
}

/**
 * The top-N "good targets today": recovered (not Fatigued) coarse groups AND
 * reachable fine children that are actually behind on volume, in actionability
 * order. A lagging fine child surfaces even when its coarse parent is on target.
 */
export function topTargets(rows: ReadinessRow[], n = 3): ReadinessTarget[] {
  const candidates: ReadinessTarget[] = [];
  for (const row of rows) {
    if (row.recovery.status !== 'fatigued' && row.volumeGap > 0) {
      candidates.push({ muscle: row.muscle, displayName: row.displayName, isChild: false, score: row.score });
    }
    for (const child of row.children) {
      if (child.recovery.status !== 'fatigued' && child.volumeGap > 0) {
        candidates.push({
          muscle: child.muscle,
          displayName: child.displayName,
          isChild: true,
          score: child.volumeGap * RECOVERED_FACTOR[child.recovery.status],
        });
      }
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, n);
}
