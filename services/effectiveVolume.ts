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
 * Conservative fallback weight for sets whose RIR is unknown (legacy sets
 * logged before structured feedback, imports, or malformed data). Counting
 * them fully is the conservative choice for volume tracking: it never hides
 * volume a user actually performed.
 */
export const UNKNOWN_RIR_WEIGHT = 1.0;

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
 * No silent failures: a null/unknown/out-of-range RIR logs a console warning
 * and is weighted {@link UNKNOWN_RIR_WEIGHT} (1.0, conservative) — the set is
 * never dropped.
 *
 * @param rir - reported RIR (0-4), or null/undefined when the set has none
 * @param context - optional label (exercise/surface) to make warnings traceable
 */
export function effectiveVolumeWeight(
  rir: number | null | undefined,
  context?: string
): number {
  if (rir == null || !Number.isFinite(rir)) {
    console.warn(
      `[effectiveVolume] Set has null/unknown RIR${context ? ` (${context})` : ''}; weighting 1.0 (conservative).`
    );
    return UNKNOWN_RIR_WEIGHT;
  }
  const rounded = Math.round(rir);
  if (rounded < 0 || rounded > 4) {
    console.warn(
      `[effectiveVolume] Set has out-of-range RIR ${rir}${context ? ` (${context})` : ''}; weighting 1.0 (conservative).`
    );
    return UNKNOWN_RIR_WEIGHT;
  }
  return EFFECTIVE_VOLUME_WEIGHTS[rounded as RepsInTank];
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
  return rirs.reduce<number>((sum, rir) => sum + effectiveVolumeWeight(rir, context), 0);
}

/** Display helper: one-decimal effective volume (e.g. "14.2"). */
export function formatEffectiveVolume(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
