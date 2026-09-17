/**
 * Velocity → estimated-RIR: the "future velocity-loss → RIR fit" that
 * `MotionCapture.analysisMetrics` was persisted for (types/motion.ts).
 *
 * Method — minimal velocity threshold (MVT), from the VBT literature: the
 * velocity of a lifter's final rep before failure is fairly stable for a
 * given person on a given machine REGARDLESS of load. So:
 *
 *   1. Learn a per-calibration MVT from the user's own past captures whose
 *      sets were logged at RIR 0-1 (the logged RIR is the label; captures
 *      flagged prior_observations_viewed_this_session are excluded upstream
 *      as label-contaminated).
 *   2. For a new capture, extrapolate: final-rep velocity minus MVT, divided
 *      by the CURRENT set's own per-rep velocity decline, is roughly how
 *      many more reps were available.
 *   3. The result is shown as a descriptive line next to the logged RIR.
 *
 * REFERENCE DISCIPLINE — deliberate amendment: unlike observations.ts
 * (within-set median only), this module compares against CROSS-SESSION
 * history. That is sound only because every confound the within-set rule
 * guards against is pinned here by construction: same MachineCalibration
 * (same machine, seat, mount), the user's own labels only, angular velocity
 * from the same pipeline, and MVT itself is load-robust. Nothing else in
 * the motion feature may compare across sessions.
 *
 * FRAMING: same rules as observations.ts — describe, never judge. The
 * estimate is a measurement-derived guess shown beside what the user felt,
 * never a verdict on their honesty or effort. When the data can't support
 * an estimate (thin history, inconsistent failure velocities, a flat set
 * that never approached the threshold), this module returns null rather
 * than guessing.
 *
 * DISPLAY-ONLY: nothing here may feed e1RM, prescription, or volume
 * (importGuard). The set_logs label join lives OUTSIDE the feature dirs
 * (hooks/useVelocityRirProfiles.ts) — motion modules never touch set
 * tables.
 */

import type { CaptureAnalysisRepMetrics } from '@/types/motion';
import type { CaptureRep } from './captureAnalysis';
import { LOW_CONFIDENCE_PC1_SHARE } from './captureAnalysis';
import { MIN_REPS_FOR_REFERENCE } from './observations';

/** Sets logged at or below this RIR may teach the failure velocity. */
export const MVT_LABEL_MAX_RIR = 1;

/** Minimum qualifying labeled sets before an MVT exists at all. */
export const MVT_MIN_SETS = 3;

/**
 * Robust relative spread (MAD/median) of the qualifying final-rep
 * velocities above which the "stable failure velocity" premise has failed
 * for this user+machine and every estimate is suppressed.
 */
export const MVT_MAX_REL_SPREAD = 0.3;

/** Final velocity within this fraction of MVT reads as "at the threshold". */
export const MVT_AT_THRESHOLD_MARGIN = 0.05;

/**
 * A per-rep decline below this fraction of MVT is too flat to extrapolate
 * along; the set was not visibly slowing.
 */
export const MVT_MIN_DECLINE_FRACTION = 0.02;

/**
 * With no usable decline, a final velocity at least this fraction ABOVE
 * MVT still supports "well above the threshold" (reported as max+). Between
 * the two margins a flat set is ambiguous and yields no estimate.
 */
export const MVT_FAR_ABOVE_MARGIN = 0.25;

/** Estimates cap here and display as "4 or more" (RepsInTank tops at 4+). */
export const VELOCITY_RIR_ESTIMATE_MAX = 4;

/** Trailing reps used for the current set's decline slope fit. */
export const MVT_SLOPE_FIT_REPS = 4;

/** Always shown under an estimate — standing context, not a warning. */
export const VELOCITY_RIR_CONTEXT_LINE =
  'Estimated from your own past near-limit sets on this machine. ' +
  'Rep speed varies for many reasons — treat this as a rough gauge ' +
  'alongside how the set felt.';

/** The minimal per-rep shape the estimator consumes. */
export interface VelocityRep {
  /** 0-based rep index within the set. */
  index: number;
  /** Mean concentric angular velocity, rad/s. */
  meanConcentricW: number;
}

/** One historical capture with its set's logged-RIR label. */
export interface LabeledVelocitySet {
  reps: VelocityRep[];
  /** The set's logged RIR (feedback.repsInTank). */
  loggedRir: number;
  /** Capture quality gate; null passes (older rows without metadata). */
  pc1VarianceShare: number | null;
}

/** A learned failure-velocity profile for one machine calibration. */
export interface MvtProfile {
  /** Median final-rep velocity of qualifying near-limit sets, rad/s. */
  mvtW: number;
  /** Qualifying sets behind the median. */
  setCount: number;
  /** MAD/median of the qualifying final-rep velocities. */
  relSpread: number;
  /** True when relSpread exceeds MVT_MAX_REL_SPREAD: suppress estimates. */
  lowConfidence: boolean;
}

export interface VelocityRirEstimate {
  /** Estimated reps in reserve, clamped to [0, VELOCITY_RIR_ESTIMATE_MAX]. */
  estimatedRir: number;
  /** True when velocity suggested VELOCITY_RIR_ESTIMATE_MAX or more. */
  atOrAboveMax: boolean;
  /** Final-rep mean concentric velocity, rad/s. */
  vFinalW: number;
  /** The profile's threshold, rad/s. */
  mvtW: number;
  /** Per-rep velocity decline used for extrapolation, rad/s (>= 0). */
  declinePerRepW: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Live-analysis reps → estimator shape. */
export function captureRepsToVelocityReps(reps: CaptureRep[]): VelocityRep[] {
  return reps.map((r) => ({ index: r.index, meanConcentricW: r.meanWConcentric }));
}

/** Persisted analysis_metrics reps → estimator shape. */
export function analysisRepsToVelocityReps(
  reps: CaptureAnalysisRepMetrics[]
): VelocityRep[] {
  return reps.map((r) => ({ index: r.index, meanConcentricW: r.meanConcentricW_radps }));
}

function finalRepVelocity(reps: VelocityRep[]): number | null {
  if (reps.length < MIN_REPS_FOR_REFERENCE) return null;
  const last = [...reps].sort((a, b) => a.index - b.index)[reps.length - 1];
  return last.meanConcentricW > 0 ? last.meanConcentricW : null;
}

/**
 * Learn the failure-velocity profile from labeled history. RIR-0 sets are
 * the cleanest labels (their final rep IS the near-failure rep); when at
 * least MVT_MIN_SETS of them exist they are used alone, otherwise RIR 0-1
 * are pooled (an RIR-1 final rep sits ~1 rep above true failure velocity,
 * a small conservative bias documented here on purpose).
 */
export function buildMvtProfile(history: LabeledVelocitySet[]): MvtProfile | null {
  const qualifying = history.filter(
    (h) =>
      h.loggedRir <= MVT_LABEL_MAX_RIR &&
      (h.pc1VarianceShare === null || h.pc1VarianceShare >= LOW_CONFIDENCE_PC1_SHARE)
  );

  const finalsAtRir = (maxRir: number): number[] =>
    qualifying
      .filter((h) => h.loggedRir <= maxRir)
      .map((h) => finalRepVelocity(h.reps))
      .filter((v): v is number => v !== null);

  const rirZeroFinals = finalsAtRir(0);
  const finals = rirZeroFinals.length >= MVT_MIN_SETS ? rirZeroFinals : finalsAtRir(MVT_LABEL_MAX_RIR);
  if (finals.length < MVT_MIN_SETS) return null;

  const mvtW = median(finals);
  if (mvtW <= 0) return null;
  const mad = median(finals.map((v) => Math.abs(v - mvtW)));
  const relSpread = mad / mvtW;

  return {
    mvtW,
    setCount: finals.length,
    relSpread,
    lowConfidence: relSpread > MVT_MAX_REL_SPREAD,
  };
}

/** Least-squares slope of meanW over rep index across the trailing reps. */
function trailingDeclinePerRep(reps: VelocityRep[]): number {
  const ordered = [...reps].sort((a, b) => a.index - b.index);
  const tail = ordered.slice(-Math.min(MVT_SLOPE_FIT_REPS, ordered.length));
  const n = tail.length;
  const meanX = tail.reduce((s, r) => s + r.index, 0) / n;
  const meanY = tail.reduce((s, r) => s + r.meanConcentricW, 0) / n;
  let num = 0;
  let den = 0;
  for (const r of tail) {
    num += (r.index - meanX) * (r.meanConcentricW - meanY);
    den += (r.index - meanX) ** 2;
  }
  const slope = den > 0 ? num / den : 0;
  return Math.max(0, -slope);
}

/**
 * Estimate reps in reserve for one captured set against a learned profile.
 * Returns null whenever the data cannot support an estimate — a null is a
 * refusal to guess, not an error.
 */
export function estimateRirFromVelocity(
  reps: VelocityRep[],
  profile: MvtProfile
): VelocityRirEstimate | null {
  if (profile.lowConfidence) return null;
  const vFinal = finalRepVelocity(reps);
  if (vFinal === null) return null;

  const { mvtW } = profile;
  const declinePerRepW = trailingDeclinePerRep(reps);
  const surplus = vFinal - mvtW;

  const base = { vFinalW: vFinal, mvtW, declinePerRepW };

  if (surplus <= mvtW * MVT_AT_THRESHOLD_MARGIN) {
    return { ...base, estimatedRir: 0, atOrAboveMax: false };
  }
  if (declinePerRepW < mvtW * MVT_MIN_DECLINE_FRACTION) {
    // Not visibly slowing: only "far above threshold" is supportable.
    if (surplus >= mvtW * MVT_FAR_ABOVE_MARGIN) {
      return { ...base, estimatedRir: VELOCITY_RIR_ESTIMATE_MAX, atOrAboveMax: true };
    }
    return null;
  }

  const raw = Math.round(surplus / declinePerRepW);
  if (raw >= VELOCITY_RIR_ESTIMATE_MAX) {
    return { ...base, estimatedRir: VELOCITY_RIR_ESTIMATE_MAX, atOrAboveMax: true };
  }
  return { ...base, estimatedRir: Math.max(0, raw), atOrAboveMax: false };
}

/**
 * The descriptive line for an estimate. Plain sentences that state what was
 * measured and what it is consistent with; the logged RIR, when present, is
 * restated as a fact beside it — never contradicted.
 */
export function buildVelocityRirLine(
  estimate: VelocityRirEstimate,
  loggedRir: number | null
): string {
  const logged =
    loggedRir === null ? '' : ` You logged ${loggedRir >= 4 ? '4+' : loggedRir} in reserve.`;

  if (estimate.atOrAboveMax) {
    return (
      'Final-rep velocity was well above your usual final-rep velocity on ' +
      `near-limit sets of this exercise — consistent with ${VELOCITY_RIR_ESTIMATE_MAX} ` +
      `or more reps in reserve.${logged}`
    );
  }
  if (estimate.estimatedRir === 0) {
    return (
      'Final-rep velocity matched your usual final-rep velocity on ' +
      `near-limit sets of this exercise — consistent with 0-1 reps in reserve.${logged}`
    );
  }
  const n = estimate.estimatedRir;
  return (
    `Final-rep velocity suggests roughly ${n} ${n === 1 ? 'rep' : 'reps'} ` +
    `in reserve on this exercise.${logged}`
  );
}
