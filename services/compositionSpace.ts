/**
 * compositionSpace
 *
 * Geometry for the Composition Map: body composition as a point in
 * (FMI, FFMI) space — x = fat mass / height m², y = fat-free mass / height m².
 * FMI + FFMI = BMI by construction, so the map is a DECOMPOSITION of BMI
 * into its fat and fat-free parts, not a new invented metric. Progress toward
 * a goal is measured geometrically (scalar projection onto the goal vector),
 * never as a weighted scalar formula like FFMI − k·BF% — fixed weights are
 * wrong in at least one phase (bulk vs. cut).
 *
 * FFM uses the exact same definition as every other FFMI surface
 * (bodyCompEngine.computeFFM: lean + bone when logged, with the
 * calculated-entry double-count guard), so the map's y-axis agrees with the
 * FFMI trend chart and gauge point-for-point.
 *
 * Measurement honesty: DEXA precision is roughly ±1–2% BF and ±1–2 lb lean
 * (glycogen/hydration-sensitive). Scan-to-scan deltas inside that noise floor
 * are labeled instead of interpreted, and p-ratios over tiny weight changes
 * are suppressed entirely (the denominator is noise).
 *
 * Pure functions only: NO database calls.
 */

import { computeFFM, leanMassIncludesBone } from '@/services/bodyCompEngine';
import type { Goal, Experience } from '@/types/schema';

// ============================================================
// Constants
// ============================================================

export const LB_TO_KG = 0.45359237;

/** |Δweight| below this suppresses the p-ratio — 3 lb of total-weight change
 * is within scale/hydration noise, so Δlean/Δweight is a noise/noise ratio. */
export const P_RATIO_MIN_WEIGHT_DELTA_KG = 3 * LB_TO_KG;

/** DEXA lean-mass repeatability floor (~1.5 lb): a smaller |Δlean| is not a
 * directional signal. */
export const NOISE_FLOOR_LEAN_KG = 1.5 * LB_TO_KG;

/** DEXA fat-mass repeatability floor — same ~1.5 lb order as lean. */
export const NOISE_FLOOR_FAT_KG = 1.5 * LB_TO_KG;

/** |target − start| below this (kg/m² in composition space) is a degenerate
 * goal vector — the scalar is meaningless and must be hidden. */
export const DEGENERATE_GOAL_EPSILON = 0.1;

/** Perpendicular distance from the goal line (kg/m²) beyond which the
 * off-axis drift gets a qualitative note. ~0.5 kg/m² ≈ 1.6 kg of mass at
 * 1.8 m — comfortably above the DEXA noise floor. */
export const OFF_AXIS_NOTE_THRESHOLD = 0.5;

/** Iso-BMI diagonals offered to the map; only those crossing the visible
 * domain are drawn. */
export const ISO_BMI_LEVELS = [18.5, 22, 25, 28, 30, 35];

/** FFMI horizontal reference thresholds — same values as the FFMI trend
 * chart and gauge scale. */
export const COMPOSITION_MAP_FFMI_THRESHOLDS = [18, 20, 22, 25];

/** `?section=` anchor for the Body Composition Trend module (Composition
 * Map lives inside it). Home card deep-links here. */
export const BODY_COMP_TREND_SECTION_ID = 'body-comp-trend';

/** Scans needed before the map/prominence/home-card treatments unlock. */
export const MIN_SCANS_FOR_COMPOSITION_MAP = 2;

// ============================================================
// Composition points
// ============================================================

/** The slice of a scan (or anchored trend point) the map needs. */
export interface CompositionObservation {
  /** YYYY-MM-DD */
  date: string;
  leanMassKg: number;
  fatMassKg: number;
  /** Recorded total weight (includes bone); falls back to component sum. */
  weightKg?: number | null;
  boneMassKg?: number | null;
  /** Recorded BF% when the source logged one; recomputed otherwise. */
  bodyFatPercent?: number | null;
}

export interface CompositionPoint {
  date: string;
  /** Fat Mass Index: fat mass kg / height m² */
  fmi: number;
  /** RAW FFMI: fat-free mass kg / height m² — same FFM definition (and thus
   * same value) as the FFMI trend chart / gauge. */
  ffmi: number;
  /** fmi + ffmi. Computed from the components so the decomposition identity
   * holds exactly at every point. */
  bmi: number;
  bodyFatPercent: number;
  /** Weight used for p-ratio deltas: the recorded total when available. */
  weightKg: number;
}

/** Total weight convention shared with bodyCompAnchor: the recorded scan
 * total when present (it includes bone), else the component sum. */
function observationWeight(obs: CompositionObservation, ffmKg: number): number {
  return obs.weightKg != null && obs.weightKg > 0
    ? obs.weightKg
    : ffmKg + obs.fatMassKg;
}

/**
 * Map one observation to composition space.
 *
 * Bone handling matches bodyCompAnchor/computeFFMI: when the stored lean
 * already contains bone (calculated-entry shape) the logged bone mass is
 * ignored, otherwise FFM = lean + bone. Returns null when height or masses
 * are unusable.
 */
export function toCompositionPoint(
  obs: CompositionObservation,
  heightCm: number
): CompositionPoint | null {
  if (!heightCm || heightCm <= 0) return null;
  if (obs.leanMassKg <= 0 || obs.fatMassKg < 0) return null;

  const bone = leanMassIncludesBone({
    leanMassKg: obs.leanMassKg,
    fatMassKg: obs.fatMassKg,
    weightKg: obs.weightKg,
  })
    ? null
    : obs.boneMassKg;
  const ffm = computeFFM(obs.leanMassKg, bone);

  const heightM = heightCm / 100;
  const h2 = heightM * heightM;
  const fmi = obs.fatMassKg / h2;
  const ffmi = ffm / h2;

  const bodyFatPercent =
    obs.bodyFatPercent != null && obs.bodyFatPercent > 0
      ? obs.bodyFatPercent
      : (obs.fatMassKg / (ffm + obs.fatMassKg)) * 100;

  return {
    date: obs.date,
    fmi: round2(fmi),
    ffmi: round2(ffmi),
    // Sum of the rounded components — keeps FMI + FFMI = BMI exact in what
    // the UI shows, instead of drifting by rounding.
    bmi: round2(round2(fmi) + round2(ffmi)),
    bodyFatPercent: round1(bodyFatPercent),
    weightKg: round1(observationWeight(obs, ffm)),
  };
}

/** All observations mapped to composition space, sorted by date ascending. */
export function buildCompositionPath(
  observations: CompositionObservation[],
  heightCm: number
): CompositionPoint[] {
  return observations
    .map((obs) => toCompositionPoint(obs, heightCm))
    .filter((p): p is CompositionPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// Goal vector progress
// ============================================================

export interface CompositionCoords {
  fmi: number;
  ffmi: number;
}

/** Raw composition targets as stored on body_composition_targets. */
export interface CompositionTargetInput {
  targetWeightKg?: number | null;
  targetBodyFatPercent?: number | null;
  /** RAW FFMI target (same scale the Goals tab compares against). */
  targetFfmi?: number | null;
}

/**
 * Normalize a stored target to a (FMI*, FFMI*) point.
 *
 * Supported forms (BF% is required by both):
 *   1. target BF% + target weight  → fat = w·bf, ffm = w − fat
 *   2. target BF% + target FFMI    → ffm = ffmi·h², w = ffm/(1 − bf)
 *
 * Weight+BF% wins when both are set. Returns null when the target is not
 * expressible as a point.
 */
export function normalizeTargetPoint(
  target: CompositionTargetInput,
  heightCm: number
): CompositionCoords | null {
  if (!heightCm || heightCm <= 0) return null;
  const bf = target.targetBodyFatPercent;
  if (bf == null || bf <= 0 || bf >= 100) return null;

  const heightM = heightCm / 100;
  const h2 = heightM * heightM;

  if (target.targetWeightKg != null && target.targetWeightKg > 0) {
    const fatKg = target.targetWeightKg * (bf / 100);
    const ffmKg = target.targetWeightKg - fatKg;
    return { fmi: round2(fatKg / h2), ffmi: round2(ffmKg / h2) };
  }

  if (target.targetFfmi != null && target.targetFfmi > 0) {
    // fmi/ffmi = fat/ffm = bf/(100 − bf)
    const fmi = target.targetFfmi * (bf / (100 - bf));
    return { fmi: round2(fmi), ffmi: round2(target.targetFfmi) };
  }

  return null;
}

export type GoalVectorStatus =
  | 'progress'
  | 'target_reached'
  | 'degenerate';

export interface GoalVectorProgress {
  status: GoalVectorStatus;
  /**
   * Scalar projection of (current − start) onto (target − start), as a
   * percentage of the goal vector's length. Negative = moving away
   * (shown honestly); can exceed 100 (past the target). Null when degenerate.
   */
  progressPercent: number | null;
  /** progressPercent capped at 100 for display; null when degenerate. */
  displayPercent: number | null;
  /** Perpendicular distance from the goal line (kg/m²). */
  perpendicularDistance: number;
  /**
   * Qualitative drift when the perpendicular component exceeds
   * OFF_AXIS_NOTE_THRESHOLD: 'fatter' = drifting toward more fat than the
   * planned path, 'leaner' = the opposite. Null when on track.
   */
  offAxisDirection: 'fatter' | 'leaner' | null;
  /** Terse drift copy ready for display; null when no note is warranted. */
  offAxisNote: string | null;
}

export function computeGoalVectorProgress(
  start: CompositionCoords,
  current: CompositionCoords,
  target: CompositionCoords
): GoalVectorProgress {
  const gx = target.fmi - start.fmi;
  const gy = target.ffmi - start.ffmi;
  const gLen = Math.hypot(gx, gy);

  if (gLen < DEGENERATE_GOAL_EPSILON) {
    return {
      status: 'degenerate',
      progressPercent: null,
      displayPercent: null,
      perpendicularDistance: 0,
      offAxisDirection: null,
      offAxisNote: null,
    };
  }

  const dx = current.fmi - start.fmi;
  const dy = current.ffmi - start.ffmi;

  // Scalar projection as a fraction of the goal vector.
  const t = (dx * gx + dy * gy) / (gLen * gLen);
  const progressPercent = Math.round(t * 1000) / 10;

  // Perpendicular component of the deviation.
  const px = dx - t * gx;
  const py = dy - t * gy;
  const perpendicularDistance = Math.round(Math.hypot(px, py) * 100) / 100;

  // Off-axis direction: compare BF% at the current point against BF% at the
  // on-plan point for this stage (start + t·goal). Higher = a fatter path
  // than planned. This stays correct for any goal direction — including a
  // pure fat-loss goal, where the perpendicular is entirely FFMI (losing
  // lean reads as "fatter", since BF% is higher than planned at that FMI).
  let offAxisDirection: 'fatter' | 'leaner' | null = null;
  let offAxisNote: string | null = null;
  if (perpendicularDistance > OFF_AXIS_NOTE_THRESHOLD) {
    const bfOf = (p: CompositionCoords): number | null => {
      const total = p.fmi + p.ffmi;
      return total > 0 ? p.fmi / total : null;
    };
    const planned = { fmi: start.fmi + t * gx, ffmi: start.ffmi + t * gy };
    const bfCurrent = bfOf(current);
    const bfPlanned = bfOf(planned);
    if (bfCurrent != null && bfPlanned != null) {
      offAxisDirection = bfCurrent > bfPlanned ? 'fatter' : 'leaner';
      const onTrack = progressPercent > 0 ? 'on track, ' : '';
      offAxisNote = `${onTrack}slightly ${offAxisDirection} path than planned`;
    }
  }

  return {
    status: t >= 1 ? 'target_reached' : 'progress',
    progressPercent,
    displayPercent: Math.min(100, progressPercent),
    perpendicularDistance,
    offAxisDirection,
    offAxisNote,
  };
}

/**
 * Pick the start point for the goal vector.
 *
 * 'phase' = first scan of the current phase (on/after phaseStartDate, e.g.
 * when the active target was created); falls back to the first scan ever
 * when no phase boundary is known or no scan falls after it. 'all-time' =
 * first scan ever.
 */
export function selectStartPoint(
  points: CompositionPoint[],
  mode: 'phase' | 'all-time',
  phaseStartDate: string | null
): CompositionPoint | null {
  if (points.length === 0) return null;
  if (mode === 'phase' && phaseStartDate) {
    const startDay = phaseStartDate.slice(0, 10);
    const inPhase = points.find((p) => p.date >= startDay);
    if (inPhase) return inPhase;
  }
  return points[0];
}

// ============================================================
// P-ratio between consecutive scans
// ============================================================

export interface ScanPairPRatio {
  fromDate: string;
  toDate: string;
  deltaWeightKg: number;
  /**
   * Fat-free mass delta under the SAME convention as the plotted points
   * (computeFFM + the calculated-entry bone guard). Bone is nearly constant
   * scan-to-scan, so for same-source scans this equals the lean delta the
   * user reads off their reports — but unlike raw stored lean it stays
   * comparable when scan sources mix (a calculated-entry lean already
   * contains bone; a real DEXA lean excludes it).
   */
  deltaLeanKg: number;
  deltaFatKg: number;
  deltaBfPercent: number;
  /**
   * Δlean / Δweight. For a gain: fraction of the gain that was lean. For a
   * loss both deltas are negative, so it reads as the lean fraction of the
   * loss. Can leave [0,1] during recomps (honest — deltas point in opposite
   * directions). Null when suppressed.
   */
  leanFraction: number | null;
  /** Δfat / Δweight — the cut-phase framing. Null when suppressed. */
  fatFraction: number | null;
  /** |Δweight| < 3 lb: p-ratio suppressed (denominator within noise). */
  suppressed: boolean;
  /** |Δlean(FFM)| < 1.5 lb: the LEAN side of the change is inside DEXA
   * repeatability. With a clear weight change this is itself informative —
   * the change was essentially all fat — not a reason to suppress. */
  leanWithinNoise: boolean;
  /** |Δfat| < 1.5 lb: the FAT side is inside DEXA repeatability. */
  fatWithinNoise: boolean;
  /** BOTH components within their floors: the composition split is
   * unresolvable — only then does the segment get the blanket "within
   * measurement noise" label instead of a directional statement. */
  withinNoise: boolean;
}

/** FFM under the same convention as toCompositionPoint (bone counted unless
 * the stored lean already contains it) — the delta between two scans must
 * not mix a bone-inclusive lean with a bone-exclusive one. */
function observationFFM(obs: CompositionObservation): number {
  const boneInLean = leanMassIncludesBone({
    leanMassKg: obs.leanMassKg,
    fatMassKg: obs.fatMassKg,
    weightKg: obs.weightKg,
  });
  return computeFFM(obs.leanMassKg, boneInLean ? null : obs.boneMassKg);
}

export function computeScanPairPRatios(
  observations: CompositionObservation[],
  heightCm: number
): ScanPairPRatio[] {
  const points = buildCompositionPath(observations, heightCm);
  const byDate = new Map(
    observations.map((o) => [o.date, o] as const)
  );

  const pairs: ScanPairPRatio[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const rawA = byDate.get(a.date);
    const rawB = byDate.get(b.date);
    if (!rawA || !rawB) continue;

    const deltaWeightKg = round2(b.weightKg - a.weightKg);
    const deltaLeanKg = round2(observationFFM(rawB) - observationFFM(rawA));
    const deltaFatKg = round2(rawB.fatMassKg - rawA.fatMassKg);
    const deltaBfPercent = round1(b.bodyFatPercent - a.bodyFatPercent);

    const suppressed = Math.abs(deltaWeightKg) < P_RATIO_MIN_WEIGHT_DELTA_KG;
    // Per-component gating: one side being flat while the other clearly
    // moved is a directional finding ("essentially all fat"), not noise.
    // Only when BOTH components sit inside the repeatability floors is the
    // split genuinely unresolvable.
    const leanWithinNoise = Math.abs(deltaLeanKg) < NOISE_FLOOR_LEAN_KG;
    const fatWithinNoise = Math.abs(deltaFatKg) < NOISE_FLOOR_FAT_KG;

    pairs.push({
      fromDate: a.date,
      toDate: b.date,
      deltaWeightKg,
      deltaLeanKg,
      deltaFatKg,
      deltaBfPercent,
      leanFraction: suppressed ? null : round2(deltaLeanKg / deltaWeightKg),
      fatFraction: suppressed ? null : round2(deltaFatKg / deltaWeightKg),
      suppressed,
      leanWithinNoise,
      fatWithinNoise,
      withinNoise: leanWithinNoise && fatWithinNoise,
    });
  }
  return pairs;
}

/**
 * Direction of the phase a p-ratio history will inform: 'surplus' (bulk /
 * gaining) or 'deficit' (cut / losing). A pair only transfers to a projection
 * running the SAME direction — partitioning during a loss says little about
 * partitioning during a gain.
 */
export type PhaseDirection = 'surplus' | 'deficit';

/**
 * The ONE filter that decides which scan pairs may feed a personalized
 * p-ratio (TDEE projections AND the anchored trend's projection segment use
 * this same function — the two consumers must never filter differently):
 *
 *  - drops pairs `suppressed` by the weight-delta noise gate
 *    (P_RATIO_MIN_WEIGHT_DELTA_KG), where the fractions are null;
 *  - drops pairs `withinNoise` (BOTH components inside the DEXA
 *    repeatability floors — the split is unresolvable). A pair with only
 *    ONE component inside its floor is kept: "essentially all fat" is a
 *    directional observation, not noise;
 *  - keeps only pairs whose weight-change sign matches `direction`
 *    (surplus → gains, deficit → losses);
 *  - preserves chronological order (computeScanPairPRatios emits pairs
 *    date-ascending, and this filter never reorders).
 */
export function selectUsablePRatioPairs(
  pairs: ScanPairPRatio[],
  direction: PhaseDirection
): ScanPairPRatio[] {
  return pairs.filter(
    (pair) =>
      !pair.suppressed &&
      !pair.withinNoise &&
      pair.fatFraction != null &&
      pair.leanFraction != null &&
      (direction === 'surplus' ? pair.deltaWeightKg > 0 : pair.deltaWeightKg < 0)
  );
}

export type PartitioningQuality = 'excellent' | 'good' | 'poor' | null;

/**
 * Phase-aware verdict for one scan pair. Returns null (no verdict) when:
 *  - fewer than 2 scan pairs exist overall (confidence gating),
 *  - the pair is suppressed or within measurement noise,
 *  - the pair's weight direction has no meaningful framing for the phase.
 *
 * Bulk framing: higher lean fraction of a GAIN = better.
 * Cut framing: higher fat fraction of a LOSS = better.
 * Maintenance gets no verdict — there's no planned direction to grade.
 */
export function classifyPartitioning(
  pair: ScanPairPRatio,
  phase: Goal | null,
  totalPairCount: number
): PartitioningQuality {
  if (totalPairCount < 2) return null;
  if (pair.suppressed || pair.withinNoise) return null;
  if (!phase || phase === 'maintenance') return null;

  if (phase === 'bulk' && pair.deltaWeightKg > 0 && pair.leanFraction != null) {
    if (pair.leanFraction >= 0.6) return 'excellent';
    if (pair.leanFraction >= 0.4) return 'good';
    if (pair.leanFraction < 0.25) return 'poor';
    return null;
  }
  if (phase === 'cut' && pair.deltaWeightKg < 0 && pair.fatFraction != null) {
    if (pair.fatFraction >= 0.85) return 'excellent';
    if (pair.fatFraction >= 0.7) return 'good';
    if (pair.fatFraction < 0.5) return 'poor';
    return null;
  }
  return null;
}

// ============================================================
// Athletic zone (default destination context)
// ============================================================

/**
 * A composition zone bounded by two constant-BF% rays and two horizontal
 * FFMI lines. Constant-BF% lines are rays from the origin: for a fixed BF
 * fraction b, fmi = (ffmi · b)/(1 − b), i.e. ffmi/fmi has slope (1 − b)/b.
 */
export interface AthleticZone {
  bfLowPercent: number;
  bfHighPercent: number;
  ffmiLow: number;
  ffmiHigh: number;
}

/** Typical athletic range — a destination, not a grade. */
export const ATHLETIC_ZONE_MALE: AthleticZone = {
  bfLowPercent: 10,
  bfHighPercent: 15,
  ffmiLow: 20,
  ffmiHigh: 22,
};

export const ATHLETIC_ZONE_FEMALE: AthleticZone = {
  bfLowPercent: 18,
  bfHighPercent: 25,
  ffmiLow: 16,
  ffmiHigh: 18,
};

export function athleticZoneForSex(sex: 'male' | 'female'): AthleticZone {
  return sex === 'female' ? ATHLETIC_ZONE_FEMALE : ATHLETIC_ZONE_MALE;
}

/** FMI on the constant-BF% ray at a given FFMI. */
export function fmiAtBf(ffmi: number, bfPercent: number): number {
  return Math.round(((ffmi * bfPercent) / (100 - bfPercent)) * 100) / 100;
}

/**
 * Zone polygon vertices in (FMI, FFMI), counterclockwise from the
 * low-BF/low-FFMI corner. The left/right edges follow the BF rays, so the
 * polygon is a trapezoid, not a rectangle.
 */
export function athleticZonePolygon(zone: AthleticZone): CompositionCoords[] {
  return [
    { fmi: fmiAtBf(zone.ffmiLow, zone.bfLowPercent), ffmi: zone.ffmiLow },
    { fmi: fmiAtBf(zone.ffmiLow, zone.bfHighPercent), ffmi: zone.ffmiLow },
    { fmi: fmiAtBf(zone.ffmiHigh, zone.bfHighPercent), ffmi: zone.ffmiHigh },
    { fmi: fmiAtBf(zone.ffmiHigh, zone.bfLowPercent), ffmi: zone.ffmiHigh },
  ];
}

/** Does the zone's bounding box overlap the viewport at all? */
export function zoneOverlapsDomain(zone: AthleticZone, domain: MapDomain): boolean {
  const poly = athleticZonePolygon(zone);
  const minF = Math.min(...poly.map((p) => p.fmi));
  const maxF = Math.max(...poly.map((p) => p.fmi));
  return (
    maxF >= domain.x[0] &&
    minF <= domain.x[1] &&
    zone.ffmiHigh >= domain.y[0] &&
    zone.ffmiLow <= domain.y[1]
  );
}

/** Compass arrow from the viewport center toward an off-viewport point —
 * shared by the zone and Start edge indicators. */
export function directionArrowTo(point: CompositionCoords, domain: MapDomain): string {
  const dx = point.fmi - (domain.x[0] + domain.x[1]) / 2;
  const dy = point.ffmi - (domain.y[0] + domain.y[1]) / 2;
  // Octant by angle; y up in data space.
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const arrows: Record<number, string> = {
    0: '→',
    1: '↗',
    2: '↑',
    3: '↖',
    4: '←',
    [-4]: '←',
    [-3]: '↙',
    [-2]: '↓',
    [-1]: '↘',
  };
  return arrows[octant] ?? '→';
}

/** Compass arrow from the viewport center toward the zone centroid — for
 * the "target zone ↖" edge indicator when the zone is off-viewport. */
export function zoneDirectionArrow(zone: AthleticZone, domain: MapDomain): string {
  const poly = athleticZonePolygon(zone);
  return directionArrowTo(
    {
      fmi: poly.reduce((s, p) => s + p.fmi, 0) / poly.length,
      ffmi: poly.reduce((s, p) => s + p.ffmi, 0) / poly.length,
    },
    domain
  );
}

/** Is a point inside the viewport? (For clipping Fit-data geometry.) */
export function pointInDomain(point: CompositionCoords, domain: MapDomain): boolean {
  return (
    point.fmi >= domain.x[0] &&
    point.fmi <= domain.x[1] &&
    point.ffmi >= domain.y[0] &&
    point.ffmi <= domain.y[1]
  );
}

/** Fit-data viewport fits this many most-recent scans (older scans clip
 * out and Start gets an edge indicator). */
export const FIT_DATA_RECENT_SCANS = 4;

/** Maximum persistent label PILLS per view mode: Fit data = Latest +
 * Target; Fit all also allows Start. Everything else renders as plain
 * text, caption copy, or tap-to-reveal. A dev-mode warning fires when the
 * rendered count exceeds this, so the policy can't silently regress. */
export const MAP_PILL_CAP: Record<'recent' | 'all', number> = { recent: 2, all: 3 };

// ============================================================
// Suggested target (next milestone, not the final zone)
// ============================================================

/** Conservative first-bulk FFMI gain; halves as training age climbs.
 * Suggested gains must not overpromise. */
export const SUGGESTED_BULK_FFMI_GAIN: Record<Experience, number> = {
  novice: 1.5,
  intermediate: 1.0,
  advanced: 0.5,
};

/** BF ceiling for a bulk milestone: current + this, hard-capped below. */
export const SUGGESTED_BULK_BF_GAIN_PERCENT = 4;
export const SUGGESTED_BULK_BF_CAP_PERCENT = 24;

/** Expected small lean cost of a sensible cut. */
export const SUGGESTED_CUT_FFMI_LOSS = 0.2;

/** Cut milestone BF% by profile (mid of the typical 12–15 / 20–23 bands). */
export const SUGGESTED_CUT_BF_PERCENT: Record<'male' | 'female', number> = {
  male: 13,
  female: 21,
};

export interface SuggestedTargetInput {
  /** Latest scan's position. */
  current: CompositionCoords;
  phase: Goal | null;
  experience?: Experience | null;
  sex: 'male' | 'female';
}

/**
 * Next-waypoint suggestion from current stats and phase. Null for
 * maintenance/unknown phases (the athletic zone carries the long-term
 * context) and for cuts already at/below the milestone BF%.
 */
export function computeSuggestedTarget(
  input: SuggestedTargetInput
): { ffmi: number; bodyFatPercent: number; fmi: number } | null {
  const { current, phase, experience, sex } = input;
  const total = current.fmi + current.ffmi;
  if (total <= 0) return null;
  const currentBf = (current.fmi / total) * 100;

  if (phase === 'bulk') {
    const gain = SUGGESTED_BULK_FFMI_GAIN[experience ?? 'intermediate'];
    const ffmi = Math.round((current.ffmi + gain) * 10) / 10;
    const bf =
      Math.round(
        Math.min(currentBf + SUGGESTED_BULK_BF_GAIN_PERCENT, SUGGESTED_BULK_BF_CAP_PERCENT) * 10
      ) / 10;
    return { ffmi, bodyFatPercent: bf, fmi: fmiAtBf(ffmi, bf) };
  }

  if (phase === 'cut') {
    const bf = SUGGESTED_CUT_BF_PERCENT[sex];
    // Already at/below the milestone: no meaningful cut waypoint.
    if (currentBf <= bf + 0.5) return null;
    const ffmi = Math.round((current.ffmi - SUGGESTED_CUT_FFMI_LOSS) * 10) / 10;
    return { ffmi, bodyFatPercent: bf, fmi: fmiAtBf(ffmi, bf) };
  }

  return null;
}

// ============================================================
// Trend forecast (forward extrapolation)
// ============================================================

/** How far the forecast extrapolates. */
export const FORECAST_HORIZON_WEEKS = 12;

/** Cone radius at t=0: DEXA repeatability (~±1.5 lb per component ≈
 * 0.25 kg/m² at typical heights). */
export const FORECAST_NOISE_RADIUS = 0.25;

/** Cone growth: fraction of the traveled distance added as uncertainty per
 * week — partitioning of future weight change is far less predictable than
 * its size (p-ratio confidence ranges span ~±0.15–0.25). */
export const FORECAST_SPREAD_FRACTION = 0.35;

/** Below this speed (kg/m² per week) the trend is flat — a forecast would
 * be projecting noise. */
export const FORECAST_MIN_SPEED = 0.01;

/** The central path passing within this distance of the goal counts as
 * "reaches the goal" for the ETA readout. */
export const FORECAST_GOAL_HIT_RADIUS = 0.35;

/** ETAs beyond this are not worth stating — too much life between here
 * and there. */
export const FORECAST_MAX_ETA_WEEKS = 26;

/** Phase-aware direction: when the phase changed AFTER the last scan, the
 * scan-pair velocity describes the OLD phase. Require at least this many
 * days of post-scan weigh-ins before trusting the new direction. */
export const FORECAST_PHASE_MIN_TAIL_DAYS = 14;

/** Weigh-in window for the phase-aware direction — recent enough to
 * exclude pre-phase data. */
export const FORECAST_WEIGHIN_WINDOW_DAYS = 21;

export interface ForecastPathPoint {
  /** Weeks ahead of the anchor. */
  weeks: number;
  fmi: number;
  ffmi: number;
  /** Uncertainty radius (kg/m²) at this point. */
  radius: number;
}

export interface CompositionForecast {
  status: 'ok' | 'flat' | 'insufficient';
  /** Weekly velocity in composition space (kg/m² per week). */
  velocity: { fmi: number; ffmi: number };
  /** Where the velocity came from: the last scan pair, or (phase-aware)
   * the recent weigh-in-driven estimate. */
  basis: 'scans' | 'weigh-ins';
  /** Central extrapolated path, 1-week steps from the anchor (exclusive). */
  path: ForecastPathPoint[];
  /** Weeks until the central path passes within FORECAST_GOAL_HIT_RADIUS of
   * the goal; null when there is no goal, the trend never gets that close,
   * or it would take longer than FORECAST_MAX_ETA_WEEKS. */
  goalEtaWeeks: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FORECAST_DAY_MS = 24 * 60 * 60 * 1000;

function forecastDay(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime() / FORECAST_DAY_MS;
}

export interface ForecastOptions {
  /** Post-scan weigh-in estimate points (the map's dashed tail). */
  tail?: CompositionPoint[];
  /** When the current phase began (active target's createdAt). */
  phaseStartDate?: string | null;
  horizonWeeks?: number;
}

/**
 * Extrapolate the recent trend forward.
 *
 * Velocity normally comes from the LAST TWO SCANS (measured data). The one
 * exception is phase-aware: when the phase changed AFTER the last scan and
 * at least FORECAST_PHASE_MIN_TAIL_DAYS of post-scan weigh-ins exist, the
 * scan pair describes the OLD phase (a cut's down-left trend must not fan
 * the cone during a new bulk) — so the direction comes from the last
 * ≤FORECAST_WEIGHIN_WINDOW_DAYS of the weigh-in estimate instead.
 *
 * The path projects from `anchor` — the current estimated position when
 * weigh-ins exist past the last scan, else the last scan itself.
 * Uncertainty widens linearly: DEXA noise at t=0 plus a fraction of the
 * traveled distance (partitioning variance dominates the further out you
 * look). "If the trend holds", never a promise.
 */
export function computeCompositionForecast(
  scanPoints: CompositionPoint[],
  anchor: CompositionCoords,
  target: CompositionCoords | null,
  options: ForecastOptions = {}
): CompositionForecast {
  const horizonWeeks = options.horizonWeeks ?? FORECAST_HORIZON_WEEKS;
  const none = {
    velocity: { fmi: 0, ffmi: 0 },
    basis: 'scans' as const,
    path: [],
    goalEtaWeeks: null,
  };
  if (scanPoints.length < 2) return { status: 'insufficient', ...none };

  const lastScan = scanPoints[scanPoints.length - 1];

  // Phase-aware branch: phase started post-scan AND the tail has matured.
  let velocity: { fmi: number; ffmi: number } | null = null;
  let basis: 'scans' | 'weigh-ins' = 'scans';
  const tail = options.tail ?? [];
  const phaseStart = options.phaseStartDate?.slice(0, 10) ?? null;
  if (tail.length > 0 && phaseStart && phaseStart > lastScan.date) {
    const tailEnd = tail[tail.length - 1];
    const phaseDay = forecastDay(phaseStart);
    // Maturity is measured from the PHASE START, not the last scan —
    // weigh-ins logged before the phase began belong to the OLD phase, and
    // a bulk target created after weeks of cut weigh-ins must not project
    // the cut direction under a 'weigh-ins' basis.
    const postPhaseDays = forecastDay(tailEnd.date) - phaseDay;
    if (postPhaseDays >= FORECAST_PHASE_MIN_TAIL_DAYS) {
      // Reference point: inside the recent window AND no earlier than the
      // phase start — the direction only ever samples post-phase data.
      const windowStartDay = Math.max(
        forecastDay(tailEnd.date) - FORECAST_WEIGHIN_WINDOW_DAYS,
        phaseDay
      );
      const ref = tail.find((p) => forecastDay(p.date) >= windowStartDay) ?? null;
      const refWeeks = ref ? (forecastDay(tailEnd.date) - forecastDay(ref.date)) / 7 : 0;
      if (ref && refWeeks > 0) {
        velocity = {
          fmi: (tailEnd.fmi - ref.fmi) / refWeeks,
          ffmi: (tailEnd.ffmi - ref.ffmi) / refWeeks,
        };
        basis = 'weigh-ins';
      }
    }
  }

  if (!velocity) {
    const a = scanPoints[scanPoints.length - 2];
    const b = lastScan;
    const weeksBetween =
      (new Date(`${b.date}T00:00:00Z`).getTime() - new Date(`${a.date}T00:00:00Z`).getTime()) /
      WEEK_MS;
    if (weeksBetween <= 0) return { status: 'insufficient', ...none };
    velocity = {
      fmi: (b.fmi - a.fmi) / weeksBetween,
      ffmi: (b.ffmi - a.ffmi) / weeksBetween,
    };
  }

  const speed = Math.hypot(velocity.fmi, velocity.ffmi);
  if (speed < FORECAST_MIN_SPEED) {
    return { status: 'flat', velocity, basis, path: [], goalEtaWeeks: null };
  }

  const path: ForecastPathPoint[] = [];
  for (let t = 1; t <= horizonWeeks; t++) {
    path.push({
      weeks: t,
      fmi: Math.round((anchor.fmi + velocity.fmi * t) * 100) / 100,
      ffmi: Math.round((anchor.ffmi + velocity.ffmi * t) * 100) / 100,
      radius: Math.round((FORECAST_NOISE_RADIUS + FORECAST_SPREAD_FRACTION * speed * t) * 100) / 100,
    });
  }

  // ETA: closest approach of the (unbounded) central path to the goal.
  let goalEtaWeeks: number | null = null;
  if (target) {
    const gx = target.fmi - anchor.fmi;
    const gy = target.ffmi - anchor.ffmi;
    const tStar = (gx * velocity.fmi + gy * velocity.ffmi) / (speed * speed);
    if (tStar > 0 && tStar <= FORECAST_MAX_ETA_WEEKS) {
      const missX = anchor.fmi + velocity.fmi * tStar - target.fmi;
      const missY = anchor.ffmi + velocity.ffmi * tStar - target.ffmi;
      if (Math.hypot(missX, missY) <= FORECAST_GOAL_HIT_RADIUS) {
        goalEtaWeeks = Math.round(tStar);
      }
    }
  }

  return { status: 'ok', velocity, basis, path, goalEtaWeeks };
}

// ============================================================
// Prominence / layout gating
// ============================================================

export interface BodyCompLayout {
  /** Trend module renders at the top of the Body tab (above the nudges). */
  trendFirst: boolean;
  /** Subtle "log a scan" prompt shown with the existing layout. */
  showScanPrompt: boolean;
  /** Composition Map toggle available. */
  showCompositionMap: boolean;
  /** Compact body-comp card on the Home dashboard. */
  showHomeCard: boolean;
}

export function getBodyCompLayout(scanCount: number): BodyCompLayout {
  const unlocked = scanCount >= MIN_SCANS_FOR_COMPOSITION_MAP;
  return {
    trendFirst: unlocked,
    showScanPrompt: !unlocked,
    showCompositionMap: unlocked,
    showHomeCard: unlocked,
  };
}

// ============================================================
// Map viewport helpers (pure, unit-testable chart geometry)
// ============================================================

export interface MapDomain {
  x: [number, number];
  y: [number, number];
}

/**
 * Axis domain covering all points (and the target, when set) with padding,
 * snapped outward to 0.5 kg/m². A minimum span keeps a tight cluster of
 * scans from zooming into noise.
 */
export function computeMapDomain(
  points: CompositionCoords[],
  target: CompositionCoords | null = null,
  padding = 0.75,
  minSpan = 3
): MapDomain {
  const all = target ? [...points, target] : [...points];
  if (all.length === 0) {
    return { x: [0, 10], y: [14, 26] };
  }
  const snapDown = (v: number) => Math.floor((v - padding) * 2) / 2;
  const snapUp = (v: number) => Math.ceil((v + padding) * 2) / 2;

  let x0 = snapDown(Math.min(...all.map((p) => p.fmi)));
  let x1 = snapUp(Math.max(...all.map((p) => p.fmi)));
  let y0 = snapDown(Math.min(...all.map((p) => p.ffmi)));
  let y1 = snapUp(Math.max(...all.map((p) => p.ffmi)));

  if (x1 - x0 < minSpan) {
    const pad = (minSpan - (x1 - x0)) / 2;
    x0 -= pad;
    x1 += pad;
  }
  if (y1 - y0 < minSpan) {
    const pad = (minSpan - (y1 - y0)) / 2;
    y0 -= pad;
    y1 += pad;
  }
  x0 = Math.max(0, x0);
  return { x: [x0, x1], y: [y0, y1] };
}

export interface IsoBmiSegment {
  bmi: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Clip the diagonal fmi + ffmi = bmi to the domain rectangle. Returns null
 * when the line misses the viewport (or degenerates to a point).
 */
export function isoBmiSegment(bmi: number, domain: MapDomain): IsoBmiSegment | null {
  const [x0, x1] = domain.x;
  const [y0, y1] = domain.y;
  // ffmi decreases as fmi increases along the line; entering x is bounded by
  // both the x-range and where the line is inside the y-range.
  const xStart = Math.max(x0, bmi - y1);
  const xEnd = Math.min(x1, bmi - y0);
  if (xStart >= xEnd) return null;
  return {
    bmi,
    x1: round2(xStart),
    y1: round2(bmi - xStart),
    x2: round2(xEnd),
    y2: round2(bmi - xEnd),
  };
}

/** The subset of ISO_BMI_LEVELS visible in the given domain. */
export function visibleIsoBmiSegments(domain: MapDomain): IsoBmiSegment[] {
  return ISO_BMI_LEVELS.map((bmi) => isoBmiSegment(bmi, domain)).filter(
    (s): s is IsoBmiSegment => s !== null
  );
}

// ============================================================
// Small shared utils
// ============================================================

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
