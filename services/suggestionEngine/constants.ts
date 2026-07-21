/**
 * Suggestion-engine constants — single source of truth.
 *
 * Every tunable threshold / percentage used by the next-set & session-start
 * suggestion path lives here as a named export. Nothing in the engine, the set
 * roles, or the banner may hard-code a magic number: import it from this module.
 *
 * Historical dials that used to live module-private in `setRecommender.ts` were
 * moved here unchanged so the whole suggestion surface has one place to reason
 * about its numbers. See docs/next-set-recommender-design.md §4 for the
 * within-session dials; the role / anchor / override dials are documented inline.
 */

// ============================================================
// ENGINE VERSION
// ============================================================

/**
 * Version stamped on every suggestion record we persist, so a stored role /
 * suggestion can be traced back to the logic that produced it. Bump whenever
 * the prescription math or role semantics change in a way that would make old
 * records read differently.
 *
 *  v1 = pre-roles: session-start progression applied to every slot (the anchor
 *       bug — feeder sets graded as working sets).
 *  v2 = set roles + e1RM-anchored working prescription + ramp %-of-top +
 *       ±10% sanity clamp + honest rep-range banner.
 *  v3 = within-session hold math honors the LOGGED RIR: the maintain-branch rep
 *       prediction shifts by the effort-vs-target gap (11 @ 3 RIR vs a 2 RIR
 *       target → 11, not 10) instead of shaving fatigue alone, so identical
 *       inputs can produce different reps than a v2 record.
 *  v4 = session-to-session progression driven by the shared success predicate
 *       (sessionMetPrescription, design doc §10): top working set(s) at repMax
 *       earn the bump (was: EVERY working set with >= DEADBAND RIR spare); a
 *       bump reseeds reps at repMin; a not-met session seeds prevReps + 1
 *       (capped at repMax) instead of replaying last session; 2-session stalls
 *       hold and a 3rd consecutive miss sets the suggestDeload flag.
 */
export const SUGGESTION_ENGINE_VERSION = 4;

// ============================================================
// SET ROLES (Phase 2)
// ============================================================

/**
 * A set is inferred `ramp` when its load is BELOW this fraction of the session's
 * top working-set load. At/above it, the set is a real working set. 0.75 keeps
 * a genuine back-off / feeder set (e.g. 90 vs a 160 top set = 56%) out of
 * working-set progression, while a 130-vs-160 set (81%) still counts as working.
 */
export const RAMP_ROLE_MAX_FRACTION = 0.75;

/**
 * Prescribed load for a `ramp` set, as a fraction of TODAY's prescribed top
 * working set. ~55–60% is the ramp/feeder zone: enough to potentiate and groove
 * the pattern without eating into the working sets' stimulus. Ramp sets carry no
 * RIR target and are excluded from junk-volume detection.
 */
export const RAMP_LOAD_FRACTION = 0.575;

// ============================================================
// WORKING-SET PRESCRIPTION (Phase 3)
// ============================================================

/**
 * Sanity bound on the e1RM-anchored working prescription: the prescribed weight
 * may not move more than ±this fraction from the best recent same-exercise
 * WORKING weight. A hot e1RM (freshly PR'd, or noisy) can't prescribe a 20% jump
 * — if the anchor implies a bigger move than this, we clamp and say so in
 * provenance.
 */
export const WORKING_WEIGHT_CLAMP_FRACTION = 0.10;

// ============================================================
// E1RM ANCHOR RECENCY (audit remediation Fix 3)
// ============================================================

/**
 * Sessions of direct history each exercise reads for suggestions (last-N
 * window). This is the per-exercise fetch limit everywhere direct history is
 * read (workout-page batched query, single-exercise fallback fetch, and the
 * mesocycle session build), AND the per-exercise trim in
 * buildExerciseHistories — one constant so the queries and the grouping
 * cannot disagree.
 */
export const HISTORY_SESSIONS_PER_EXERCISE = 10;

/**
 * Half-life-style time constant (days) for the e1RM anchor's recency decay:
 * each history session's e1RM is weighted by exp(-age_days / tau) — age
 * relative to the newest session — before the max is taken
 * (services/suggestionEngine/e1rmAnchor.ts). 45 keeps a 30-day-old peak at
 * ~51% influence while a 300-day-old peak (~0.1%) is effectively gone, so a
 * pre-weight-cut PR cannot keep prescribing today's targets.
 */
export const E1RM_RECENCY_TAU_DAYS = 45;

// ============================================================
// LOGGED-SET OVERRIDE (Phase 4)
// ============================================================

/**
 * If the user logs a set whose load deviates by MORE than this fraction from the
 * suggested load, the logged set becomes the new anchor for the rest of the
 * session and for next-session prescriptions. We stop generating "vs suggestion"
 * commentary off the now-stale suggestion.
 */
export const OVERRIDE_DEVIATION_FRACTION = 0.20;

/**
 * Recalibration weighting hook (Phase 4). A set's raw e1RM under-states true
 * capacity in proportion to how much intra-session fatigue preceded it. When we
 * recalibrate the stored e1RM from a session, each already-completed working set
 * before the current one adds this fatigue-correction, so a FRESH near-failure
 * set (position 0, no correction) is trusted at face value while a late grinder
 * at the same weight×reps is credited for the fatigue it fought through.
 *
 * Deliberately small (2%/set) and capped by RECAL_MAX_FRESHNESS_CORRECTION so it
 * nudges rather than dominates. This is the ONLY fatigue-model touch-point the
 * suggestion fix is allowed (see task constraints); the within-session fatigue
 * dials below are unchanged.
 */
export const RECAL_FATIGUE_CORRECTION_PER_SET = 0.02;

/** Cap on the cumulative freshness correction so deep sets can't over-inflate e1RM. */
export const RECAL_MAX_FRESHNESS_CORRECTION = 0.08;

// ============================================================
// WITHIN-SESSION DIALS (design doc §4 — moved here verbatim)
// ============================================================

/** How far the last set's RIR must miss target before we touch the weight. */
export const DEADBAND_RIR = 2;
/**
 * Tolerance for calling a hold set's effort "on target". Inside ±this of the
 * target RIR the last set is treated as matching; outside it the set was
 * genuinely easier / harder and both the rep prediction and the banner copy say
 * so. 0.5 keeps integer-RIR chips (3 vs 2 -> easier) decisive while absorbing
 * the half-step from the RIR-2 "good" bucket (rpe 7.5).
 */
export const EFFORT_MATCH_TOLERANCE = 0.5;
/** Cap on per-set load increase. */
export const MAX_STEP_PCT = 0.10;
/**
 * Cap on per-set load reduction. Asymmetric on purpose: increases are capped tight
 * (+10%) to prevent wild jumps, but when the last set proves the load is far too
 * heavy (e.g. 2 reps against a 10–15 range) the correction to mid-range can need a
 * ~30% drop.
 */
export const MAX_REDUCE_PCT = 0.30;
/** Expected rep decline per set at a fixed load (HOLD case). */
export const HOLD_DROP_RATE = 0.07;
/**
 * Rep de-rating per already-completed set (weight-CHANGED case).
 * @deprecated Superseded by FATIGUE_E1RM_PER_SET — within-session fatigue is
 * now an INPUT adjustment (effective-e1RM decrement, see
 * setRecommender.fatigueAdjustedE1RM), never a post-hoc de-rating of the
 * output reps. Kept only for historical reference in the design doc.
 */
export const FATIGUE_PER_SET = 0.05;
/**
 * Lower bound on the fatigue factor.
 * @deprecated See FATIGUE_E1RM_FLOOR.
 */
export const FATIGUE_FLOOR = 0.6;
/**
 * Within-session fatigue as an e1RM haircut: each completed set reduces the
 * EFFECTIVE e1RM fed into prescribe() by this fraction. ~1%/set lands the same
 * rep decline the old rep-space de-rating produced at typical working
 * intensities (a 1% e1RM drop ≈ 0.4 reps at ~10-rep loads), but lives on the
 * curve INPUT so weight↔reps stays RIR-invariant within any fixed layer state.
 */
export const FATIGUE_E1RM_PER_SET = 0.01;
/** Floor on the cumulative within-session e1RM haircut (max −8%). */
export const FATIGUE_E1RM_FLOOR = 0.92;
/** Max reps shown above repMax (prevents absurd "30 reps", keeps honest under-load). */
export const OVERSHOOT_CEILING = 5;
/**
 * Reps beyond repMax that objectively prove the load is too light, regardless of
 * self-reported RIR.
 */
export const REP_OVERSHOOT = 2;

// ============================================================
// SESSION SUCCESS PREDICATE (sessionMetPrescription) DIALS
// ============================================================

/**
 * Sets within this fraction of the session's top GRADED load count as "top
 * set(s)" for the success predicate — double progression is graded where the
 * progression actually happens, not on lighter back-off work. 3% absorbs
 * micro-loading and unit-conversion rounding (e.g. 180 vs 182.5 lb).
 */
export const TOP_SET_LOAD_TOLERANCE = 0.03;

/**
 * Upper bound multiple on the grading scheme's rep window: a working-load set
 * is gradable only when its reps land in [repMin, max(repMin × this, repMax)].
 * Sets outside it (a heavy 200×4 pyramid top against a 6–10 range, or a
 * high-rep burnout) are a different scheme and are excluded from grading —
 * they must neither earn nor block a bump. Rep overshoot past
 * repMax + REP_OVERSHOOT stays gradable (it objectively proves under-load).
 * TODO(known debt): the durable fix is per-slot rep ranges for pyramid
 * schemes; this window is the interim heuristic.
 */
export const SCHEME_REP_WINDOW_FLOOR_MULTIPLE = 2;

/**
 * Two sessions count as attempts at the SAME prescription (for the stall
 * rule) when their top graded loads are within this fraction of each other.
 */
export const STALL_LOAD_TOLERANCE = 0.05;

// ============================================================
// COLD-START (first-ever session of an exercise) DIALS
// ============================================================

/**
 * On a COLD-START exercise (no logged history), an "easy" rating — this many
 * or more reps in reserve — bumps the next set's load even when the reps
 * landed inside the range. Cold-start estimates are expected to be wrong low,
 * so the first session converges aggressively instead of holding a bad guess.
 */
export const COLD_START_EASY_RIR = 4;

/**
 * Per-set load increase cap on a cold-start exercise (vs MAX_STEP_PCT
 * elsewhere). +15% lets an under-estimated first set correct within the same
 * session; from set two onward the normal history-anchored math takes over.
 */
export const COLD_START_STEP_PCT = 0.15;
