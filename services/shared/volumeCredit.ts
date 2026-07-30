/**
 * Canonical set-credit math — THE single source of truth.
 *
 * Every surface that turns an exercise's muscle tags + performed working sets
 * into per-muscle or per-group volume credit must go through this module
 * (directly or through a delegating wrapper), exactly like the canonical e1RM
 * estimator in services/shared/e1rm.ts. History: four parallel crediting
 * implementations (the shared accumulator, volumeTracker.calculateWeeklyVolume,
 * useWeeklyVolume's inline loop, computeSecondaryCreditRatio) plus an uncapped
 * group rollup produced 6 group-level effective sets from 4 performed sets
 * (Iso-Lateral Incline Press) and a Shoulders header that outran its own
 * breakdown panel — see the volume-set-credit bug report (2026-07) and
 * docs/MUSCLE_ATTRIBUTION_AUDIT.md.
 *
 * THE MODEL
 *  - An exercise's PRIMARY tag distributes 1.0 credit per working set across
 *    the standard muscles it resolves to (legacy coarse tags split per
 *    LEGACY_PRIMARY_VOLUME_WEIGHTS; precise tags get the full 1.0).
 *  - Each SECONDARY tag adds SECONDARY_MUSCLE_CREDIT (0.5) per working set,
 *    split across the standards it resolves to, suppressed where the primary
 *    already credits that muscle.
 *  - STANDARD-MUSCLE (per-head) counters are independent and MAY overlap:
 *    one incline-press set legitimately feeds chest_upper 1.0 AND chest_lower
 *    0.5. That is correct for per-head programming decisions.
 *  - GROUP (coarse) volume is capped: per set, the total credit any single
 *    muscle GROUP receives is min(1.0, Σ within-group member credit)
 *    (GROUP_SET_CREDIT_CAP). A 4-set exercise can never credit one group more
 *    than 4 sets. RIR effectiveness weighting applies ON TOP of the cap:
 *    effective group credit per set = cap × weight(rir), never
 *    min(1, credit × weight) or credit × weight uncapped.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CAP SCOPE — WITHIN-GROUP ONLY. DO NOT "GENERALIZE" THIS.
 *
 * The 1.0 cap applies to the credit ONE group receives from one set. A set may
 * still credit MULTIPLE groups for more than 1.0 in total (bench: chest 1.0 +
 * shoulders 0.5 + triceps 0.5). That cross-group indirect inflow is
 * intentional: the authored research bands in services/volumeBands were
 * calibrated "total-inclusive" — their v2 conversion shifted MEV/MRV upward by
 * the measured cross-group inflow (e.g. shoulders {8,22}→{12,26} for press
 * front-delt spillover). Promoting this cap to a global per-set cap across all
 * groups would silently break that calibration and bias every fullness bar
 * low. If you believe you need a global cap, re-run the band calibration and
 * change the bands in the same reviewed pass.
 *
 * GROUP ZONES STAY AUTHORED (decision 2026-07-30): the authored bands were
 * calibrated against a total-inclusive group count; now that group volume is
 * computed with the per-group cap, the numerator IS a total-inclusive count,
 * so numerator and denominator are on the same footing. Deriving a group band
 * from sub-zones would inflate the denominator by the same overlap mechanism
 * the cap removed from the numerator (sub-muscle zones legitimately overlap
 * because one set feeds multiple heads). Reachability-scaled denominators are
 * rejected: a denominator that moves when the user edits their exercise
 * library makes week-over-week bars non-comparable and is user-gameable.
 * A typo-guard (group band ≥ each child band, volumeGroupCap.test.ts) checks
 * authoring without coupling group bands to child bands.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Pure data + pure functions. No React, no Supabase, no side effects.
 */

import {
  isLegacyMuscle,
  normalizeMuscleToken,
  resolveMuscleToStandard,
  type StandardMuscleGroup,
} from '@/types/schema';
import { STANDARD_TO_COARSE, type CoarseMuscle } from '@/services/volumeBands';

// ============================================
// CONSTANTS
// ============================================

/** Fractional set credit given to a secondary (indirect) muscle per working set. */
export const SECONDARY_MUSCLE_CREDIT = 0.5;

/**
 * Per-set ceiling on the credit any SINGLE muscle group receives from one
 * working set (within-group only — see the module header before touching).
 */
export const GROUP_SET_CREDIT_CAP = 1.0;

/**
 * How a LEGACY coarse primary muscle distributes its direct-set credit across
 * standard muscle groups. A legacy tag can't tell us which head the exercise
 * emphasizes (a flat and an incline press are both just 'chest'), so credit is
 * split across the plausible heads instead of the old winner-takes-all
 * behavior (which sent ALL 'chest' volume to chest_upper, ALL 'shoulders'
 * volume to front_delts, and ALL 'back' volume to lats — leaving the sibling
 * muscles falsely reported as "not worked").
 *
 * 'glutes' and 'abs' intentionally do NOT split: crediting glute_med/obliques
 * from every glute/ab exercise would over-credit muscles that usually need
 * direct work, and their MEV defaults already assume indirect fill. 'traps'
 * and 'calves' follow the same rule — a coarse tag stays on the coarse
 * standard muscle and never leaks into upper_traps/mid_lower_traps or
 * gastrocnemius/soleus (only fine-grained tagging feeds those).
 */
const LEGACY_PRIMARY_VOLUME_WEIGHTS: Record<string, Partial<Record<StandardMuscleGroup, number>>> = {
  chest: { chest_upper: 0.5, chest_lower: 0.5 },
  back: { lats: 0.5, upper_back: 0.5 },
  shoulders: { front_delts: 1 / 3, lateral_delts: 1 / 3, rear_delts: 1 / 3 },
  glutes: { glutes: 1 },
  abs: { abs: 1 },
  traps: { traps: 1 },
  calves: { calves: 1 },
};

// ============================================
// PER-SET STANDARD-MUSCLE CREDIT
// ============================================

/** One standard muscle's share of an exercise's primary (direct) credit. */
export interface PrimaryMuscleCredit {
  muscle: StandardMuscleGroup;
  /** Fraction of each working set credited to this muscle (weights sum to 1). */
  weight: number;
}

/**
 * Resolve an exercise's primary muscle (any format: detailed, standard, or
 * legacy) into weighted standard-muscle credits. Non-legacy tokens resolve to
 * a single muscle at full weight; legacy coarse tokens split per
 * LEGACY_PRIMARY_VOLUME_WEIGHTS. Returns [] for unrecognized tokens.
 */
export function resolvePrimaryMuscleCredits(muscle: string): PrimaryMuscleCredit[] {
  const token = normalizeMuscleToken(muscle);

  if (isLegacyMuscle(token)) {
    const weights = LEGACY_PRIMARY_VOLUME_WEIGHTS[token];
    if (weights) {
      return (Object.entries(weights) as Array<[StandardMuscleGroup, number]>).map(
        ([m, weight]) => ({ muscle: m, weight })
      );
    }
    // Legacy tokens that map 1:1 ('biceps', 'quads', ...)
    const standards = resolveMuscleToStandard(token);
    return standards.length > 0 ? [{ muscle: standards[0], weight: 1 }] : [];
  }

  const standards = resolveMuscleToStandard(token);
  return standards.length > 0 ? [{ muscle: standards[0], weight: 1 }] : [];
}

/** One standard muscle's per-set credit from a tag pair, with its provenance. */
export interface PerSetCredit {
  muscle: StandardMuscleGroup;
  /** Credit per working set (primary share, or secondary split share). */
  credit: number;
  /** true = from the primary tag (direct), false = secondary (indirect). */
  isDirect: boolean;
}

/**
 * Per-set standard-muscle credit for a tag pair, exactly as every counter
 * applies it: weighted primary split, 0.5 secondary split across the standards
 * a secondary token covers, primary-overlap suppressed. Unrounded. One entry
 * per standard muscle per provenance (a muscle fed by two secondary tokens is
 * merged; a muscle fed by primary AND secondary cannot occur — suppressed).
 */
export function perSetCredits(primary: string, secondaries: string[]): PerSetCredit[] {
  const out: PerSetCredit[] = [];
  const primaryCredits = resolvePrimaryMuscleCredits(primary);
  const primarySet = new Set(primaryCredits.map((c) => c.muscle));
  for (const { muscle, weight } of primaryCredits) {
    out.push({ muscle, credit: weight, isDirect: true });
  }
  const indirect = new Map<StandardMuscleGroup, number>();
  for (const secondary of secondaries) {
    const standards = resolveMuscleToStandard(secondary);
    if (standards.length === 0) continue;
    const per = SECONDARY_MUSCLE_CREDIT / standards.length;
    for (const std of standards) {
      if (primarySet.has(std)) continue;
      indirect.set(std, (indirect.get(std) ?? 0) + per);
    }
  }
  indirect.forEach((credit, muscle) => out.push({ muscle, credit, isDirect: false }));
  return out;
}

/**
 * Per-set standard-muscle credit as a flat record (the attribution-audit
 * shape). Same math as {@link perSetCredits}, provenance folded together.
 */
export function perSetStandardCredit(
  primary: string,
  secondaries: string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { muscle, credit } of perSetCredits(primary, secondaries)) {
    out[muscle] = (out[muscle] ?? 0) + credit;
  }
  return out;
}

// ============================================
// PER-SET GROUP CREDIT (capped)
// ============================================

/** One coarse group's per-set credit from a tag pair, cap applied. */
export interface PerSetGroupCredit {
  group: CoarseMuscle;
  /** Capped credit per working set: min(GROUP_SET_CREDIT_CAP, uncapped). */
  credit: number;
  /** Σ within-group member credit before the cap (diagnostics/ratio metrics). */
  uncapped: number;
}

/**
 * Per-set GROUP credit for a tag pair: standard-muscle credits rolled up
 * through STANDARD_TO_COARSE, capped at GROUP_SET_CREDIT_CAP per group.
 * Standard muscles that resolve to no coarse group (unrecognized tokens)
 * contribute nothing. WITHIN-GROUP cap only — see the module header.
 */
export function perSetGroupCredits(primary: string, secondaries: string[]): PerSetGroupCredit[] {
  const uncapped = new Map<CoarseMuscle, number>();
  for (const { muscle, credit } of perSetCredits(primary, secondaries)) {
    const group = STANDARD_TO_COARSE[muscle];
    if (!group) continue;
    uncapped.set(group, (uncapped.get(group) ?? 0) + credit);
  }
  const out: PerSetGroupCredit[] = [];
  uncapped.forEach((sum, group) =>
    out.push({ group, credit: Math.min(GROUP_SET_CREDIT_CAP, sum), uncapped: sum })
  );
  return out;
}

/**
 * The group-cap scale factor for one exercise block's contribution to one
 * group, expressed against ALREADY-ACCUMULATED uncapped credit:
 *
 *   f = min(1, performedSets / uncappedGroupSets)
 *
 * Every set of a block carries the same tags, so per-set capping
 * (min(1, c) per set) and per-block scaling (uncapped × f) are exactly
 * equivalent: uncapped = c × performed ⇒ uncapped × f = min(1, c) × performed.
 * Because RIR weighting is a per-set multiplier on top of the same c,
 * scaling an uncapped RIR-weighted sum by f likewise yields
 * min(1, c) × Σweights — i.e. weighting ON TOP of the cap, as specified.
 *
 * Guard: performedSets ≤ 0 (pre-migration cached shapes that never carried a
 * performed count) returns 1 — no information to cap against beats zeroing
 * real credit.
 */
export function groupCapScale(performedSets: number, uncappedGroupSets: number): number {
  if (!Number.isFinite(performedSets) || performedSets <= 0) return 1;
  if (uncappedGroupSets <= performedSets) return 1;
  return performedSets / uncappedGroupSets;
}
