# rep_total planner parity — design + status

Status, 2026-07-28. Follow-up to docs/INTRA_SESSION_PRESCRIPTION_PLAN.md:
the e1RM path's Phase 0/A/D work never reached the rep_total path, and a
full live session showed every rep_total exercise misprescribed while every
e1RM exercise behaved. This doc records the Phase 1 confirmation, the
architectural decision, and the design for the phases that change
prescriptions (2–3) — written BEFORE those phases were implemented.

## Phase 1 — hypothesis CONFIRMED

Claim: the rep_total planner computes the plan once at session start and
never revisits it; `recommendRepTotalNextSet` re-serves the session-start
value regardless of what has been logged.

Evidence (pre-fix code):

- `services/suggestionEngine/repTotalPolicy.ts:141-159` (old) —
  `recommendRepTotalNextSet({ sessionPlan, completedReps })` returned
  `sessionPlan.weightKg` verbatim and `perSetRepTargets[slot]` verbatim.
  `completedReps` was read ONLY to sum `totalSoFar` and index the slot —
  observed loads and effort never entered the prescription.
- `components/workout/ExerciseCard.tsx:1015-1027` (old) — `repTotalPlan`
  memo depends only on session-start inputs (`prevSessionSetsForGating`,
  range, RIR, increment, planned sets). Nothing logged today invalidates it.
- `components/workout/ExerciseCard.tsx:632-647` (old) — `recommendNext`'s
  rep_total branch ignored the just-completed set entirely (`last` was used
  only to echo `last.weightKg`) and returned the plan slot's reps.

INV-1, INV-2, position matching, and the too-heavy reduce branch all lived
exclusively in `recommendSet` (`services/setRecommender.ts:750-1000`), which
the rep_total branch never calls. Hence Bayesian Cable Curl: 42.5×6 @ 0 RIR
followed by a re-served ask of 42.5×10 @ 2 RIR — an ask whose implied
capacity exceeded the observed set by ~60% with no rule anywhere to notice.

## Decision: port the invariants as rep-space analogs — do NOT unify the math

Considered: refactoring so both paths share one prescription core, differing
only in progression grading. Rejected because the e1RM core IS the math this
path exists to avoid: `prescribe()` and its inverse are Epley-curve
operations, and rep_total exercises are routed here precisely because their
sets sit beyond the estimator's domain (the file header and the
cap-asymmetry fixes both document e1RM as fiction on these exercises).
Forcing a shared numeric core would smuggle the fiction back in.

What IS shared (single source of truth preserved):

- the invariant VOCABULARY and banner obligations — `outsideRange`,
  `sessionCapacityClamped`, positional provenance — same field names, same
  rendering contract as `SetRecommendation`;
- the loading grid (`services/suggestionEngine/loadGrid.ts`) — all rounding;
- the effort/deadband dials (`DEADBAND_RIR`, `EFFORT_MATCH_TOLERANCE`,
  `MAX_REDUCE_PCT`) from `services/suggestionEngine/constants.ts`;
- the load↔rep exchange (`expectedRepsAfterLoadChange`) equals Epley's own
  local slope at ≤ 12 reps, so the two paths agree everywhere both are
  defined and diverge only where e1RM math has no domain.

The rep-space unit of account: a set's demonstrated zero-RIR capacity is
`reps + RIR`; exchanging it across loads uses the non-linear rep-cost model;
an ask at `targetRir` may spend at most `capacity − targetRir`.

## Phase 1 (shipped in this commit)

`recommendRepTotalNextSet` re-derives from `observedSets` on every call:

- INV-2 analog: ask ≤ best observed zero-RIR capacity at the asked load
  minus the asked reserve (`sessionCapacityClamped`);
- too-heavy branch (mirror of `recommendSet`'s reduce): a set below the
  range floor at/past the failure deadband steps the LOAD down so the
  demonstrated capacity prices out at the range mid (capped −30%, on grid) —
  the Bayesian case now reduces ~42.5 → ~35 with an in-range rep ask, which
  is exactly the correction the lifter made manually;
- INV-1 analog: out-of-range asks flagged, banner renders the contradiction;
- INV-4 analog: `positionRef` provenance (slot vs SAME position last
  session) is the only delta claim the banner may render;
- lifter-chosen loads: a logged load off the plan re-prices the slot target
  onto the actual load instead of grading it against the plan's.

## Rep-cost model (Phase 2 primitive, shipped with Phase 1)

`expectedRepsAfterLoadChange(obsReps, fromKg, toKg)`:

- ≤ 12 reps: Epley's local slope — (30 + r)/100 reps per 1% load. Validated
  against the Bayesian Curl live case (37.5→42.5 off ~12-rep capacity cost
  ~5 reps; model: 6 predicted, 6 observed).
- > 12 reps: slope tapers 0.045/rep past 12, floored at 0.15/% — the
  endurance domain, where the load-rep curve flattens. Validated against the
  Cable Curl live case (61.2→67.5 at ~17 reps cost ~1 rep; Epley would
  predict ~4.7; model predicts ~2 — conservative but the right order).
- Symmetric: load decreases return reps by the same slopes.

## Phase 2 design — bump targets anchor to OBSERVED reps

`recommendRepTotalSessionStart`, bump branch:

- per-set targets = last session's at-load observed reps, in order, each
  exchanged through the rep-cost model to the new load — never a reset to
  the range floor. (Cable Curl: ~17-18 observed at 61.2 → targets ~15-16 at
  67.5, not 12.)
- bump gate gains a second clause: the bump is earned only when every
  exchanged target stays ≥ the range floor. Clearing the floor while the
  exchange prices the new load below it (the Bayesian 11-rep case) DEFERS
  the bump — `bumpDeferred: 'load_cost'` — and the plan holds the load and
  chases reps, with copy saying exactly why. This is the "be conservative on
  the increment when recent history is high-rep" requirement made structural.
- extra planned sets beyond history pad with the LAST exchanged target (the
  fatigue end), not the floor.

## Phase 3 design — volume as a constraint

Session start computes and returns:

- `prevSessionVolumeKg` — Σ weight×reps over ALL valid working sets last
  session (ramp sets included: total tonnage is what the lifter compares);
- `recommendedSetCount` — starts at max(plannedSets, at-load set count last
  session); while projected volume at equal-or-greater load falls short of
  last session's, sets are appended (capped at last session's total set
  count) — set count must never silently drop;
- `projectedVolumeKg` — plan load × Σ per-set targets;
- `volumeShortfall` — non-null when the projection still lands short at
  equal-or-greater load after set extension. The banner must state it.

The card renders: the shortfall explicitly, and a "last session N sets —
plan covers M, add the difference" line whenever `recommendedSetCount >
block.targetSets`. Auto-mutating `targetSets` is deliberately avoided
(plan changes stay visible and user-confirmed); the requirement is
satisfied by the plan carrying the extra targets and the banner saying so.

## Phase 4 design — two claims, two strings

The old counter compared progress to the PLAN total while labeling it
"to beat last session" (ISO Low Row: "49 of 48 (0 to beat)" against an
actual 61), and floored at 0 past the denominator. Fix: `remainingToBeatPrev`
(vs prevSessionRepTotal + 1) and `beatPrevBy` are computed against last
session's ACTUAL total and go negative-aware; plan progress ("X of Y
planned") is a separate string; beat-last-session framing is suppressed
entirely when the totals aren't comparable (load changed — Phase 5).

## Phase 5 design — totals don't survive a load change

- Within-session: any completed set deviating from the plan load by more
  than max(half grid step, 2.5%) invalidates the prior total as a target —
  `totalComparable: false`, `loadDeviation` provenance, copy "load changed
  (X vs Y) — previous total doesn't apply; today sets the new baseline".
- A bumped plan is also `totalComparable: false` by construction (the prior
  total was at the old load).
- Ramped history: when last session's valid loads span beyond the at-load
  tolerance, `rampHistory: true`; grading and totals read the TOP-load sets
  only, and the copy names the load ("at your top load …"). The at-load
  grouping tightens from ±5% to max(half grid step, 2.5%).

## Phase 6 — range-vs-IQR audit

`scripts/auditRepRangeIQR.ts` (read-only): for every exercise with logged
history, the interquartile range of working-set reps (recent sessions) vs
the block/default target range; prints every exercise where the two do NOT
overlap, in either direction. Reports only — never auto-narrows. Requires
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `AUDIT_USER_ID`;
this development environment has no DB credentials, so the run must happen
where they exist.

## Out of scope here, confirmed separately (see session report)

- Unilateral volume: no laterality flag exists anywhere in the schema; all
  volume paths count per-side load as logged. Needs a column + two volume
  implementations touched in lockstep — separate change.
- Trend pill: top-set e1RM Theil–Sen slope over up to 10 sessions with NO
  time window and no confidence gate on rendering; blind to the in-progress
  session. Separate change.
- Rest timer: 0:27/0:14 are countdown-remaining readings (warmup rest tail /
  idle +15s re-anchor), not prescriptions; RIR never modulates rest.
- lb→kg→lb: the 58.8/60/61.2 family is stored-converted-input drift;
  display-side exact preservation exists, engine-side family fix remains the
  lb-native increment work (INTRA_SESSION doc, carried-over item 1).
