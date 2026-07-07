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
import type { Goal } from '@/types/schema';

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
