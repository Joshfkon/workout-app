/**
 * Progression-health detectors (Step 5, 2026-07-29 rep-total session).
 *
 * Two failure modes shared one user-visible symptom: the engine kept
 * reporting a CONSTRAINT ("holding the load: a step up would drop you below
 * the floor") instead of surfacing that progression was jammed. These
 * detectors read recent per-session history and flag the jam explicitly:
 *
 *  - STALL: the working load hasn't moved for >= LOAD_STALL_SESSIONS
 *    consecutive sessions, OR the rep-total target has only trivially crept
 *    (+1..+2/session, reconstructed as prevTotal+1) across
 *    >= TARGET_STALL_TRANSITIONS consecutive met transitions at the same
 *    load — targets met every time and still going nowhere.
 *  - LOAD UNDER-PRESCRIBED: logged reps exceeded the configured range
 *    ceiling at RIR >= UNDERLOAD_MIN_RIR in
 *    >= UNDERLOAD_CONSECUTIVE_SESSIONS consecutive sessions — the load is
 *    objectively too light for the range and a load increase should be
 *    recommended in so many words (the Kelso Shrug 14 @3 RIR in an 8-12
 *    range case).
 *
 * Detectors REPORT; they never edit configs or prescriptions. Surfaced
 * in-app as ExerciseCard pills and across all exercises by
 * scripts/auditProgressionHealth.ts.
 *
 * Pure functions — no DB calls or side effects. Sessions arrive OLDEST
 * FIRST (the exercisePerformance builder convention); deload sessions must
 * be excluded by the caller (held light by design).
 */

import { smallestIncrement } from './suggestionEngine/loadGrid';
import { REP_TOTAL_LOAD_MATCH_FRACTION } from './suggestionEngine/constants';

export interface ProgressionHealthSet {
  weightKg: number;
  reps: number;
  /** Resolved RIR (resolveLastRir convention). Omitted → no effort signal. */
  rir?: number;
}

export interface ProgressionHealthSession {
  /** Session date (ISO) — ordering/reporting only; detectors use order. */
  date: string;
  /** Working sets, performed order. */
  sets: ProgressionHealthSet[];
}

export interface ProgressionStallFlag {
  /**
   * 'target_stall' = targets met every session yet only trivially raised —
   * the sharper claim; 'load_stall' = the load simply hasn't moved.
   */
  kind: 'load_stall' | 'target_stall';
  /** Consecutive most-recent sessions the flag spans. */
  sessions: number;
  /** The parked top load (kg). */
  loadKg: number;
}

export interface LoadIncreaseFlag {
  /** Consecutive most-recent sessions with above-ceiling reps at reserve. */
  sessions: number;
  /** Range ceiling the reps exceeded. */
  repMax: number;
  /** Highest offending rep count in the window. */
  worstReps: number;
  loadKg: number;
}

/** Sessions of unmoved top load that constitute a stall. */
export const LOAD_STALL_SESSIONS = 4;
/**
 * Met, trivially-raised target transitions that constitute a stall (a
 * transition = one session over its predecessor; 3 transitions = 4
 * consecutive sessions of "+1 and met, +1 and met, +1 and met").
 */
export const TARGET_STALL_TRANSITIONS = 3;
/** Per-transition total growth (reps) still considered trivial. */
export const TARGET_STALL_TRIVIAL_GROWTH = 2;
/** Reserve at/above which above-ceiling reps prove the load too light. */
export const UNDERLOAD_MIN_RIR = 2;
/** Consecutive sessions of above-ceiling reps required to recommend a load increase. */
export const UNDERLOAD_CONSECUTIVE_SESSIONS = 2;

interface IncrementOpts {
  minIncrementKg?: number;
  availableIncrementsKg?: number[] | null;
}

/** Top working load of a session (0 when it has no valid working set). */
function topLoad(session: ProgressionHealthSession): number {
  return session.sets.reduce(
    (m, s) => (s.weightKg > m && s.reps > 0 ? s.weightKg : m),
    0
  );
}

/** Same-load tolerance: the rep_total at-load grid rule. */
function loadToleranceKg(refKg: number, opts: IncrementOpts): number {
  return Math.max(
    smallestIncrement(opts.availableIncrementsKg, opts.minIncrementKg) / 2,
    refKg * REP_TOTAL_LOAD_MATCH_FRACTION
  );
}

/** A session's rep total across its at-top-load sets (rep_total convention). */
function atLoadTotal(session: ProgressionHealthSession, opts: IncrementOpts): number {
  const top = topLoad(session);
  if (top <= 0) return 0;
  const tol = loadToleranceKg(top, opts);
  return session.sets.reduce(
    (sum, s) => (s.reps > 0 && s.weightKg >= top - tol ? sum + s.reps : sum),
    0
  );
}

/**
 * Stall detector — spec 5(a). `sessions` oldest-first; returns the flag for
 * the most-recent consecutive run, or null. Prefers the sharper
 * 'target_stall' claim when both hold — but only for exercises that
 * actually progress on rep totals (`repTotal: true`): an e1RM-mode exercise
 * whose totals happen to creep must not be described as having a creeping
 * "rep-total target" it never had (Codex review).
 */
export function detectProgressionStall(
  sessions: ProgressionHealthSession[],
  opts: IncrementOpts & { repTotal?: boolean } = {}
): ProgressionStallFlag | null {
  const valid = sessions.filter((s) => topLoad(s) > 0);
  if (valid.length < 2) return null;

  const newest = valid[valid.length - 1];
  const refLoad = topLoad(newest);
  const tol = loadToleranceKg(refLoad, opts);

  // Consecutive most-recent sessions whose top load matches the newest's.
  let sameLoadRun = 0;
  for (let i = valid.length - 1; i >= 0; i--) {
    if (Math.abs(topLoad(valid[i]) - refLoad) <= tol) sameLoadRun++;
    else break;
  }

  // Target stall: within the same-load run, count consecutive most-recent
  // transitions that were MET (total >= previous + 1 — the reconstructed
  // minimal target) yet only trivially raised (growth <= trivial). Meeting
  // the target every session while it creeps +1 is a jam wearing a
  // progression costume.
  if (opts.repTotal && sameLoadRun >= 2) {
    const totals = valid
      .slice(valid.length - sameLoadRun)
      .map((s) => atLoadTotal(s, opts));
    let metTrivialTransitions = 0;
    for (let i = totals.length - 1; i > 0; i--) {
      const growth = totals[i] - totals[i - 1];
      if (growth >= 1 && growth <= TARGET_STALL_TRIVIAL_GROWTH) metTrivialTransitions++;
      else break;
    }
    if (metTrivialTransitions >= TARGET_STALL_TRANSITIONS) {
      return {
        kind: 'target_stall',
        sessions: metTrivialTransitions + 1,
        loadKg: refLoad,
      };
    }
  }

  if (sameLoadRun >= LOAD_STALL_SESSIONS) {
    return { kind: 'load_stall', sessions: sameLoadRun, loadKg: refLoad };
  }
  return null;
}

/**
 * Load-appropriateness detector — spec 5(b). Fires when EVERY one of the
 * most recent UNDERLOAD_CONSECUTIVE_SESSIONS sessions contains a set AT THE
 * SESSION'S TOP WORKING LOAD (grid tolerance) with reps above `repMax` at
 * RIR >= UNDERLOAD_MIN_RIR. Lighter ramp/back-off/drop sets are excluded —
 * a deliberately light set running high reps says nothing about the working
 * load the flag would tell the user to increase (Codex review). Missing RIR
 * never counts as reserve (no effort signal, no claim).
 */
export function detectLoadUnderprescribed(
  sessions: ProgressionHealthSession[],
  repMax: number,
  opts: IncrementOpts & { minRir?: number; consecutiveSessions?: number } = {}
): LoadIncreaseFlag | null {
  const minRir = opts.minRir ?? UNDERLOAD_MIN_RIR;
  const needed = opts.consecutiveSessions ?? UNDERLOAD_CONSECUTIVE_SESSIONS;
  if (!(repMax > 0)) return null;

  const valid = sessions.filter((s) => topLoad(s) > 0);
  if (valid.length < needed) return null;

  let worstReps = 0;
  let run = 0;
  for (let i = valid.length - 1; i >= 0; i--) {
    const top = topLoad(valid[i]);
    const tol = loadToleranceKg(top, opts);
    const over = valid[i].sets.filter(
      (s) =>
        s.weightKg >= top - tol &&
        s.reps > repMax &&
        s.rir !== undefined &&
        s.rir >= minRir
    );
    if (over.length === 0) break;
    run++;
    for (const s of over) worstReps = Math.max(worstReps, s.reps);
  }
  if (run < needed) return null;
  return {
    sessions: run,
    repMax,
    worstReps,
    loadKg: topLoad(valid[valid.length - 1]),
  };
}
