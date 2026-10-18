/**
 * Sensor RIR prefill: one reps-in-reserve number for the active set's RIR
 * chip, computed from the cleaned capture at Stop. The lifter's tap is what
 * gets logged — this only picks the chip that starts selected.
 *
 * Source, in order:
 *   1. The learned failure-velocity profile (velocityRir.ts, MVT) for this
 *      machine calibration, when one exists and its failure velocities are
 *      consistent. Its refusal (null) is respected — no fallback guess on
 *      top of "the data can't support an estimate".
 *   2. Otherwise the within-set velocity-loss zone, mapped through
 *      MOTION_SET_CONFIG.coach.zoneRir. Coarse on purpose.
 *
 * A low-confidence capture yields nothing (no velocity claims), the same
 * gate the coach uses. With no logged rep count yet at Stop, the count
 * cross-check can't run; the rest of the gate does.
 *
 * Label hygiene: a set logged with an untouched prefill carries
 * feedback.rirSource = 'sensor' and is excluded from the MVT labels
 * (hooks/useVelocityRirProfiles.ts) — otherwise the profile would learn
 * from its own output.
 */

import type { CleanedCapture } from './captureGating';
import { assessConfidence } from './captureGating';
import { MOTION_SET_CONFIG, type EffortZone } from './motionSetConfig';
import { computeVelocityLoss } from './setSummary';
import { estimateRirFromVelocity, type MvtProfile } from './velocityRir';

export type SensorRirSource = 'velocity-profile' | 'velocity-loss';

export interface SensorRirEstimate {
  /** 0-4, the chip range (4 = "4+"). */
  rir: 0 | 1 | 2 | 3 | 4;
  source: SensorRirSource;
  /** Velocity-loss zone (both sources; the profile path still reports it). */
  zone: EffortZone | null;
}

const toChip = (n: number) => Math.max(0, Math.min(4, Math.round(n))) as SensorRirEstimate['rir'];

export function estimateSetRir(
  cleaned: CleanedCapture,
  profile: MvtProfile | null
): SensorRirEstimate | null {
  if (assessConfidence(cleaned).confidence === 'low') return null;
  const velocity = computeVelocityLoss(cleaned.reps);

  if (profile && !profile.lowConfidence) {
    const est = estimateRirFromVelocity(
      cleaned.reps.map((r) => ({ index: r.n - 1, meanConcentricW: r.meanW })),
      profile
    );
    return est ? { rir: toChip(est.estimatedRir), source: 'velocity-profile', zone: velocity.zone } : null;
  }

  if (velocity.zone === null) return null;
  return {
    rir: toChip(MOTION_SET_CONFIG.coach.zoneRir[velocity.zone]),
    source: 'velocity-loss',
    zone: velocity.zone,
  };
}
