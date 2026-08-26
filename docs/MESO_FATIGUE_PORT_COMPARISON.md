# Mesocycle generation before/after the #634 fatigue-model port

**Instrument:** `scripts/compareMesocycleGeneration.ts` — deterministic plan
summaries for four fixed profiles (no DB, static exercise catalog). Captured
on the commit before the port and re-captured after; this document records
the complete behavioral delta.

## What changed in the engine

Generation-time recovery gating moved from
`fatigueBudgetEngine.WeeklyFatigueTracker` (its own points, decay rate and
thresholds) to `services/plannedRecovery.PlannedWeekRecovery`, a thin adapter
that keeps a virtual history of the planned week and asks
`computeMuscleRecovery` / `computeStabilizerRecovery` — the models the
readiness sheet runs — for each planned day's state. Two deliberate
behavioral corrections rode along:

1. **Real rest days.** The old tracker numbered sessions consecutively
   (0, 1, 2, …) regardless of the schedule, so a Mon/Wed/Fri plan recovered
   as if it were Mon/Tue/Wed. Planned days now use the schedule's actual
   offsets.
2. **Stabilizer-aware selection.** Within a hypertrophy tier, candidates
   requiring a stabilizer whose stabilizer channel is under-recovered on the
   planned day are deprioritized (never across tiers). This is the planning
   counterpart of the live pre-set warning.
3. **Per-head candidate gating** (added for the Codex review on #636). The
   coarse session gate aggregates a group's standard muscles by MEAN so one
   fatigued head cannot veto the group — but that left a hole: a front-delt
   press could be selected at full volume while `front_delts` sat below the
   skip line and the `shoulders` mean passed. Selection now also reads the
   per-standard detail: a candidate whose own PRIMARY standard is below the
   skip line is dropped (fallback-ladder rule if that empties the pool), and
   one inside the trim band is deprioritized within its tier. Net effect in
   the fixed scenarios: shoulder slots redistribute between the 6-day PPL's
   repeat days (fresh rear/lateral heads earlier, no volume change); the
   other three scenarios stay byte-identical. Pinned by a regression test
   that reproduces the exact reviewed scenario.

The within-session budget (`SessionFatigueManager`) is unchanged; its local
costs are now derived from the shared `SECONDARY_MUSCLE_CREDIT` coefficient
(numerically identical to the old 8-vs-4 split).

## Results

| Scenario | Mesocycle sets | Exercise slots | Split | Warnings |
|---|---|---|---|---|
| intermediate-bulk-4day-60min | 454 → **454** | 168 → **168** | unchanged | 0 → 0 |
| novice-cut-3day-45min | 238 → **238** | 105 → **105** | unchanged | 0 → 0 |
| advanced-bulk-6day-75min-enhanced | 642 → **666** | 277 → **287** | unchanged | 0 → 0 |
| age50-maintain-4day-60min-poor-sleep | 216 → **216** | 104 → **104** | unchanged | 3 → 3 |

Three of four scenarios are **byte-identical**. Every difference in the
fourth (the 6-day enhanced PPL — the only scenario with back-to-back
sessions hitting overlapping muscles) is one of two kinds:

1. **Suppressed volume restored on repeat days.** The second Pull/Push days
   regain the lateral-raise and curl slots the old tracker dropped: under
   consecutive-day numbering plus its 30-points/day decay, shoulders and
   biceps still read "fatigued" on day 2 of a 6-day week even though the
   shared model (and the readiness sheet the user sees) calls them
   trainable. Weekly totals move closer to the planned volume distribution
   (+24 sets across the mesocycle); systemic capacity stays ~18%, far from
   the budget.
2. **Stabilizer-aware same-tier swaps.** Legs day swaps `Standing Calf
   Raise` (requires erectors — standing axial load) for `Leg Press Calf
   Raise` at the same hypertrophy tier when the week's hinge work has the
   erector stabilizer channel under-recovered. Exactly the collision the
   stabilizer feature was built to catch, now avoided at planning time.

No scenario lost volume, changed split, changed periodization, or gained a
warning.

## Deliberately preserved

- The unreachable `age >= 55` budget tier was **deleted, not activated** —
  every 55+ profile matched the `>= 45` branch first, so activating it would
  have changed shipped plans. A real 55+ tier is its own reviewable change.
- DUP sessions keep skip-only gating (the old DUP path never trimmed sets;
  the day-type modifier owns volume shape).
- Enhanced Athlete Mode reaches mover windows through `recoveryConfigFor`
  exactly as it does live; the stabilizer channel ignores it (the
  `exerciseSafety.ts` invariant), pinned by tests in both
  `plannedRecovery.test.ts` and `stabilizerRecovery.test.ts`.

## Known limits

- The stabilizer demotion is tier-scoped by design, and with the current
  catalog's tiers it rarely binds (S-tier machine/cable exercises are
  already stabilizer-light and sort first). It exists for same-tier
  collisions — the calf-raise swap above is the live example.
- Age no longer scales generation-time recovery (the old tracker's ×0.85 at
  45+): `muscleRecovery` has no age term, deliberately. Age still scales the
  session fatigue budget (`createFatigueBudget`). If an age term belongs in
  recovery, it belongs in the shared model, not in a planner-only fork.
