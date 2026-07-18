/**
 * projection-p-ratio
 *
 * The ONE place a personalized p-ratio for the anchored trend's projection
 * segment is computed. Both trend call sites (Body tab hook + Home card
 * server action) go through here, so they can never blend differently.
 *
 * Pipeline:
 *   scan history → computeScanPairPRatios (noise-gated realized p-ratios)
 *     → selectUsablePRatioPairs (direction-matched, same selector Phase 1's
 *       TDEE wiring uses)
 *     → blend with the heuristic model (calculatePRatio for deficits; the
 *       gain model's partitioning for surpluses — calculatePRatio's factor
 *       directions are loss-oriented, e.g. high protein RAISES its p-ratio
 *       because more of a LOSS being fat is good, which would read backwards
 *       as "more of a gain is fat")
 *     → clamp to PROJECTION_PRATIO_CLAMP
 *     → convert to bodyCompAnchor's convention (lean fraction of Δweight).
 *
 * Returns null whenever anything needed is missing — callers then omit
 * `projectionPRatio` entirely and the anchor's 0.5 default applies, byte-
 * identical to pre-personalization behavior.
 *
 * Pure functions only: NO database calls. No raw Date math — scan recency
 * never enters this computation; pairs stay in the chronological order the
 * selector preserves.
 */

import {
  computeScanPairPRatios,
  selectUsablePRatioPairs,
  type CompositionObservation,
  type PhaseDirection,
} from '@/services/compositionSpace';
import {
  calculatePRatio,
  predictWeightGainComposition,
  type PRatioInputs,
} from '@/lib/body-composition/p-ratio';

/**
 * Hard bounds on the blended fat-fraction before it may steer the trend
 * projection. A single weird scan pair (glycogen swing, different machine)
 * can imply a p-ratio like 1.4; the projection must never chase it.
 */
export const PROJECTION_PRATIO_CLAMP: readonly [number, number] = [0.3, 0.9];

/**
 * Trust in personal history scales with how many usable pairs exist.
 * Mirrors calculatePRatio's personal-history weighting (35/55/75%) — keep in
 * sync with lib/body-composition/p-ratio.ts step 9.
 */
function personalTrustWeight(pairCount: number): number {
  return pairCount >= 3 ? 0.75 : pairCount === 2 ? 0.55 : 0.35;
}

/** Profile slice the personalization needs; every field may be absent. */
export interface ProjectionPRatioProfile {
  /** Current phase — decides the direction pairs must match. */
  goal: 'bulk' | 'cut' | 'maintenance' | 'recomp' | null;
  sex: 'male' | 'female' | null;
  age: number | null;
  trainingAge: 'beginner' | 'intermediate' | 'advanced' | null;
  isEnhanced: boolean;
}

export interface ProjectionPRatioResult {
  /**
   * Lean fraction of each post-scan weight delta — bodyCompAnchor's
   * `projectionPRatio` convention. Equals 1 − fatFraction.
   */
  leanRatio: number;
  /** Blended share of a weight change that is fat, after the clamp. */
  fatFraction: number;
  direction: PhaseDirection;
  /** How many scan pairs survived selection and fed the blend. */
  pairsUsed: number;
}

/**
 * Personalized lean/fat split for the anchored trend's projection segment,
 * or null when personalization must not engage (no direction, no height,
 * fewer than 2 scans, or no usable direction-matched pairs).
 */
export function computeProjectionPRatio(input: {
  scans: CompositionObservation[];
  heightCm: number | null | undefined;
  profile: ProjectionPRatioProfile | null;
}): ProjectionPRatioResult | null {
  const { scans, heightCm, profile } = input;
  if (!profile || !heightCm || heightCm <= 0 || scans.length < 2) return null;

  // Maintenance/recomp has no planned weight direction, so there is no
  // "matching" history to learn from — the neutral 0.5 default stands.
  const direction: PhaseDirection | null =
    profile.goal === 'bulk' ? 'surplus' : profile.goal === 'cut' ? 'deficit' : null;
  if (!direction) return null;

  const usable = selectUsablePRatioPairs(
    computeScanPairPRatios(scans, heightCm),
    direction
  );
  if (usable.length === 0) return null;

  // Anchor state = the newest scan (string date compare — no Date math).
  const latest = [...scans].sort((a, b) => a.date.localeCompare(b.date))[scans.length - 1];
  const weightKg =
    latest.weightKg != null && latest.weightKg > 0
      ? latest.weightKg
      : latest.leanMassKg + latest.fatMassKg;
  if (!(weightKg > 0) || !(latest.leanMassKg > 0)) return null;
  const bodyFatPercent =
    latest.bodyFatPercent != null && latest.bodyFatPercent > 0
      ? latest.bodyFatPercent
      : (latest.fatMassKg / weightKg) * 100;

  // Heuristic inputs from profile + latest scan. Diet/training aggregates
  // aren't available at the trend call sites, so they take the SAME neutral
  // fallbacks the TDEE dashboard documents (150 g protein, 10 sets) and a
  // zero energy balance (no deficit-size adjustment). With history present
  // the blend leans 35–75% on measured pairs, which bounds how much these
  // fallbacks can matter; with no history this function never runs.
  const heuristicInputs: PRatioInputs = {
    avgDailyProteinGrams: 150,
    avgDailyProteinPerKgBW: 150 / weightKg,
    avgWeeklyTrainingSets: 10,
    avgDailyDeficitCals: 0,
    energyBalancePercent: 0,
    currentBodyFatPercent: bodyFatPercent,
    currentLeanMassKg: latest.leanMassKg,
    trainingAge: profile.trainingAge ?? 'intermediate',
    isEnhanced: profile.isEnhanced,
    biologicalSex: profile.sex ?? 'male',
    chronologicalAge: profile.age ?? undefined,
  };

  const history = usable.map((pair) => pair.fatFraction as number);

  let fatFraction: number;
  if (direction === 'deficit') {
    // calculatePRatio already blends personal history internally (35/55/75%).
    fatFraction = calculatePRatio({
      ...heuristicInputs,
      personalPRatioHistory: history,
    }).finalPRatio;
  } else {
    // Surplus: heuristic partitioning from the gain model (pRatioUsed is its
    // muscle-gain ratio; the +1 kg horizon is irrelevant — the ratio depends
    // only on the inputs), blended with the personal average under the same
    // trust weights calculatePRatio uses.
    const heuristicFat =
      1 -
      predictWeightGainComposition(
        weightKg,
        weightKg + 1,
        bodyFatPercent,
        heightCm,
        heuristicInputs
      ).pRatioUsed;
    const personalAvg = history.reduce((a, b) => a + b, 0) / history.length;
    const trust = personalTrustWeight(history.length);
    fatFraction = heuristicFat * (1 - trust) + personalAvg * trust;
  }

  const [lo, hi] = PROJECTION_PRATIO_CLAMP;
  fatFraction = Math.min(hi, Math.max(lo, fatFraction));

  return {
    leanRatio: 1 - fatFraction,
    fatFraction,
    direction,
    pairsUsed: usable.length,
  };
}
