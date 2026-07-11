/**
 * readiness.ts — pure assembly + ranking for the in-workout Muscle Readiness
 * sheet. Combines the two per-muscle signals the sheet needs:
 *   1. weekly volume (sets done vs MEV target) — reuses the shared weekly-volume
 *      module (`getMevForMuscle`) so the numbers match the volume card,
 *   2. recovery status — from the pure `muscleRecovery` heuristic.
 *
 * No React, no store, no Supabase — the data hook feeds it plain values and an
 * injected `now`, so the whole ranking is unit-testable in isolation.
 */

import {
  STANDARD_MUSCLE_GROUPS,
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
import { getMevForMuscle } from '../../../_lib/weeklyVolume';

export type VolumeStatus = 'low' | 'optimal' | 'high';

export interface ReadinessRow {
  muscle: StandardMuscleGroup;
  displayName: string;
  /** Weekly working sets (DB history + live session), rounded. */
  sets: number;
  /** MEV target for this muscle. */
  target: number;
  /** How far below target (0 when at/above target). */
  volumeGap: number;
  volumeStatus: VolumeStatus;
  recovery: MuscleRecoveryResult;
  /** Actionability score — higher = better target today. */
  score: number;
}

/** How "trainable today" each recovery bucket is, for the score. */
const RECOVERED_FACTOR: Record<MuscleRecoveryResult['status'], number> = {
  fresh: 1,
  recovering: 0.6,
  fatigued: 0,
};

function volumeStatusFor(sets: number, target: number): VolumeStatus {
  if (sets < target) return 'low';
  if (sets > target * 1.5) return 'high';
  return 'optimal';
}

/**
 * Actionability sort: the best candidates (behind on volume AND recovered)
 * float to the top; Fatigued muscles sink to the bottom regardless of how far
 * behind they are; within ties, the bigger volume gap wins.
 */
export function compareByActionability(a: ReadinessRow, b: ReadinessRow): number {
  // Fatigued always ranks below anything not fatigued.
  const aFatigued = a.recovery.status === 'fatigued' ? 1 : 0;
  const bFatigued = b.recovery.status === 'fatigued' ? 1 : 0;
  if (aFatigued !== bFatigued) return aFatigued - bFatigued;

  // Then by actionability score (gap × recovered), highest first.
  if (b.score !== a.score) return b.score - a.score;

  // Ties: bigger volume gap first…
  if (b.volumeGap !== a.volumeGap) return b.volumeGap - a.volumeGap;

  // …then stable alphabetical for determinism.
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Build one row per standard muscle group, sorted by actionability. Untrained
 * muscles (0 sets) are included on purpose — they're the strongest targets.
 *
 * @param weeklySetsByMuscle merged weekly working sets (DB + live session)
 * @param history           sessions for the recovery heuristic (incl. live)
 * @param now               injected clock
 */
export function buildReadinessRows(
  weeklySetsByMuscle: Partial<Record<StandardMuscleGroup, number>>,
  history: RecoverySession[],
  now: Date,
  config: RecoveryConfig = RECOVERY_CONFIG
): ReadinessRow[] {
  const rows = STANDARD_MUSCLE_GROUPS.map((muscle): ReadinessRow => {
    const sets = Math.round(weeklySetsByMuscle[muscle] ?? 0);
    const target = getMevForMuscle(muscle);
    const volumeGap = Math.max(0, target - sets);
    const recovery = computeMuscleRecovery(history, muscle, now, config);
    const score = volumeGap * RECOVERED_FACTOR[recovery.status];

    return {
      muscle,
      displayName: STANDARD_MUSCLE_DISPLAY_NAMES[muscle],
      sets,
      target,
      volumeGap,
      volumeStatus: volumeStatusFor(sets, target),
      recovery,
      score,
    };
  });

  return rows.sort(compareByActionability);
}

/**
 * The top-N "good targets today": recovered (not Fatigued) muscles that are
 * actually behind on volume, in actionability order. Returns fewer than N when
 * not enough muscles qualify.
 */
export function topTargets(rows: ReadinessRow[], n = 3): ReadinessRow[] {
  return rows
    .filter((r) => r.recovery.status !== 'fatigued' && r.volumeGap > 0)
    .slice(0, n);
}
