/**
 * REGRESSION FIXTURE #3 — Rope Tricep Pushdown, Jul 22 → Jul 29 2026.
 *
 * FROZEN. The session-capacity cap's unit-error defect: the cap logic took
 * the REP COUNT of today's highest-e1RM set (72.5×12, set 1) and used it as
 * a rep ceiling at a DIFFERENT load (65). Reps are load-dependent, so the
 * cap tightened as the top set got heavier, and set 1 stayed the anchor for
 * every later prescription.
 *
 * Loads are in POUNDS through the engine's kg-named fields (unit-agnostic
 * math — see isoLateralInclinePress.ts). Rep range 12-15 @ 2 RIR target;
 * 2.5 lb stack granularity.
 *
 * LIVE DEFECT (both set 2 AND set 3): engine prescribed 65×13 @2 with
 * rationale "matching set N from last session (65 lbs × 14) — go one more
 * rep · capped at today's best":
 *   - 65×13 has a LOWER implied e1RM than the 65×14 it claims to progress
 *     from (a "one more rep" claim attached to one rep FEWER);
 *   - the cap value did not change after set 2 logged — set 1 at 72.5×12
 *     remained the anchor for both prescriptions, giving 13 twice.
 *
 * Canonical implied capacities (capped Brzycki, eff = reps + RIR):
 *   Jul 22 set 2/3: 65×14 @2.5 → 16.5 eff → floor 93.6 (beyond domain)
 *   Jul 29 set 1:   72.5×12 @2 → 14 eff  → 104.4
 *   Jul 29 set 2:   70×13 @2   → 15 eff  → 100.8
 *
 * NOTE the structural trap this exercise sits in: the whole 12-15 range at
 * ~2 RIR lives AT or BEYOND the canonical estimator's 12-effective-rep cap,
 * so at a fixed load every in-range rep count measures the SAME implied
 * e1RM — the rep lever cannot express a measurable progression. Progressing
 * this exercise in e1RM space requires the LOAD lever (step 3 of the
 * 2026-07-29 remediation).
 */

import type { FixtureSet } from './isoLateralInclinePress';

export const PUSHDOWN_TARGET_REP_RANGE: [number, number] = [12, 15];
export const PUSHDOWN_TARGET_RIR = 2;
export const PUSHDOWN_MIN_INCREMENT = 2.5;
export const PUSHDOWN_PLANNED_SETS = 4;

/** Jul 22 session (previous), performed order. */
export const PUSHDOWN_JUL_22: FixtureSet[] = [
  { weightKg: 72.5, reps: 10, rir: 2.5 },
  { weightKg: 65, reps: 14, rir: 2.5 },
  { weightKg: 65, reps: 14, rir: 2.5 },
  { weightKg: 65, reps: 12, rir: 0 },
];

/** Jul 29 session (today) — the two sets logged before the defective prescriptions. */
export const PUSHDOWN_JUL_29_LOGGED: FixtureSet[] = [
  { weightKg: 72.5, reps: 12, rir: 2 },
  { weightKg: 70, reps: 13, rir: 2 },
];
