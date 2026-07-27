/**
 * rep_total progression policy (pulled forward from Phase 5).
 *
 * For exercises whose rep boundary drifts (high-rep work where "a rep" is not
 * a crisp unit — calves, abs, burnout-style ranges), e1RM math is fiction:
 * most sets sit beyond the canonical estimator's 15-effective-rep domain.
 * These exercises progress on REP TOTALS instead:
 *
 *   - FIXED load for the whole session (held verbatim, never re-rounded);
 *   - progress target = beat last session's rep TOTAL at that load;
 *   - add the smallest native increment only when EVERY working set cleared
 *     the range floor at target effort last session;
 *   - otherwise repeat the load and chase reps.
 *
 * No e1RM is computed, displayed, or ingested for calibration on this path.
 *
 * Which exercises route here: an explicit `exercises.progression_model`
 * ('rep_total' | 'e1rm') always wins; NULL auto-classifies from history —
 * majority-inestimable recent sets → rep_total. "Inestimable" for
 * classification means ABOVE THE CANONICAL CAP (12 effective reps): capped
 * estimates are floors computed at the cap (w × 36/25 regardless of the
 * actual count), so an exercise living above it has an anchor that cannot
 * move with rep progress — frozen. Beyond-domain sets (> 15 eff) are the
 * extreme case of the same family.
 *
 * Pure functions — no DB calls or side effects.
 */

import type { PrevSessionSet } from '@/services/setRecommender';

export type ProgressionModel = 'e1rm' | 'rep_total';
export type RepBoundary = 'crisp' | 'drifting';

/**
 * Resolve an exercise's progression model: explicit column value wins; NULL
 * auto-classifies from the recent history's estimability counts.
 */
export function resolveProgressionModel(
  explicit: ProgressionModel | null | undefined,
  estimableSetCount: number,
  inestimableSetCount: number
): ProgressionModel {
  if (explicit === 'rep_total' || explicit === 'e1rm') return explicit;
  return inestimableSetCount > estimableSetCount ? 'rep_total' : 'e1rm';
}

/** Effort tolerance: a set "at target effort" may be up to this much easier. */
const EFFORT_TOLERANCE_RIR = 1;

export interface RepTotalSessionStart {
  /** Fixed load for the session (kg) — held VERBATIM from history on a repeat. */
  weightKg: number;
  /** Per-set rep targets, one per planned set (prev session's counts, floored). */
  perSetRepTargets: number[];
  /** Session target: beat this total (prev total + 1 on a repeat). */
  sessionRepTotalTarget: number;
  /** Last session's rep total at the fixed load (0 when no history). */
  prevSessionRepTotal: number;
  /** True when last session earned the increment (all sets ≥ floor at effort). */
  bumped: boolean;
}

/**
 * Session-start seed for a rep_total exercise. `prevSessionSets` are the
 * previous session's NORMAL working sets in performed order (same eligibility
 * as everywhere else). Returns null when there is no usable history — the
 * caller keeps its cold-start path.
 */
export function recommendRepTotalSessionStart(input: {
  prevSessionSets: PrevSessionSet[];
  targetRepRange: [number, number];
  targetRir: number;
  minIncrementKg?: number;
  plannedSets: number;
}): RepTotalSessionStart | null {
  const { targetRepRange, targetRir, plannedSets } = input;
  const [repMin] = targetRepRange;
  const valid = input.prevSessionSets.filter((s) => s.weightKg > 0 && s.reps > 0);
  if (valid.length === 0) return null;

  // Fixed-load model: the session's load is the top load actually worked.
  const topLoad = valid.reduce((m, s) => (s.weightKg > m ? s.weightKg : m), 0);
  const atLoad = valid.filter((s) => s.weightKg >= topLoad * 0.95);
  const prevTotal = atLoad.reduce((sum, s) => sum + s.reps, 0);

  // Increment earned when EVERY working set cleared the range floor at target
  // effort (missing RIR → assume it landed on target).
  const bumped =
    atLoad.length > 0 &&
    atLoad.every(
      (s) => s.reps >= repMin && (s.rir === undefined || s.rir <= targetRir + EFFORT_TOLERANCE_RIR)
    );

  const inc = input.minIncrementKg && input.minIncrementKg > 0 ? input.minIncrementKg : 2.5;
  const sets = Math.max(1, plannedSets);

  if (bumped) {
    // New load: reps reset to the floor across the board.
    return {
      weightKg: topLoad + inc,
      perSetRepTargets: Array.from({ length: sets }, () => repMin),
      sessionRepTotalTarget: sets * repMin,
      prevSessionRepTotal: prevTotal,
      bumped: true,
    };
  }

  // Repeat the load VERBATIM and chase the total: per-set seeds mirror last
  // session's counts (floored at repMin so a collapsed set re-asks the floor),
  // padded with the floor for any extra planned sets.
  const perSet = Array.from({ length: sets }, (_, i) => {
    const prev = atLoad[i]?.reps;
    return Math.max(repMin, prev ?? repMin);
  });
  return {
    weightKg: topLoad,
    perSetRepTargets: perSet,
    sessionRepTotalTarget: prevTotal + 1,
    prevSessionRepTotal: prevTotal,
    bumped: false,
  };
}

export interface RepTotalNextSet {
  /** Hold the session's fixed load, verbatim. */
  weightKg: number;
  /** Rep target for the next set. */
  reps: number;
  /** Session total logged so far. */
  totalSoFar: number;
  /** Reps still needed to beat the session target (0 when already beaten). */
  remainingToTarget: number;
  sessionRepTotalTarget: number;
}

/**
 * Within-session next-set target for a rep_total exercise: the load NEVER
 * moves mid-session; the rep target mirrors the session-start plan for that
 * slot, and the remaining-total tells the user what beats last session.
 */
export function recommendRepTotalNextSet(input: {
  sessionPlan: RepTotalSessionStart;
  completedReps: number[];
}): RepTotalNextSet {
  const { sessionPlan, completedReps } = input;
  const totalSoFar = completedReps.reduce((s, r) => s + r, 0);
  const slot = completedReps.length;
  const reps =
    sessionPlan.perSetRepTargets[slot] ??
    sessionPlan.perSetRepTargets[sessionPlan.perSetRepTargets.length - 1] ??
    1;
  return {
    weightKg: sessionPlan.weightKg,
    reps,
    totalSoFar,
    remainingToTarget: Math.max(0, sessionPlan.sessionRepTotalTarget - totalSoFar),
    sessionRepTotalTarget: sessionPlan.sessionRepTotalTarget,
  };
}
