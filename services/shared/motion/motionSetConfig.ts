/**
 * Every threshold the in-workout motion set flow uses — manual capture,
 * rep cleaning, confidence gating, coach findings, and the next-set call —
 * in one place. Change numbers here, not at call sites.
 */

export type EffortZone = 'easy' | 'moderate' | 'hard' | 'near-failure';

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
  cleaning: {
    /**
     * A detected rep is a setup / re-rack artifact when, against the median
     * of ALL detected reps: concentric or eccentric duration is under
     * minDurationFraction of median, OR peak ω is over maxPeakRatio × median,
     * OR ROM is under minRomFraction of median.
     */
    minDurationFraction: 0.5,
    maxPeakRatio: 1.8,
    minRomFraction: 0.5,
  },
  gating: {
    /** Inter-rep pause longer than this = setup/rest: split there. */
    splitPauseMs: 5_000,
    /** More than this share of detected reps rejected → low confidence. */
    lowConfidenceRejectedShare: 0.25,
    /** Clean reps vs logged reps: low confidence when |diff| > abs OR > frac. */
    repMismatchMaxAbs: 2,
    repMismatchMaxFraction: 0.15,
    /** PC1 variance share (after cleaning) below this → low confidence. */
    minPc1Share: 0.8,
  },
  coach: {
    /** Velocity loss needs at least this many clean reps. */
    minRepsForLoss: 3,
    /** Velocity-loss zones: < easyBelow easy, < moderateBelow moderate, ≤ hardUpTo hard, else near failure. */
    effortZones: { easyBelow: 0.15, moderateBelow: 0.3, hardUpTo: 0.45 },
    /** Logged-RIR cross-check against the velocity zone. */
    rirDisagreement: {
      /** Easy/moderate velocity but logged RIR ≤ this → "had more than you logged". */
      easyButLoggedAtMost: 1,
      /** Hard/near-failure velocity but logged RIR ≥ this → "harder than you logged". */
      hardButLoggedAtLeast: 3,
    },
    pausing: { dwellAboveMs: 1_500, minReps: 2 },
    eccentric: { inconsistentRatio: 1.6, droppingBelowMs: 600 },
    romShortening: { lastVsFirstThirdDropAbove: 0.08 },
    grind: { lastConcentricRatio: 1.4 },
    consistency: { maxVelocityCv: 0.1 },
    history: {
      /** Same-load, rep-by-rep speed change worth mentioning. */
      meaningfulChange: 0.1,
      sameLoadToleranceKg: 0.5,
      /** Speed-drop difference vs last session worth mentioning (percentage points, any load). */
      effortChangeMinPts: 0.1,
      /**
       * First-rep speed at a HEAVIER load counts as "as fast as last time"
       * within this fraction (only ever reported in that direction).
       */
      firstRepSameSpeedTolerance: 0.03,
    },
    /** Cues shown in the coach output. */
    maxCues: 2,
    /** The set row's muted second line shows the top cue only at/above this. */
    rowCueMinSeverity: 2,
  },
  recommendation: {
    /**
     * Tiebreak: velocity in the near-failure zone while the logged RIR is at
     * least this → effort looked higher than logged; an engine "add weight"
     * is shown as "hold weight" instead. Velocity never adds load.
     */
    higherEffortMinLoggedRir: 2,
  },
  llm: {
    /** Optional LLM phrasing falls back to the template after this long. */
    timeoutMs: 3_000,
  },
} as const;
