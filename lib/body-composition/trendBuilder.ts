/**
 * trendBuilder
 *
 * ONE shared pipeline from raw DB rows to the personalized DEXA-anchored
 * trend. Both consumers — the Body tab (hooks/useBodyCompTrend, client) and
 * the Home card (lib/actions/dashboard, server) — pass their rows through
 * this builder, so given identical underlying data they produce identical
 * trend output by construction: same unit conversion, same waist-EWMA
 * shaping, same personalized projection p-ratio, same anchor options.
 *
 * Pure functions only: NO database calls. Row shapes mirror the two call
 * sites' selects exactly.
 */

import {
  buildAnchoredBodyCompTrend,
  type AnchoredTrendPoint,
  type BuildAnchoredTrendOptions,
} from '@/services/bodyCompAnchor';
import { computeWaistTrend } from '@/services/waistTrend';
import type { CompositionObservation } from '@/services/compositionSpace';
import {
  computeProjectionPRatio,
  type ProjectionPRatioResult,
} from '@/lib/body-composition/projection-p-ratio';
import { inputWeightToKg, cmToIn } from '@/lib/utils';

export interface TrendWeightRow {
  /** YYYY-MM-DD */
  logged_at: string;
  weight: number;
  unit: 'lb' | 'kg' | null;
}

export interface TrendDexaRow {
  /** YYYY-MM-DD */
  scan_date: string;
  body_fat_percent: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
  weight_kg: number | null;
  bone_mass_kg: number | null;
}

export interface TrendWaistRow {
  /** YYYY-MM-DD */
  logged_at: string;
  /** Waist circumference in cm (the body_measurements storage unit). */
  waist: number | null;
}

/** users + user_volume_profiles slice for the personalized projection. */
export interface TrendProfileRows {
  user: {
    height_cm: number | string | null;
    goal: string | null;
    sex: string | null;
    age: number | null;
  } | null;
  volumeProfile: {
    training_age: string | null;
    is_enhanced: boolean | null;
  } | null;
}

export interface PersonalizedTrendResult {
  trend: AnchoredTrendPoint[];
  /**
   * The personalization actually applied to the post-latest-scan projection,
   * or null when it did not engage (missing profile pieces, no usable
   * direction-matched scan pairs) — in which case the anchor ran with its
   * stock 0.5 default, byte-identical to pre-personalization output.
   */
  projection: ProjectionPRatioResult | null;
}

function parseHeightCm(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** DB training_age → p-ratio model vocabulary ('novice' → 'beginner'). */
function mapTrainingAge(
  value: string | null | undefined
): 'beginner' | 'intermediate' | 'advanced' | null {
  if (value === 'novice' || value === 'beginner') return 'beginner';
  if (value === 'intermediate' || value === 'advanced') return value;
  return null;
}

function mapGoal(
  value: string | null | undefined
): 'bulk' | 'cut' | 'maintenance' | 'recomp' | null {
  return value === 'bulk' || value === 'cut' || value === 'maintenance' || value === 'recomp'
    ? value
    : null;
}

/**
 * Build the anchored body-composition trend with every learned signal both
 * surfaces share: waist-EWMA interior shaping and the personalized
 * projection p-ratio.
 */
export function buildPersonalizedBodyCompTrend(input: {
  weights: TrendWeightRow[];
  scans: TrendDexaRow[];
  waist: TrendWaistRow[];
  profile: TrendProfileRows | null;
}): PersonalizedTrendResult {
  const { weights, scans, waist, profile } = input;

  const weightPoints = weights.map((row) => ({
    date: row.logged_at,
    weightKg: inputWeightToKg(Number(row.weight), row.unit ?? 'lb'),
  }));

  const anchors = scans.map((scan) => ({
    date: scan.scan_date,
    bodyFatPercent: Number(scan.body_fat_percent),
    leanMassKg: Number(scan.lean_mass_kg),
    fatMassKg: Number(scan.fat_mass_kg),
    // The recorded total (includes bone) anchors bodyweight deltas.
    weightKg: scan.weight_kg != null ? Number(scan.weight_kg) : undefined,
    // BMC feeds the FFMI series (FFM = lean + bone when logged).
    boneMassKg: scan.bone_mass_kg != null ? Number(scan.bone_mass_kg) : null,
  }));

  // Waist tape entries (cm) shape the estimated BF% interior between scans.
  // Only valid (non-outlier) trend points bend the interior.
  const waistTrend = computeWaistTrend(
    waist
      .filter((row) => row.waist != null)
      .map((row) => ({ date: row.logged_at, waistIn: cmToIn(Number(row.waist)) }))
  )
    .filter((point) => !point.isOutlier)
    .map((point) => ({ date: point.date, trendIn: point.trendIn }));

  const observations: CompositionObservation[] = scans.map((scan) => ({
    date: scan.scan_date,
    leanMassKg: Number(scan.lean_mass_kg),
    fatMassKg: Number(scan.fat_mass_kg),
    weightKg: scan.weight_kg != null ? Number(scan.weight_kg) : null,
    boneMassKg: scan.bone_mass_kg != null ? Number(scan.bone_mass_kg) : null,
    bodyFatPercent: scan.body_fat_percent != null ? Number(scan.body_fat_percent) : null,
  }));

  const projection = computeProjectionPRatio({
    scans: observations,
    heightCm: parseHeightCm(profile?.user?.height_cm),
    profile: profile?.user
      ? {
          goal: mapGoal(profile.user.goal),
          sex:
            profile.user.sex === 'male' || profile.user.sex === 'female'
              ? profile.user.sex
              : null,
          age: profile.user.age != null ? Number(profile.user.age) : null,
          trainingAge: mapTrainingAge(profile.volumeProfile?.training_age),
          isEnhanced: profile.volumeProfile?.is_enhanced === true,
        }
      : null,
  });

  // Omit projectionPRatio entirely when personalization didn't engage, so
  // the anchor's no-data path is byte-identical to pre-change behavior.
  const options: BuildAnchoredTrendOptions = {
    waistTrend,
    ...(projection ? { projectionPRatio: projection.leanRatio } : {}),
  };

  return {
    trend: buildAnchoredBodyCompTrend(weightPoints, anchors, options),
    projection,
  };
}
