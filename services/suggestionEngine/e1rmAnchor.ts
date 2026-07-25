/**
 * e1RM anchor selection with recency decay.
 *
 * The prescription anchor used to be the raw MAX e1RM over the last N
 * sessions with equal weight — a 12-month-old peak (e.g. pre weight-cut)
 * anchored today's targets exactly like last week's session (audit failure
 * mode #3). Each candidate is now decayed by CALENDAR AGE before the max is
 * taken, so stale peaks fade smoothly instead of prescribing forever.
 *
 * Ages are measured RELATIVE TO THE NEWEST candidate, not to the wall clock:
 *  - the freshest data always keeps full weight, so an actively-trained
 *    exercise gets the identical anchor it always did (the newest session is
 *    almost always the decayed max) — the hard no-regression constraint;
 *  - the function stays pure and deterministic (no Date.now()), so the same
 *    history always produces the same anchor;
 *  - a lifter returning from a layoff still gets an anchor (their newest
 *    session carries weight 1 even if it is months old) rather than a
 *    near-zero one — the ±10% working-weight clamp and the all-sets bump
 *    gate contain any staleness there.
 *
 * Pure functions — no DB calls or side effects.
 */

import { E1RM_RECENCY_TAU_DAYS } from './constants';
import { estimateE1RMFromRpe, type E1RMEstimate } from '@/services/shared/e1rm';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The e1RM for a HISTORY set on the prescription-anchor path. Delegates to
 * the canonical estimator (services/shared/e1rm) — Brzycki, effective reps
 * capped at 12, **null above 15 effective reps**. The old local formula
 * extrapolated linearly without bound (a 137.5 lb × 30 @ 2 RIR set produced
 * "284 lbs" and anchored a whole exercise's prescriptions); a null candidate
 * simply never enters the anchor pool.
 *
 * Returns the full estimate (value + confidence) so callers can also
 * surface confidence; null = this set supports no e1RM claim.
 */
export function historySetE1RM(
  weight: number,
  reps: number,
  rpe: number = 10
): E1RMEstimate | null {
  return estimateE1RMFromRpe(weight, reps, rpe);
}

/** One anchor candidate: a set's estimated 1RM and when it was performed. */
export interface E1RMAnchorEntry {
  e1rmKg: number;
  /** Epoch ms of the session/set. Non-finite → treated as fresh (no decay). */
  timeMs: number;
}

/**
 * Max of recency-decayed e1RM candidates: each entry is weighted by
 * exp(-age_days / E1RM_RECENCY_TAU_DAYS), age measured from the NEWEST entry.
 * At tau = 45 days a 30-day-old peak keeps ~51% of its value in the
 * comparison; a 300-day-old peak keeps ~0.1% — effectively gone.
 *
 * Returns 0 when no entry has a positive e1RM.
 */
export function decayedE1RMMax(entries: E1RMAnchorEntry[]): number {
  let newestMs = -Infinity;
  for (const e of entries) {
    if (e.e1rmKg > 0 && Number.isFinite(e.timeMs) && e.timeMs > newestMs) {
      newestMs = e.timeMs;
    }
  }

  let best = 0;
  for (const e of entries) {
    if (!(e.e1rmKg > 0)) continue;
    const ageDays =
      Number.isFinite(e.timeMs) && Number.isFinite(newestMs)
        ? Math.max(0, (newestMs - e.timeMs) / MS_PER_DAY)
        : 0;
    const decayed = e.e1rmKg * Math.exp(-ageDays / E1RM_RECENCY_TAU_DAYS);
    if (decayed > best) best = decayed;
  }
  return best;
}
