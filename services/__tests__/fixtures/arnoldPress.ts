/**
 * REGRESSION FIXTURE #2 — Arnold Press (shoulders), Jul 20 → Jul 27 2026.
 *
 * FROZEN. Second independent reproduction of the intra-session fatigue
 * defect (Iso-Lateral Incline Press MISS B): with two reproductions on
 * independent exercises, the fatigue term is CONFIRMED, not hypothesized.
 *
 * Loads are in POUNDS through the engine's kg-named fields (unit-agnostic
 * math — see isoLateralInclinePress.ts).
 *
 * Card state Jul 27: "45 lbs × 8-12 target" @ 2 RIR, est. 1RM 65.
 * Dumbbells: 2.5 lb granularity (learned from the 47.5 log — Phase D
 * increment learning WORKED here; do not regress it).
 *
 * Implied capacity per set today (canonical capped Brzycki, eff = reps+RIR):
 *   set 1: 45×8 @2   → 10 eff → 60.0
 *   set 2: 45×8 @2   → 10 eff → 60.0
 *   set 3: 47.5×7 @1 →  8 eff → 58.9     — gentle decay
 *
 * LIVE DEFECT (set 4): engine prescribed 42.5×10 @2 = 12 effective reps,
 * implying ~61.2 capacity — a SESSION BEST demanded on the final set after
 * fatigue, when the session had gone 10 → 10 → 8 effective reps. Correct
 * target was ~57.5 implied: 45×7 or 42.5×8. This is INV-2's canonical case.
 *
 * Additional live defects captured around this session:
 *   INV-1: banner prescribed 45×7 against its own stated "8-12" range,
 *          three consecutive sets, with no acknowledgment.
 *   INV-4: set-4 banner read "down 5 lbs" (measured off today's set 3 at
 *          47.5) when position-matched against last session's set 4 (40)
 *          the lifter was UP 2.5 — regression framing during a session that
 *          beat every position.
 *   0b:    header rendered "last session 45 lbs x 8, x 8, x 10 @ 3 RIR" —
 *          set 3's 40 lb load mislabeled 45, set 4 dropped entirely, RIR
 *          collapsed to set 1's.
 *   0c:    sets 1-2 were identical (45×8 @2, zero decay) and the engine
 *          proposed trimming reps rather than raising load.
 */

import type { FixtureSet } from './isoLateralInclinePress';

export const ARNOLD_TARGET_REP_RANGE: [number, number] = [8, 12];
export const ARNOLD_TARGET_RIR = 2;
export const ARNOLD_MIN_INCREMENT = 2.5;
export const ARNOLD_PLANNED_SETS = 4;
export const ARNOLD_STORED_ANCHOR_E1RM = 65;

/** Jul 20 session (previous), performed order. RPE logged: 7 | 9 | 10 | 10. */
export const ARNOLD_JUL_20: FixtureSet[] = [
  { weightKg: 45, reps: 8, rir: 3 },
  { weightKg: 45, reps: 8, rir: 1 },
  { weightKg: 40, reps: 10, rir: 0 },
  { weightKg: 40, reps: 8, rir: 0 },
];

/** Jul 27 session (today) — the three sets logged before the set-4 prescription. */
export const ARNOLD_JUL_27_LOGGED: FixtureSet[] = [
  { weightKg: 45, reps: 8, rir: 2 },
  { weightKg: 45, reps: 8, rir: 2 },
  { weightKg: 47.5, reps: 7, rir: 1 },
];

/** Session-best implied capacity today (canonical capped Brzycki): set 1/2. */
export const ARNOLD_JUL_27_BEST_IMPLIED = 60.0;
