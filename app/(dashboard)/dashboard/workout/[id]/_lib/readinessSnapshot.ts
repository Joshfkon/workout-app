/**
 * readinessSnapshot.ts — the injury/tweak tag's moment-capture.
 *
 * Builds the full readiness state (every mover muscle + every stabilizer-
 * channel muscle) for embedding in a joint_pain_events row
 * (readiness_snapshot JSONB, migration 20260825000004). Pure: history, clock
 * and config are injected; both models are the production functions in
 * services/muscleRecovery.
 *
 * Snapshots are deliberately denormalized — engine constants drift, so the
 * values at report time are not recomputable later. This is the sanctioned
 * moment-capture exception to the no-stored-aggregates policy.
 */

import { STANDARD_MUSCLE_GROUPS, type StandardMuscleGroup } from '@/types/schema';
import {
  computeMuscleRecovery,
  computeStabilizerRecovery,
  stabilizerTrackedMuscles,
  RECOVERY_CONFIG,
  type RecoveryConfig,
  type RecoverySession,
  type RecoveryStatus,
} from '@/services/muscleRecovery';

export interface ReadinessSnapshotEntry {
  status: RecoveryStatus;
  /** readinessRatio [0, 1], rounded to 4 places. */
  ratio: number;
}

export interface ReadinessSnapshot {
  capturedAt: string;
  /** Mover model (computeMuscleRecovery), one entry per standard muscle. */
  muscles: Partial<Record<StandardMuscleGroup, ReadinessSnapshotEntry>>;
  /** Stabilizer channel (computeStabilizerRecovery), tracked muscles only. */
  stabilizers: Partial<Record<StandardMuscleGroup, ReadinessSnapshotEntry>>;
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

export function buildReadinessSnapshot(
  history: RecoverySession[],
  now: Date,
  config: RecoveryConfig = RECOVERY_CONFIG
): ReadinessSnapshot {
  const muscles: ReadinessSnapshot['muscles'] = {};
  for (const muscle of STANDARD_MUSCLE_GROUPS) {
    const result = computeMuscleRecovery(history, muscle, now, config);
    muscles[muscle] = { status: result.status, ratio: round4(result.readinessRatio) };
  }

  const stabilizers: ReadinessSnapshot['stabilizers'] = {};
  for (const muscle of stabilizerTrackedMuscles(config)) {
    const result = computeStabilizerRecovery(history, muscle, now, config);
    stabilizers[muscle] = { status: result.status, ratio: round4(result.readinessRatio) };
  }

  return { capturedAt: now.toISOString(), muscles, stabilizers };
}
