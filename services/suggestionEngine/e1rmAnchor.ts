/**
 * e1RM anchor selection — best qualifying set in the recent-session window.
 *
 * History of this module: the anchor was originally the raw MAX e1RM over the
 * last 10 sessions (a 12-month-old peak anchored today's targets), then a
 * recency-DECAYED max (exp(-age/45d)). The decay fixed stale peaks but made
 * the anchor a function of the calendar: the displayed capacity slid downward
 * between sessions and re-scaled whenever a session was added, even though
 * the user's demonstrated capacity hadn't changed.
 *
 * Current rule (Phase 2): the anchor is the BEST canonical e1RM among
 * qualifying sets from the newest ANCHOR_QUALIFYING_SESSIONS sessions, where
 * a session qualifies only if it is within ANCHOR_MAX_AGE_DAYS of the NEWEST
 * session. Chosen over a median because a median lags a progressing lifter by
 * half the window and under-anchors; "best recent demonstrated capacity" is
 * what an anchor means. Properties:
 *  - moves ONLY when training happens (a session enters or displaces the
 *    window) — never with wall-clock time, and it is pure/deterministic;
 *  - stale peaks are excluded crisply: age is measured relative to the newest
 *    session, so a 10-month-old PR can't anchor a comeback, while a lifter
 *    returning from a layoff still gets an anchor (their newest session
 *    always qualifies);
 *  - residual staleness inside the 90-day window is contained by the ±10%
 *    working-weight clamp and the all-sets bump gate downstream.
 *
 * Which sets qualify (enforced by the CALLERS building candidates, tested in
 * anchorPoolEligibility.test.ts): non-warmup sets of set_type 'normal' with a
 * non-null canonical estimate. Cluster/myorep/rest-pause/dropset reps are not
 * commensurable with straight-set reps and must never enter the pool.
 *
 * Pure functions — no DB calls or side effects.
 */

import {
  ANCHOR_QUALIFYING_SESSIONS,
  ANCHOR_MAX_AGE_DAYS,
} from './constants';
import { estimateE1RMFromRpe, type E1RMEstimate } from '@/services/shared/e1rm';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The e1RM for a HISTORY set on the prescription-anchor path. Delegates to
 * the canonical estimator (services/shared/e1rm) — Brzycki, effective reps
 * capped at 12, **null above 15 effective reps**. The old local formula
 * extrapolated linearly without bound (a 137.5 lb × 30 @ 2 RIR set produced
 * "284 lbs" and anchored a whole exercise's prescriptions); a null candidate
 * simply never enters the anchor pool.
 */
export function historySetE1RM(
  weight: number,
  reps: number,
  rpe: number = 10
): E1RMEstimate | null {
  return estimateE1RMFromRpe(weight, reps, rpe);
}

/** One anchor candidate: a qualifying set's estimate, its session, and when. */
export interface AnchorCandidate {
  e1rmKg: number;
  /** Session the set belongs to (window is counted in SESSIONS, not sets). */
  sessionId: string;
  /** Epoch ms of the session/set. Non-finite → treated as newest (no age). */
  timeMs: number;
}

/**
 * Best qualifying e1RM: max over candidates from the newest
 * ANCHOR_QUALIFYING_SESSIONS sessions that lie within ANCHOR_MAX_AGE_DAYS of
 * the newest session. Returns 0 when no candidate qualifies — callers treat
 * that as "no anchor" and fall through to the last-session /
 * double-progression path instead of anchoring on garbage.
 */
export function bestQualifyingE1RM(candidates: AnchorCandidate[]): number {
  if (candidates.length === 0) return 0;

  // Session time = the newest candidate time seen for that session id.
  const sessionTime = new Map<string, number>();
  let newestMs = -Infinity;
  for (const c of candidates) {
    if (!(c.e1rmKg > 0)) continue;
    const t = Number.isFinite(c.timeMs) ? c.timeMs : Infinity;
    const prev = sessionTime.get(c.sessionId);
    if (prev === undefined || t > prev) sessionTime.set(c.sessionId, t);
    if (t !== Infinity && t > newestMs) newestMs = t;
  }
  if (sessionTime.size === 0) return 0;
  // All candidates non-finite-timed → nothing to age against; all are "newest".
  const referenceMs = Number.isFinite(newestMs) ? newestMs : Infinity;

  const qualifyingSessions = Array.from(sessionTime.entries())
    .filter(([, t]) => {
      if (t === Infinity || referenceMs === Infinity) return true;
      return (referenceMs - t) / MS_PER_DAY <= ANCHOR_MAX_AGE_DAYS;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, ANCHOR_QUALIFYING_SESSIONS)
    .map(([id]) => id);
  const kept = new Set(qualifyingSessions);

  let best = 0;
  for (const c of candidates) {
    if (!(c.e1rmKg > 0) || !kept.has(c.sessionId)) continue;
    if (c.e1rmKg > best) best = c.e1rmKg;
  }
  return best;
}
