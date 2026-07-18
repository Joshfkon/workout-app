/**
 * Body Composition Engine
 * Handles FFMI calculations, body composition analysis, and coaching recommendations
 */

import type {
  DexaScan,
  FFMIResult,
  FFMIClassification,
  BodyCompTrend,
  BodyCompRecommendation,
  BodyCompTargets,
  Goal,
  Experience,
} from '@/types/schema';
import { PHASE_BOUNDARY_DAYS, spansPhaseBoundary } from '@/lib/nutrition/interval-tdee';

// ============ FFMI CALCULATIONS ============

/**
 * Fat-free mass in kg.
 *
 * FFM DEFINITION: DEXA "lean mass" excludes bone mineral content (BMC), but
 * true fat-free mass = lean + BMC. When the scan logged bone mass we include
 * it; when it's absent we fall back to lean-only (slightly understating FFMI
 * by ~0.8-1.0 for most adults). Every FFMI surface in the app — the Analytics
 * gauge and the Body Composition Trend series — MUST go through computeFFMI
 * below so they share this exact definition.
 */
export function computeFFM(leanMassKg: number, boneMassKg?: number | null): number {
  return leanMassKg + (boneMassKg != null && boneMassKg > 0 ? boneMassKg : 0);
}

/**
 * Whether a scan's stored lean mass already CONTAINS bone.
 *
 * A real DEXA report's lean excludes bone (lean + fat + bone ≈ total weight),
 * but scans entered through the add-scan form's "calculated" mode store
 * lean = weight × (1 − BF%) = weight − fat, which spans everything that isn't
 * fat — bone included. Passing such a lean to computeFFM together with a
 * logged bone mass would double-count the bone.
 *
 * Detect the shape instead of the entry path: when lean + fat reaches the
 * recorded total (within 1 kg — adult BMC runs ~2-4.5 kg, so a genuine
 * bone-exclusive lean leaves a gap well above that), there is no room left
 * for bone outside lean. Callers must pass boneMassKg = null to computeFFM
 * for these records. Without a recorded total we assume the DEXA convention
 * (lean excludes bone).
 */
export function leanMassIncludesBone(scan: {
  leanMassKg: number;
  fatMassKg: number;
  weightKg?: number | null;
}): boolean {
  if (scan.weightKg == null || scan.weightKg <= 0) return false;
  return scan.leanMassKg + scan.fatMassKg >= scan.weightKg - 1.0;
}

/**
 * Single source of truth for FFMI from a body-composition observation.
 * Used by both the Analytics FFMI gauge and the trend chart's FFMI series —
 * do not compute FFMI anywhere else from lean/bone directly.
 *
 * All inputs are canonical units (kg / cm); do lb→kg and in→cm conversion at
 * the edges (lib/utils) before calling.
 */
export function computeFFMI(
  leanMassKg: number,
  boneMassKg: number | null | undefined,
  heightCm: number
): FFMIResult {
  return calculateFFMI(computeFFM(leanMassKg, boneMassKg), heightCm);
}

/**
 * THE canonical current-FFMI selector. Every surface that shows "your FFMI"
 * (Home tile, Body tab stat strip + gauge, Strength card, targets editor)
 * must derive it through this function so the number can never differ
 * between surfaces.
 *
 * Preference order:
 *  1. Last point of the DEXA-anchored trend (the same series the Body
 *     Composition Trend chart plots) — stays current as weigh-ins accumulate
 *     after the latest scan.
 *  2. The latest raw scan through the same computeFFMI (with the
 *     bone-double-count guard) while the trend is loading / absent.
 *
 * The height-normalized variant lives on the returned FFMIResult
 * (`normalizedFfmi`) and may only ever be shown as a clearly-labeled
 * secondary readout, never silently substituted for `ffmi`.
 */
export function selectCanonicalFfmi(input: {
  /** Last point of the anchored trend (useBodyCompTrend / fetchBodyCompGlance). */
  trendLastPoint?: { leanMassKg: number; boneMassKg: number | null } | null;
  /** Latest DEXA scan — fallback while the trend loads. */
  latestScan?: DexaScan | null;
  heightCm: number | null | undefined;
}): FFMIResult | null {
  const { trendLastPoint, latestScan, heightCm } = input;
  if (!heightCm) return null;
  if (trendLastPoint) {
    return computeFFMI(trendLastPoint.leanMassKg, trendLastPoint.boneMassKg, heightCm);
  }
  if (latestScan) {
    return computeFFMI(
      latestScan.leanMassKg,
      // Calculated-entry scans store lean = weight − fat (bone already
      // inside) — adding BMC would double-count it.
      leanMassIncludesBone(latestScan) ? null : latestScan.boneMassKg,
      heightCm
    );
  }
  return null;
}

/**
 * Calculate FFMI (Fat-Free Mass Index) from fat-free mass and height
 * FFMI = FFM (kg) / height (m)²
 * Normalized FFMI = FFMI + 6.1 × (1.8 - height in m)
 */
export function calculateFFMI(leanMassKg: number, heightCm: number): FFMIResult {
  const heightM = heightCm / 100;
  const ffmi = leanMassKg / (heightM * heightM);
  const normalizedFfmi = ffmi + 6.1 * (1.8 - heightM);
  
  const classification = classifyFFMI(normalizedFfmi);
  const naturalLimit = 25; // Generally accepted natural limit
  const percentOfLimit = Math.min((normalizedFfmi / naturalLimit) * 100, 100);
  
  return {
    ffmi: Math.round(ffmi * 10) / 10,
    normalizedFfmi: Math.round(normalizedFfmi * 10) / 10,
    classification,
    naturalLimit,
    percentOfLimit: Math.round(percentOfLimit),
  };
}

/**
 * Classify FFMI into categories
 */
function classifyFFMI(normalizedFfmi: number): FFMIClassification {
  if (normalizedFfmi < 18) return 'below_average';
  if (normalizedFfmi < 20) return 'average';
  if (normalizedFfmi < 22) return 'above_average';
  if (normalizedFfmi < 23) return 'excellent';
  if (normalizedFfmi < 25) return 'superior';
  return 'suspicious';
}

/**
 * Get natural FFMI limit based on experience level
 * These are rough estimates for natural lifters
 */
export function getNaturalFFMILimit(experience: Experience): number {
  switch (experience) {
    case 'novice':
      return 22; // Beginners have more room to grow
    case 'intermediate':
      return 24; // Getting closer to genetic potential
    case 'advanced':
      return 25; // Near genetic ceiling
    default:
      return 25;
  }
}

/**
 * Get FFMI classification label for display
 */
export function getFFMILabel(classification: FFMIClassification): string {
  switch (classification) {
    case 'below_average':
      return 'Below Average';
    case 'average':
      return 'Average';
    case 'above_average':
      return 'Above Average';
    case 'excellent':
      return 'Excellent';
    case 'superior':
      return 'Superior';
    case 'suspicious':
      return 'Elite (Near Genetic Limit)';
  }
}

// ============ TREND ANALYSIS ============

/**
 * Analyze body composition trends from multiple DEXA scans
 * Requires at least 2 scans to calculate trends
 */
export function analyzeBodyCompTrend(
  scans: DexaScan[],
  heightCm: number
): BodyCompTrend | null {
  if (scans.length < 2) return null;
  
  // Sort by date descending (most recent first)
  const sortedScans = [...scans].sort(
    (a, b) => new Date(b.scanDate).getTime() - new Date(a.scanDate).getTime()
  );
  
  const newest = sortedScans[0];
  const oldest = sortedScans[sortedScans.length - 1];
  
  // Calculate time difference in months
  const daysDiff = (new Date(newest.scanDate).getTime() - new Date(oldest.scanDate).getTime()) 
    / (1000 * 60 * 60 * 24);
  const monthsDiff = daysDiff / 30.44; // Average days per month
  
  if (monthsDiff < 0.5) {
    // Less than 2 weeks of data, not enough for trends
    return null;
  }
  
  // Calculate changes
  const leanMassChange = newest.leanMassKg - oldest.leanMassKg;
  const fatMassChange = newest.fatMassKg - oldest.fatMassKg;
  const bodyFatChange = newest.bodyFatPercent - oldest.bodyFatPercent;
  
  // Canonical FFMI definition (bone-aware) for the rate; raw-vs-normalized is
  // irrelevant for a CHANGE (the height adjustment is a constant offset).
  const newestFFMI = computeFFMI(
    newest.leanMassKg,
    leanMassIncludesBone(newest) ? null : newest.boneMassKg,
    heightCm
  );
  const oldestFFMI = computeFFMI(
    oldest.leanMassKg,
    leanMassIncludesBone(oldest) ? null : oldest.boneMassKg,
    heightCm
  );
  const ffmiChange = newestFFMI.ffmi - oldestFFMI.ffmi;
  
  // Monthly rates
  const leanMassChangeRate = leanMassChange / monthsDiff;
  const fatMassChangeRate = fatMassChange / monthsDiff;
  const bodyFatChangeRate = bodyFatChange / monthsDiff;
  const ffmiChangeRate = ffmiChange / monthsDiff;
  
  // Determine trend
  let trend: BodyCompTrend['trend'];
  const muscleThreshold = 0.1; // kg/month
  const fatThreshold = 0.2; // kg/month

  // Check recomping first since it's the most specific (both conditions must be true)
  if (leanMassChangeRate > muscleThreshold && fatMassChangeRate < -fatThreshold) {
    trend = 'recomping';
  } else if (leanMassChangeRate > muscleThreshold && fatMassChangeRate > fatThreshold) {
    trend = 'gaining_muscle'; // Bulk (gaining both but emphasize muscle)
  } else if (leanMassChangeRate < -muscleThreshold) {
    trend = 'losing_muscle';
  } else if (fatMassChangeRate > fatThreshold) {
    trend = 'gaining_fat';
  } else if (fatMassChangeRate < -fatThreshold) {
    trend = 'losing_fat';
  } else {
    trend = 'stable';
  }
  
  return {
    leanMassChangeRate: Math.round(leanMassChangeRate * 100) / 100,
    fatMassChangeRate: Math.round(fatMassChangeRate * 100) / 100,
    bodyFatChangeRate: Math.round(bodyFatChangeRate * 100) / 100,
    ffmiChangeRate: Math.round(ffmiChangeRate * 100) / 100,
    trend,
    dataPoints: scans.length,
  };
}

// ============ COACHING RECOMMENDATIONS ============

export interface RecommendationOptions {
  /**
   * Display unit for mass rates in messages. Storage stays kg; this only
   * affects formatting. Defaults to 'kg' for back-compat.
   */
  weightUnit?: 'kg' | 'lb';
  /**
   * Phase-change start dates (YYYY-MM-DD, e.g. bulk started). An endpoint
   * scan taken inside the water/glycogen window after one of these makes the
   * two-endpoint slope untrustworthy (same PHASE_BOUNDARY_DAYS window the
   * TDEE interval estimator excludes), so trend recommendations are
   * suppressed rather than emitted from corrupted data.
   */
  phaseChangeDates?: string[];
  /**
   * The active training-phase span (training_phases). When present, every
   * TREND-based recommendation is computed from scans INSIDE this span only —
   * a slope must never cross a phase boundary (the old "Lean Mass Trending
   * Down During Bulk" bug paired a cut-era scan with a bulk-era scan). With
   * fewer than 2 in-phase scans, trend advice is withheld entirely. The
   * phase's type also supersedes the profile goal for advice direction.
   */
  activePhase?: {
    phaseType: Goal;
    /** localDay YYYY-MM-DD */
    startDay: string;
    /** null = still active */
    endDay: string | null;
  } | null;
}

const KG_TO_LB = 2.20462;

function formatMassRate(kgPerMonth: number, unit: 'kg' | 'lb', decimals = 1): string {
  const value = unit === 'lb' ? kgPerMonth * KG_TO_LB : kgPerMonth;
  return `${value.toFixed(decimals)} ${unit === 'lb' ? 'lbs' : 'kg'}`;
}

function formatScanDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Whether either endpoint scan of the trend window falls inside the
 * post-phase-change water/glycogen window. DEXA lean mass includes water, so
 * an endpoint inside that window corrupts the endpoint-to-endpoint slope the
 * same way it corrupts a TDEE interval.
 */
export function trendEndpointsInPhaseWindow(
  scans: DexaScan[],
  phaseChangeDates: string[]
): boolean {
  if (scans.length < 2 || phaseChangeDates.length === 0) return false;
  const dates = scans.map((s) => s.scanDate.slice(0, 10)).sort();
  const oldest = dates[0];
  const newest = dates[dates.length - 1];
  // Degenerate [date, date] intervals reuse the shared overlap test.
  return (
    spansPhaseBoundary(oldest, oldest, phaseChangeDates) ||
    spansPhaseBoundary(newest, newest, phaseChangeDates)
  );
}

/**
 * Generate coaching recommendations based on body composition data.
 *
 * Honesty rules (mirroring the deload advisor):
 *  - Every trend-based recommendation cites its evidence (scan count, date
 *    span, measured rate).
 *  - Trend recommendations are SUPPRESSED when the slope rests on fewer than
 *    2 DEXA-anchored intervals (<3 scans), or when an endpoint scan sits in
 *    the post-phase-change water-weight window — a slope from corrupted or
 *    threadbare data reads as precision it doesn't have.
 *  - Negative rates are phrased as losses, never "gaining -X".
 */
export function generateCoachingRecommendations(
  scans: DexaScan[],
  heightCm: number,
  goal: Goal,
  experience: Experience,
  options: RecommendationOptions = {}
): BodyCompRecommendation[] {
  const recommendations: BodyCompRecommendation[] = [];
  const unit = options.weightUnit ?? 'kg';

  if (scans.length === 0) {
    recommendations.push({
      type: 'info',
      title: 'Get Started',
      message: 'Add your first DEXA scan to start tracking your body composition and receive personalized recommendations.',
      priority: 1,
    });
    return recommendations;
  }

  const latestScan = scans[0];
  // Canonical FFMI definition (lean + bone unless bone is baked into lean).
  const ffmiResult = selectCanonicalFfmi({ latestScan, heightCm })!;
  const activePhase = options.activePhase ?? null;
  // Phase-aware trend scope: with an active phase, the slope may only see
  // scans inside the phase — never across its start boundary.
  const trendScans = activePhase
    ? scans.filter((s) => {
        const scanDay = s.scanDate.slice(0, 10);
        return (
          scanDay >= activePhase.startDay &&
          (activePhase.endDay === null || scanDay <= activePhase.endDay)
        );
      })
    : scans;
  // The phase type supersedes the profile goal for advice direction.
  const effectiveGoal: Goal = activePhase ? activePhase.phaseType : goal;
  const trend = analyzeBodyCompTrend(trendScans, heightCm);
  const naturalLimit = getNaturalFFMILimit(experience);

  // FFMI-based recommendations
  if (ffmiResult.normalizedFfmi >= naturalLimit - 1) {
    recommendations.push({
      type: 'achievement',
      title: 'Near Genetic Potential',
      message: `Your height-normalized FFMI of ${ffmiResult.normalizedFfmi} is approaching the natural limit. Focus on maintaining your physique and making incremental improvements.`,
      priority: 3,
    });
  }

  // Body fat recommendations
  if (effectiveGoal === 'bulk' && latestScan.bodyFatPercent > 20) {
    recommendations.push({
      type: 'warning',
      title: 'Consider a Mini-Cut',
      message: `At ${latestScan.bodyFatPercent}% body fat, you may want to do a short cut (4-6 weeks) before continuing your bulk. This improves insulin sensitivity and nutrient partitioning.`,
      priority: 5,
      evidence: `Latest DEXA (${formatScanDate(latestScan.scanDate)}): ${latestScan.bodyFatPercent}% body fat`,
    });
  }

  if (effectiveGoal === 'cut' && latestScan.bodyFatPercent < 10) {
    recommendations.push({
      type: 'warning',
      title: 'Risk of Muscle Loss',
      message: `At ${latestScan.bodyFatPercent}% body fat, the risk of muscle loss increases significantly. Consider transitioning to maintenance or a slower deficit.`,
      priority: 5,
      evidence: `Latest DEXA (${formatScanDate(latestScan.scanDate)}): ${latestScan.bodyFatPercent}% body fat`,
    });
  }

  // Trend-based recommendations. Gating without a phase span: the
  // two-endpoint slope needs at least 2 DEXA-anchored intervals (≥3 scans).
  // With an active phase the span itself scopes the slope, and 2 in-phase
  // scans suffice (the phase boundary already excludes regime changes). In
  // both modes the endpoints must clear the phase-boundary water window.
  const intervals = trend ? trend.dataPoints - 1 : 0;
  const waterWindowDates = [
    ...(options.phaseChangeDates ?? []),
    ...(activePhase ? [activePhase.startDay] : []),
  ];
  const inPhaseWindow = trendEndpointsInPhaseWindow(trendScans, waterWindowDates);
  const trendIsTrustworthy =
    trend != null && intervals >= (activePhase ? 1 : 2) && !inPhaseWindow;

  if (activePhase && scans.length >= 2 && trendScans.length < 2) {
    // Enough scans overall, but not within the current phase — a slope across
    // the boundary would mix regimes, so composition advice waits.
    recommendations.push({
      type: 'info',
      title: 'Composition Trend Still Calibrating',
      message:
        'Composition advice needs 2 DEXA scans inside the current phase — scans from a previous phase can\'t be compared across the boundary. Log your next scan to unlock it.',
      priority: 1,
      evidence: `${trendScans.length} of ${scans.length} DEXA scans fall inside the current phase (started ${formatScanDate(activePhase.startDay)})`,
    });
  }

  if (trend && !trendIsTrustworthy) {
    // Soften instead of asserting: say WHY there's no composition advice.
    recommendations.push({
      type: 'info',
      title: 'Composition Trend Still Calibrating',
      message: inPhaseWindow
        ? `A recent phase change puts a scan inside the ~${PHASE_BOUNDARY_DAYS}-day water/glycogen shift window, so scan-to-scan changes mostly reflect water — composition advice is paused until a scan lands outside it.`
        : 'Composition advice needs at least 3 DEXA scans to separate a real trend from scan-to-scan noise. Log your next scan to unlock it.',
      priority: 1,
      evidence: `${trend.dataPoints} DEXA scans (${formatScanDate(trendScans[trendScans.length - 1].scanDate)} → ${formatScanDate(trendScans[0].scanDate)})`,
    });
  }

  if (trend && trendIsTrustworthy) {
    const sortedDates = trendScans.map((s) => s.scanDate).sort();
    const spanEvidence = `${trend.dataPoints} DEXA scans (${formatScanDate(sortedDates[0])} → ${formatScanDate(sortedDates[sortedDates.length - 1])})`;
    const leanEvidence = `${spanEvidence}: lean mass ${trend.leanMassChangeRate >= 0 ? '+' : '−'}${formatMassRate(Math.abs(trend.leanMassChangeRate), unit, 1)}/mo`;
    const fatEvidence = `${spanEvidence}: fat mass ${trend.fatMassChangeRate >= 0 ? '+' : '−'}${formatMassRate(Math.abs(trend.fatMassChangeRate), unit, 1)}/mo`;

    if (effectiveGoal === 'bulk' && trend.fatMassChangeRate > 0.5) {
      recommendations.push({
        type: 'warning',
        title: 'Fat Gain Too Fast',
        message: `You're gaining ${formatMassRate(trend.fatMassChangeRate, unit)} of fat per month. Consider reducing your caloric surplus by 200-300 calories to optimize muscle-to-fat ratio.`,
        priority: 4,
        evidence: fatEvidence,
      });
    }

    if (effectiveGoal === 'bulk' && trend.leanMassChangeRate < -0.1) {
      // A negative lean slope is a LOSS — never phrased as "gaining -X".
      recommendations.push({
        type: 'warning',
        title: 'Lean Mass Trending Down During Bulk',
        message: `Your lean mass is trending down ${formatMassRate(Math.abs(trend.leanMassChangeRate), unit)} per month while bulking, which is unusual — check scan conditions (hydration, time of day) and training consistency before changing your diet.`,
        priority: 4,
        evidence: leanEvidence,
      });
    } else if (effectiveGoal === 'bulk' && trend.leanMassChangeRate < 0.2 && experience !== 'advanced') {
      const flat = Math.abs(trend.leanMassChangeRate) < 0.05;
      recommendations.push({
        type: 'suggestion',
        title: 'Muscle Gain Below Expected',
        message: flat
          ? 'Your lean mass is roughly flat. Consider increasing protein intake, training volume, or caloric surplus.'
          : `You're gaining ${formatMassRate(trend.leanMassChangeRate, unit, 1)} of muscle per month. Consider increasing protein intake, training volume, or caloric surplus.`,
        priority: 3,
        evidence: leanEvidence,
      });
    }

    if (effectiveGoal === 'cut' && trend.leanMassChangeRate < -0.2) {
      recommendations.push({
        type: 'warning',
        title: 'Muscle Loss Detected',
        message: `You're losing ${formatMassRate(Math.abs(trend.leanMassChangeRate), unit)} of muscle per month. Consider reducing your deficit, increasing protein to 2.3-3.1g/kg, or increasing training volume.`,
        priority: 5,
        evidence: leanEvidence,
      });
    }

    if (trend.trend === 'recomping') {
      recommendations.push({
        type: 'achievement',
        title: 'Successful Recomp',
        message: `Great progress! You're simultaneously gaining muscle and losing fat. Keep up the consistent training and nutrition.`,
        priority: 2,
        evidence: `${leanEvidence}, fat ${trend.fatMassChangeRate >= 0 ? '+' : '−'}${formatMassRate(Math.abs(trend.fatMassChangeRate), unit, 1)}/mo`,
      });
    }
  }

  // Sort by priority (higher = show first)
  recommendations.sort((a, b) => b.priority - a.priority);

  return recommendations;
}

// ============ TARGET CALCULATIONS ============

/**
 * Calculate body composition targets based on current status and goal
 */
export function calculateBodyCompTargets(
  currentScan: DexaScan,
  heightCm: number,
  goal: Goal,
  experience: Experience
): BodyCompTargets {
  const currentFFMI = calculateFFMI(currentScan.leanMassKg, heightCm);
  const naturalLimit = getNaturalFFMILimit(experience);
  
  let targetBodyFat: number;
  let targetFfmi: number;
  let direction: BodyCompTargets['direction'];
  
  switch (goal) {
    case 'bulk':
      // Target: Gain muscle while keeping body fat reasonable
      targetBodyFat = Math.min(currentScan.bodyFatPercent + 3, 18); // Don't go above 18%
      targetFfmi = Math.min(currentFFMI.normalizedFfmi + 1, naturalLimit);
      direction = 'bulk';
      break;
      
    case 'cut':
      // Target: Lose fat while preserving muscle
      targetBodyFat = Math.max(currentScan.bodyFatPercent - 5, 10); // Don't go below 10%
      targetFfmi = currentFFMI.normalizedFfmi; // Maintain FFMI
      direction = 'cut';
      break;
      
    case 'maintenance':
    default:
      // Target: Maintain current composition
      targetBodyFat = currentScan.bodyFatPercent;
      targetFfmi = currentFFMI.normalizedFfmi;
      direction = 'maintain';
      break;
  }
  
  // Calculate estimated weeks based on typical rates
  let estimatedWeeks: number;
  let calorieAdjustment: number;
  
  if (direction === 'bulk') {
    // Expect ~0.25 FFMI per month for intermediates
    const ffmiToGain = targetFfmi - currentFFMI.normalizedFfmi;
    estimatedWeeks = Math.ceil((ffmiToGain / 0.25) * 4);
    calorieAdjustment = 300; // 300 cal surplus
  } else if (direction === 'cut') {
    // Expect ~0.5% body fat loss per week at moderate deficit
    const bfToLose = currentScan.bodyFatPercent - targetBodyFat;
    estimatedWeeks = Math.ceil(bfToLose / 0.5);
    calorieAdjustment = -500; // 500 cal deficit
  } else {
    estimatedWeeks = 0;
    calorieAdjustment = 0;
  }
  
  return {
    targetBodyFat: Math.round(targetBodyFat * 10) / 10,
    targetFfmi: Math.round(targetFfmi * 10) / 10,
    estimatedWeeks: Math.max(estimatedWeeks, 0),
    calorieAdjustment,
    direction,
  };
}

// ============ UTILITY FUNCTIONS ============

/**
 * Calculate lean mass from total weight and body fat percentage
 */
export function calculateLeanMass(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Calculate fat mass from total weight and body fat percentage
 */
export function calculateFatMass(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (bodyFatPercent / 100);
}

/**
 * Format FFMI for display
 */
export function formatFFMI(ffmi: number): string {
  return ffmi.toFixed(1);
}

/**
 * Get color for FFMI classification
 */
export function getFFMIColor(classification: FFMIClassification): string {
  switch (classification) {
    case 'below_average':
      return 'text-surface-400';
    case 'average':
      return 'text-primary-400';
    case 'above_average':
      return 'text-primary-300';
    case 'excellent':
      return 'text-success-400';
    case 'superior':
      return 'text-accent-400';
    case 'suspicious':
      return 'text-warning-400';
  }
}

/**
 * Get trend icon/indicator
 */
export function getTrendIndicator(rate: number): { icon: string; color: string } {
  if (rate > 0.1) {
    return { icon: '↑', color: 'text-success-400' };
  } else if (rate < -0.1) {
    return { icon: '↓', color: 'text-danger-400' };
  }
  return { icon: '→', color: 'text-surface-400' };
}

