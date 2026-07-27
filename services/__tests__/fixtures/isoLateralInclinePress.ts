/**
 * REGRESSION FIXTURE — Iso-Lateral Incline Press (chest), Jul 21 → Jul 27 2026.
 *
 * FROZEN. This is the clean reference case for intra-session prescription:
 * crisp ROM, sane rep range, and RIR reporting that internally validates
 * (195×6 @0 following 192.5×9 @1 is exactly consistent). If a change to the
 * suggestion engine breaks this exercise, the change is wrong.
 *
 * Loads are in POUNDS, passed through the engine's kg-named fields verbatim —
 * the prescription math is unit-agnostic (pure ratios and grid arithmetic),
 * and keeping the user-reported numbers exact beats converting them.
 *
 * Card state on Jul 27: "Estimated 1RM 250 lbs · 10 sessions",
 * target 8–12 reps @ 2 RIR.
 *
 * Per-set e1RM Jul 27 (canonical capped Brzycki, effective reps = reps + RIR):
 *   set 1: 11 eff → 253   set 2: 10 eff → 257
 *   set 3:  6 eff → 226   set 4:  8 eff → 227
 * ~13% spread inside one session, monotonically ordered by fatigue: the late
 * sets measure the SAME capacity under accumulated fatigue, not lower capacity.
 *
 * The two engine misses this fixture reproduces (see
 * setRecommenderPositionMatch.test.ts):
 *   MISS A — set 2 under-prescribed: set 1 overshot its rep target AT target
 *     RIR (9 @2 vs prescribed 8 @2) and the engine held 182.5 anyway — the
 *     hold rule read effort only, never the rep term. Position matching
 *     prescribes 192.5×8 (what set position 2 did last session).
 *   MISS B — set 4 ignored the session: after 24 intervening reps including a
 *     true-failure set at 195, the engine re-derived 182.5×8 from the static
 *     session-start anchor. Position matching prescribes 182.5×7 (last
 *     session's set 4, held verbatim because it was taken past target effort).
 */

/** One performed set: load (lb, unit-agnostic), reps, reps-in-reserve. */
export interface FixtureSet {
  weightKg: number;
  reps: number;
  rir: number;
}

export const ISO_INCLINE_TARGET_REP_RANGE: [number, number] = [8, 12];
export const ISO_INCLINE_TARGET_RIR = 2;

/**
 * Loading reality (Phase D): a 10 lb stack machine, hand-loaded 2.5 lb
 * add-ons. The achievable-load grid is multiples of 2.5, which is how
 * 182.5 / 192.5 / 195 all exist. The single-increment legacy field would
 * carry only the 10 lb stack step — the floor bug (187.5 → 182.5).
 */
export const ISO_INCLINE_AVAILABLE_INCREMENTS: number[] = [10, 2.5];
export const ISO_INCLINE_SMALLEST_INCREMENT = 2.5;
export const ISO_INCLINE_STACK_INCREMENT = 10;

/** Jul 21 session (the "previous session" in every test). Performed order. */
export const JUL_21_SESSION: FixtureSet[] = [
  { weightKg: 182.5, reps: 8, rir: 2.5 },
  { weightKg: 192.5, reps: 8, rir: 1 },
  { weightKg: 202.5, reps: 5, rir: 0 },
  { weightKg: 182.5, reps: 7, rir: 0 },
];

/** Jul 27 session (the "today" being prescribed). Performed order. */
export const JUL_27_SESSION: FixtureSet[] = [
  { weightKg: 182.5, reps: 9, rir: 2 },
  { weightKg: 192.5, reps: 9, rir: 1 },
  { weightKg: 195, reps: 6, rir: 0 },
  { weightKg: 182.5, reps: 7, rir: 1 },
];

export const ISO_INCLINE_PLANNED_SETS = 4;
