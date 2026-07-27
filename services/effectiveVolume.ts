/**
 * Effective Volume — RIR-weighted set counting.
 *
 * SINGLE SOURCE OF TRUTH for stimulus-effectiveness weights. Every surface
 * that weights sets by proximity to failure (volume cards, weekly summaries,
 * the adaptive-volume hypertrophy targeting loop) must import from this file;
 * no other module may define its own weight table or inline magic numbers.
 *
 * Scope guard: effective volume is a STIMULUS measure only. The readiness /
 * fatigue models (fatigueEngine, fatigueBudgetEngine, muscleRecovery) continue
 * to consume RAW set counts + load — mechanical work drives fatigue regardless
 * of stimulus — and must NOT import these weights for their accumulation math.
 */

import type { RepsInTank, SetFeedback } from '@/types/schema';

/**
 * Stimulus-effectiveness weight per reported RIR.
 *
 * Rationale: hypertrophy stimulus is dominated by the last ~5 reps before
 * failure ("stimulating reps"), so per-set effectiveness drops off sharply
 * beyond ~2 RIR. Sets at 0-2 RIR count fully; a set left at 3 RIR retains
 * partial stimulus; a 4+ RIR "cruise" set is mostly non-stimulative. The
 * weights at 3-4 RIR are deliberately NONZERO because self-reported RIR
 * error is typically ±1-2 reps — a set logged "4+" may truly have been a
 * 2-3 RIR set, so discounting it to zero would throw away real stimulus.
 */
export const EFFECTIVE_VOLUME_WEIGHTS: Readonly<Record<RepsInTank, number>> = {
  0: 1.0,
  1: 1.0,
  2: 1.0,
  3: 0.6,
  4: 0.25,
};

/**
 * Sets whose RIR is unknown (legacy sets, imports, malformed data, or a set
 * logged without touching the effort chips) are UNRATED: they are EXCLUDED
 * from the effective sum and surfaced as a count instead.
 *
 * History: unknown used to weigh 1.0 ("conservative — never hides volume").
 * That was a silent failure by this module's own rule: missing data received
 * MAXIMUM credit, inflating effective volume — and combined with the 1.0
 * plateau at RIR ≤ 2 it made eff ≡ sets on every surface, so the metric
 * could not answer the question it exists for. Excluded-and-surfaced is the
 * honest treatment: the raw set count still shows everything performed; the
 * effective number only claims what was actually rated.
 */
export const UNRATED_EXCLUDED = null;

/**
 * Extract the reported RIR from a set's feedback payload.
 *
 * Handles both the in-memory shape (`feedback.repsInTank`) and raw DB rows
 * where the `feedback` JSONB may arrive as a JSON string. Returns null when
 * the set carries no explicit RIR report. Deliberately does NOT fall back to
 * deriving RIR from the stored `rpe` column: `rpe` defaults to 7 at the DB
 * level, so legacy no-feedback sets would silently read as RIR 3 and be
 * down-weighted — the opposite of the conservative null → full-weight rule.
 */
export function rirFromFeedback(feedback: unknown): number | null {
  if (feedback == null) return null;
  let parsed: unknown = feedback;
  if (typeof feedback === 'string') {
    try {
      parsed = JSON.parse(feedback);
    } catch {
      return null;
    }
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const rir = (parsed as Partial<SetFeedback>).repsInTank;
  return typeof rir === 'number' && Number.isFinite(rir) ? rir : null;
}

/**
 * Effectiveness weight for a single set given its reported RIR.
 *
 * Returns null for an UNRATED set (no RIR, or out-of-range garbage): the set
 * is excluded from the effective sum and counted in
 * {@link summarizeEffectiveVolume}'s `unratedSets` — the surfacing IS the
 * no-silent-failures mechanism (a per-set console warning was noise; a
 * maximum-credit fallback was worse: missing data inflating the metric).
 * Out-of-range values still warn — they are malformed data, not merely
 * missing.
 *
 * @param rir - reported RIR (0-4), or null/undefined when the set has none
 * @param context - optional label (exercise/surface) to make warnings traceable
 */
export function effectiveVolumeWeight(
  rir: number | null | undefined,
  context?: string
): number | null {
  if (rir == null || !Number.isFinite(rir)) {
    return UNRATED_EXCLUDED;
  }
  const rounded = Math.round(rir);
  if (rounded < 0 || rounded > 4) {
    console.warn(
      `[effectiveVolume] Set has out-of-range RIR ${rir}${context ? ` (${context})` : ''}; treating as unrated (excluded).`
    );
    return UNRATED_EXCLUDED;
  }
  return EFFECTIVE_VOLUME_WEIGHTS[rounded as RepsInTank];
}

/** Effective volume with its rated/unrated composition — the display shape. */
export interface EffectiveVolumeSummary {
  /** Σ weight over RATED sets only. */
  effectiveSets: number;
  /** Sets that carried a usable RIR. */
  ratedSets: number;
  /** Sets excluded for missing/garbage RIR — surface this next to the number. */
  unratedSets: number;
}

/**
 * Effective volume plus the rated/unrated split. Any surface that shows
 * `effectiveSets` alongside a raw count MUST also surface `unratedSets` when
 * it is non-zero — an effective number silently computed over a subset of
 * the sets is the exact inflation bug this module just removed, inverted.
 */
export function summarizeEffectiveVolume(
  rirs: Array<number | null | undefined>,
  context?: string
): EffectiveVolumeSummary {
  let effectiveSets = 0;
  let ratedSets = 0;
  let unratedSets = 0;
  for (const rir of rirs) {
    const w = effectiveVolumeWeight(rir, context);
    if (w === null) unratedSets += 1;
    else {
      effectiveSets += w;
      ratedSets += 1;
    }
  }
  return { effectiveSets, ratedSets, unratedSets };
}

/**
 * Sum of effectiveness weights over a collection of already-filtered counted
 * sets: effectiveSets = Σ weight(set.rir).
 *
 * Callers are responsible for excluding warm-ups (and any other non-counted
 * sets) BEFORE calling, exactly as they already do for raw set counting — the
 * warm-up exclusion rule is unchanged by the effective-volume model.
 */
export function sumEffectiveVolume(
  rirs: Array<number | null | undefined>,
  context?: string
): number {
  return summarizeEffectiveVolume(rirs, context).effectiveSets;
}

/** Display helper: one-decimal effective volume (e.g. "14.2"). */
export function formatEffectiveVolume(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
