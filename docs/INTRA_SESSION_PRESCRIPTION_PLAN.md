# Intra-Session Prescription — Phase 0/0b/A/D shipped, 0c/B/C/E held for approval

Status, 2026-07-27 (amended same day). Builds on the merged Phases 2–4 +
rep_total pull-forward. TWO frozen regression fixtures:
Iso-Lateral Incline Press Jul 21 → Jul 27
(`services/__tests__/fixtures/isoLateralInclinePress.ts`) and Arnold Press
Jul 20 → Jul 27 (`services/__tests__/fixtures/arnoldPress.ts`). With two
independent reproductions of the same defect, the fatigue term is treated as
confirmed.

## Shipped (amendment)

### Phase 0 — hard invariants (engine v6, `sessionInvariants.test.ts`)

INV-1 `outsideRange` flag + explicit banner copy (honest reps kept; the
contradiction is rendered, never silent). INV-2 session-capacity ceiling:
implied capacity (canonical capped Brzycki at the asked effort — the matched
set's recorded effort on position-matched recs, target RIR otherwise) may
never exceed today's best observed set (+1% rounding slack); trims the rep
ask, flags `sessionCapacityClamped`, banner says "capped at today's best".
Applies only once ≥1 set is logged this session. INV-3 re-asserted as named
property tests over the Phase D grid. INV-4 `framePositionalDelta`: delta
copy compares the prescribed set to the SAME position last session or shows
no number — last-set-relative framing removed.

Honesty note: the Arnold set-4 headline case (42.5×10 → 61.2 implied) was
already fixed by the shipped Phase A+D anchor repair (current output 42.5×9,
implied 58.9); the fixture pins it and INV-2 makes it structural. The
genuinely-failing-today invariant tests were INV-1 (both directions) and an
INV-2 Epley-vs-canonical divergence case (45×10 @4 → unclamped 47.5×9 asks
65.8 against a 64.8 observed).

### Phase 0b — set-history header (`lib/formatSetHistory.ts`)

Per-set loads grouped honestly, all sets rendered (>6 sets becomes an
explicit range summary, never a silent slice), RIR shown as the honest span.
The old inline line attributed set 1's load to every set, sliced to 3, and
collapsed RIR to set 1's — the pinned Arnold corruption. One legacy UI test
had the defect ENCODED in its expectation (a plain-BW set asserted as
"BW+25") — updated to the honest form.

## Shipped

### Phase A — set-position matching (`matchPositionTarget`, engine v5)

Root defect: prescriptions were re-derived per set from a session-START
anchor with no term for what happened earlier in the session. Fix: when the
previous session is comparable, set N targets what set position N did last
session plus the smallest meaningful progression (+1 rep at target reserve;
one increment / −1 rep at the ceiling; held verbatim when taken harder than
target). Gates: set count ±1, completed-set loads within ±10% of the same
positions, working-role positional set. Reactive guards: a past-deadband
grind caps the match at its own load; an objective rep-overshoot disables
the replay. Verified against the fixture: set 2 → 192.5×8 (MISS A), set 4 →
182.5×7 (MISS B), set-1 seed → 182.5×9.

Known limit (documented in code): exercise ORDER within the workout is not
stored in the history shape, so order comparability cannot be checked
directly; the load-comparability gate is the proxy. Adding a stored
`exercise_order` to history is a candidate follow-up.

### Phase D — loading grid (`services/suggestionEngine/loadGrid.ts`)

`available_increments_kg numeric[]` on exercises (additive migration, NULL =
fall back to `min_weight_increment_kg`). Grid = multiples of the smallest
entry. An intended change never renders as the reference load; a
sub-half-increment prescription is an explicit "no meaningful change
available at this increment" hold, not a decision. Earned session-start
bumps still step by the smallest real increment.

Not yet built (needs a decision): a UI to record per-exercise increment sets
(natural home: Settings → Gym Equipment, or the exercise editor). Until
then the column is settable via SQL/support tooling. Also note the column is
global-per-exercise; if your add-ons are gym-specific, a per-location
override (like location-scoped calibration) is the richer follow-up.

## Data audits (run required — this environment has no DB credentials)

`scripts/auditIntraSessionPrescription.ts` (read-only) produces, per your
live data: the unreachable-rep-range list, the Phase E contamination counts
(sets with RIR exactly at the prescribed target; sessions with every set at
target), and the Phase B anchor-delta preview. Run:

```
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
AUDIT_USER_ID=<uuid> npx -y tsx scripts/auditIntraSessionPrescription.ts
```

## Held for approval

### Phase 0c — read the sequence, not the last set (approach)

Live case: 45×8 @2, 45×8 @2 — identical load, identical reps, target
effort, ZERO decay — and the engine proposed trimming to ×7. Two identical
at-target sets with no decay is a different state than one set at target:
the load is too light, and the natural fatigue decline the hold rule prices
in did not materialize.

Proposed rule (new branch in `recommendSet`, evaluated BEFORE position
matching — the sequence evidence is from TODAY and beats last session's
replay; the user's own 47.5×7 override at exactly this point validates the
precedence):

- Trigger: the last `NO_DECAY_SETS_REQUIRED = 2` consecutive completed sets
  at the same load (within grid half-step), same reps, and RIR within
  `EFFORT_MATCH_TOLERANCE` of target (reads `sessionObservedSets`, which
  Phase 0 already threads in — no new plumbing).
- Action: `increase_load` by one grid step; reps predicted from the curve at
  the new load; INV-1/INV-2 apply on the way out (the Arnold case:
  47.5 at ~×7-8 predicted, implied ≤ 60 — passes).
- Interactions: the reactive too-heavy guards still win (a triggering pair
  followed by a grind cannot happen — the grind breaks the pair); cold-start
  keeps its own faster path; rep_total exercises never enter (fixed-load
  model).

Blast radius: recommendSet only, plus banner copy ("two identical sets at
target effort with no drop-off — the load is light; up one increment") and
fixture tests. Small; ships alone once approved.

Related audit shipped (report-only): audit script section 4 prints every
exercise whose top working load sits outside the %-of-anchor band its own
rep range implies (canonical Brzycki, eff capped at 12 — 8-12 @ 2 ⇒ ~69-75%;
Arnold's 45 = 69.2% of 65 sits at the very bottom, the "stuck at 45"
signature).

### Carried-over item 1 — rep_total must not compare across a load change (approach)

Confirmed in code (`services/suggestionEngine/repTotalPolicy.ts` +
ExerciseCard): the session plan (fixed load + "beat N total") is computed
ONCE from history; `recommendRepTotalNextSet` and the banner keep the plan
verbatim and never compare the load actually being logged against
`sessionPlan.weightKg`. Cable Fly live case: plan said ~28.8 (beat 40
total), user loaded 30, card still demanded the 40-total — double
progression in one step.

Proposed fix: in the rep_total banner/next-set path, when any completed
set's load deviates from the plan load by more than half a grid step (or
2.5%, whichever is larger), the prior total is INVALID as a target: copy
becomes "load changed (30 vs 28.8 last session) — previous total doesn't
apply; today sets the new baseline at 30", `sessionRepTotalTarget` is not
rendered, and next-session history compares totals only at matched loads
(the policy's existing ±5% atLoad grouping tightens to the grid half-step).
Also noted: the 28.7 vs 28.8 same-session artifact is the lb→kg→lb
round-trip (values stored from converted input on different days/rows);
family fix = the lb-native increment work — the display side should
round-trip through `convertWeightForDisplay` exact-preservation, and the
±5% atLoad tolerance already absorbs it for grading. Blast radius:
repTotalPolicy + ExerciseCard rep_total branches + tests. Held for approval.

### Carried-over item 2 — effort-weighted volume (FIXED: unrated excluded + surfaced)

Original verdict ("arithmetically correct") was true and beside the point —
review feedback accepted: a metric where ≤2 RIR plateaus at 1.0, unknown
weighs 1.0, and the UI pre-selects 2 can only ever print eff ≡ sets, and
unknown-RIR at maximum credit was a silent failure (missing data inflating
the number).

Shipped: `services/effectiveVolume.ts` now EXCLUDES unrated sets (missing or
garbage RIR) from the effective sum and surfaces them
(`summarizeEffectiveVolume` → `unratedSets`), threaded through the volume
accumulator, `VolumeRow`, and the workout strip ("of 22 sets · 3 unrated").
Raw set counts still show everything performed; the effective number only
claims what was rated. A fully-unrated session reads "0 eff of N", never
"N of N". Two test files had the old max-credit rule pinned as expected
behavior — rewritten with the reversal documented.

Still true and unchanged: the 1.0 plateau at RIR ≤ 2 (stimulative sets count
fully — the model's intent) and chip pre-selection (Phase E) remain the
other two reasons eff tracked sets so closely; Phase E's no-pre-selection +
`rir_unconfirmed` flag is what restores discriminative power for rated sets.
The strip-vs-set-row read-path unification recommendation stands.

### Cap asymmetry + frozen anchors (FIXED — `capAsymmetry.test.ts`)

Review feedback accepted; both were structural for every high-rep exercise:

1. **Inversion asymmetry.** Stored anchors come from the CAPPED estimator
   (floors, never encoding capability past 12 effective reps), but the
   inverse curve priced loads at the range's raw mid + RIR (a 12-20 range
   inverted at 18 eff) — dividing a deflated number by an extrapolated
   divisor. Double deflation: the 10 lb lateral-raise / 132.5 rear-delt
   family. Fixed: `weightForRepsCappedAnchor` — anchor-domain pricing never
   inverts past the cap (prescribe() weight-pick and the e1RM seed path).
   For ranges beyond the cap the eff-12 load is the best in-domain answer,
   and the existing below-floor honest-reps warning surfaces the
   range-vs-anchor tension. Within-session Epley-on-Epley math is
   deliberately untouched (both sides share one uncapped curve).

2. **Frozen anchor / classifier miss.** A set at 12 < eff ≤ 15 returns
   w × 36/25 REGARDLESS of the actual rep count — a 10 lb lateral raise says
   "14.4 ≈ 15" forever; rep progress is literally invisible to the anchor.
   Those same capped sets counted as "estimable", so the auto-classifier
   kept such exercises on the e1rm path. Fixed: above-cap sets now count
   toward rep_total classification (a lateral raise living above the cap
   auto-routes to rep_total); capped values still enter the anchor pool as
   floors so e1rm-path exercises with occasional above-cap sets keep their
   display continuity.

### Also — "· here" on the Cable Fly header: identified, not a bug

It is the location-scoped calibration tag (rule 11): for an exercise with
`progressionScope === 'local'`, the header marks whether the last-session
line is this gym's own track ("· here") vs "· est. from another gym"
(ExerciseCard, lastSessionMeta). Not truncation. The copy is admittedly
cryptic out of context — "· this gym" would read better; trivial change if
wanted.

### Phase B — anchor on freshness, not max

**Proposed rule (pick one, made the only rule):** anchor on the FIRST
working set of each session, aggregated by the existing qualifying-window
max (`bestQualifyingE1RM` over first-set candidates only).

Why first-set over an explicit fatigue adjustment: the first working set is
the only set whose fatigue state is (a) consistent session-to-session and
(b) zero by construction — no fitted correction term, no new constant to
tune, and it composes with the existing window/staleness rules unchanged. An
explicit per-set fatigue credit (the alternative) reintroduces a model
(what % per set?) exactly where Phase C already needs one; doing both rules
at once violates single-source-of-truth.

True-failure weighting: 0-RIR sets have no self-report error. Proposal: a
0-RIR set qualifies for the pool from ANY position (not just first), because
its e1RM is a floor measurement, not an estimate — but tagged with its
position so Phase C's decay model can normalize it back to fresh-equivalent.
Until C lands, a late 0-RIR set understates fresh capacity, so it enters the
pool as-is (conservative) rather than getting an unfitted correction.

Blast radius: `buildExerciseHistories` (workout page `_lib/suggestions.ts`),
`e1rmAnchor.bestQualifyingE1RM` callers, `exercise_performance_snapshots`
backfill versioning (the stored snapshots carry versioned e1RMs — a new
anchor rule means a new version stamp, NOT a rewrite of stored rows),
`startMesocycleSession` direct anchors, the analytics e1RM graph (display
should keep showing best-set capacity; only the PRESCRIPTION anchor
changes — this split must be explicit or the card's "Estimated 1RM" and the
prescription silently diverge). Audit section 3 shows the per-exercise
delta before anything is written.

### Phase C — descending intra-session targets

Prescribe the whole session up front with targets that descend as fatigue
accumulates. Phase A already produces descending targets by replaying last
session's positional shape; C generalizes it when positions don't match
(changed set counts, new exercises) and calibrates the decay.

Free calibration signal: repeated loads within a session (bookends). Jul 27:
182.5 first and last, 11 eff → 8 eff = ~3 effective reps of decay across
~24 intervening reps (~0.125 eff reps per intervening rep). Fit per-exercise
decay ONLY from bookend pairs; population default otherwise.

Proposed thresholds (state-and-hold): population default = the current
`FATIGUE_E1RM_PER_SET` haircut translated to rep-space; per-exercise
adjustment only after **5 sessions containing a repeat-load pair within the
anchor window**, blended (e.g. shrink toward the population value by
n/(n+5)). No per-user global curve on sparse data.

Blast radius: `recommendSet`'s fatigue layer (`fatigueAdjustedE1RM`),
`recommendSeedForSlot` (whole-session seeding), the prefill loops in
`ExerciseCard` (already per-position after Phase A), `prescriptionLayers`
tests, and the banner copy. Touches nothing in the workout session store.

### Phase E — RIR capture contamination

The effort buttons pre-select the TARGET RIR; "Log set" without touching
them records the target as observed effort (the Jul 11 calf session
signature — audit section 2 measures the prevalence).

Proposal, two parts:
1. **Capture:** no pre-selection — the RIR chip row starts empty; "Log set"
   without a selection stores `feedback.repsInTank = null` and a new
   `rir_unconfirmed` flag (schema: additive column on set_logs), rather than
   blocking the log (mid-set friction is how logging dies). The banner's
   `resolveLastRir` falls back to target for unconfirmed sets (unchanged
   behavior within-session).
2. **Consumption:** flagged sets are excluded from the anchor pool,
   calibration (`rpeCalibration`), and Phase C's decay fitting. Historical
   contamination cannot be flagged retroactively with certainty; the audit's
   all-sets-at-target sessions are the candidates — proposal is to leave
   history as-is and let the 90-day anchor window age it out, NOT a
   retroactive data change.

Blast radius: SetInputRow/effort chips UI, set_logs migration (additive),
`resolveLastRir` read path, anchor pool eligibility
(`anchorPoolEligibility.test.ts`), calibration engine input filter.

## Standing-rules compliance

Single source of truth: position matching lives in one function, consumed by
both the within-session and seed paths; grid rounding lives in loadGrid
only. No silent failures: fall-throughs are explicit gates; holds are
labeled (position-match hold, noise floor, no-meaningful-change). Audit
before data changes: the migration is additive with no data touched; all
data reports ship as a read-only script. Soft-delete only: nothing deleted.
Workout session store: untouched.
