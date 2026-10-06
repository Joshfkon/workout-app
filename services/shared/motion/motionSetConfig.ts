/**
 * Every threshold the in-workout motion set flow uses — manual capture,
 * confidence gating, the set summary, callouts, and the recommendation
 * tiebreak — in one place. Change numbers here, not at call sites.
 */

export type VelocityZone = 'fresh' | 'hard' | 'near-failure';

export const MOTION_SET_CONFIG = {
  capture: {
    /** Safety auto-stop: no motion this long (after ≥ 1 rep) ends the capture. */
    autoStopQuietMs: 10_000,
    /** |gyro| at or above this counts as motion for the auto-stop clock. */
    motionOmegaRadps: 0.4,
    /** How often the live rep count re-runs the analysis while recording. */
    liveRepIntervalMs: 750,
    /** "Mounted" for showing Start: |gyro| below this for mountedHoldMs. */
    mountedGyroMaxRadps: 0.08,
    mountedHoldMs: 1_000,
    /** Sensor considered disconnected when no sample arrived this long. */
    sensorStaleMs: 1_500,
  },
  gating: {
    /** Inter-rep pause longer than this = setup/rest: split there. */
    splitPauseMs: 5_000,
    /** A rep travelling under this fraction of the median ROM is a partial. */
    partialRepMaxRomFraction: 0.5,
    /** More than this share of short-travel movements → low confidence. */
    lowConfidencePartialShare: 0.25,
    /** Detected vs logged reps: low confidence when |diff| > abs OR > frac. */
    repMismatchMaxAbs: 2,
    repMismatchMaxFraction: 0.15,
  },
  summary: {
    /** Below this many reps the velocity-loss headline is hidden. */
    minRepsForLoss: 3,
    /** Loss zones (fraction of best-rep velocity lost). < hardFrom → fresh. */
    zones: {
      hardFrom: 0.2,
      nearFailureAbove: 0.4,
    },
    zoneLabels: {
      fresh: 'Plenty left',
      hard: 'Getting hard',
      'near-failure': 'Near failure',
    } as Record<VelocityZone, string>,
  },
  callouts: {
    max: 3,
    /** Last rep's relative velocity below this → sharp-drop callout. */
    sharpDropBelowRelative: 0.6,
    /** Bottom dwell above this (ms) → pause callout. */
    longPauseAboveMs: 150,
    /** Eccentric duration above this multiple of the set median → callout. */
    slowEccentricRatio: 1.4,
  },
  recommendation: {
    /**
     * Tiebreak: velocity loss above this while the logged RIR is at least
     * minLoggedRir → effort looked higher than logged; an engine "add
     * weight" is shown as "hold weight" instead. 0.5 sits between the two
     * reference cases: 44% at 2 RIR reads as on-target, 55% at 2 RIR as
     * harder than logged.
     */
    higherEffortLossAbove: 0.5,
    higherEffortMinLoggedRir: 2,
  },
} as const;
