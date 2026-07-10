/**
 * Set roles — `working` vs `ramp`.
 *
 * A set slot plays one of two roles within an exercise:
 *  - `working`: a real stimulative set the progression logic acts on.
 *  - `ramp`:    a feeder / back-off / potentiation set, loaded light relative to
 *               the working sets. It must NOT be graded against "did you clear
 *               the working rep target at the working RIR" — doing so is the
 *               category error that made a 90-lb feeder set read as "too light"
 *               against a 160-lb top set.
 *
 * Role is INFERRED from load (a set below RAMP_ROLE_MAX_FRACTION of the session
 * top set is a ramp set), but a user tag ALWAYS beats inference and is persisted
 * per exercise-slot.
 *
 * Pure functions — no DB, no side effects.
 */

import { RAMP_ROLE_MAX_FRACTION } from './constants';
import type { SetRole } from '@/types/schema';

export type { SetRole };

/** A completed/logged set reduced to just what role inference needs. */
export interface SetForRole {
  weightKg: number;
  /** Warmups never participate — they're already excluded upstream, but guard anyway. */
  isWarmup?: boolean;
}

/**
 * Load of the top working set among a set of sets (the heaviest non-warmup load).
 * Returns 0 when there's nothing to measure against. This is the reference the
 * ramp threshold is a fraction of.
 */
export function sessionTopSetWeightKg(sets: SetForRole[]): number {
  let top = 0;
  for (const s of sets) {
    if (s.isWarmup) continue;
    if (s.weightKg > top) top = s.weightKg;
  }
  return top;
}

/**
 * Infer a set's role purely from its load relative to the session top set.
 *
 * A set is `ramp` when its load is strictly below RAMP_ROLE_MAX_FRACTION of the
 * top set. With no usable top set (0 or negative), every set is `working` — we
 * never invent a ramp classification without a heavier set to compare against.
 */
export function inferSetRole(weightKg: number, sessionTopSetKg: number): SetRole {
  if (sessionTopSetKg <= 0) return 'working';
  return weightKg < sessionTopSetKg * RAMP_ROLE_MAX_FRACTION ? 'ramp' : 'working';
}

/**
 * Resolve the effective role for a slot: an explicit user tag wins; otherwise
 * fall back to load-based inference. Pass `userTag = null | undefined` when the
 * user hasn't tagged the slot.
 */
export function resolveSetRole(
  userTag: SetRole | null | undefined,
  weightKg: number,
  sessionTopSetKg: number
): SetRole {
  if (userTag === 'working' || userTag === 'ramp') return userTag;
  return inferSetRole(weightKg, sessionTopSetKg);
}

/**
 * Backfill roles for a session's already-logged sets (used by the historical
 * migration and by session-level analysis). Warmups are left untouched (they are
 * not working/ramp working sets). Returns a role per input index; warmups map to
 * `null`.
 */
export function inferRolesForSession(sets: SetForRole[]): (SetRole | null)[] {
  const top = sessionTopSetWeightKg(sets);
  return sets.map((s) => (s.isWarmup ? null : inferSetRole(s.weightKg, top)));
}
