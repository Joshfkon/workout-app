# Intra-Session Prescription — Phase A/D shipped, B/C/E held for approval

Status, 2026-07-27. Builds on the merged Phases 2–4 + rep_total pull-forward.
Reference regression fixture: Iso-Lateral Incline Press, Jul 21 → Jul 27
(`services/__tests__/fixtures/isoLateralInclinePress.ts` — FROZEN).

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
