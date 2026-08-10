# HyperTracker simulation harness — review & decisions

Everything the work turned up, in one place, ordered by what needs a decision
from you. Nothing here has been fixed: per the harness constraints, engine
changes are separate from harness work.

**Branch:** `claude/hypertracker-simulation-phase-0-8smabx`
**Suite state:** 275 suites / 5,083 tests green · `tsc` clean · lint clean
**Latest full sweep:** 350 runs · 23,519 simulated sessions · **139,536 logged sets** · 79.8s

```bash
npm run simulate                                      # fast suite (runs in CI)
npm run simulate -- --full                            # the sweep above
npm run simulate -- --persona=ego-lifter --seed=3     # reproduce any finding
npm run simulate -- --scenario=SET3_MISS              # deterministic scenarios
```

---

## Contents

1. [Headline results](#1-headline-results)
2. [Decisions I need from you](#2-decisions-i-need-from-you)
3. [Finding 001 — the contract violation](#3-finding-001--the-contract-violation)
4. [Pre-existing bugs found during the audit (B1–B7)](#4-pre-existing-bugs-found-during-the-audit-b1b7)
5. [Dead code](#5-dead-code)
6. [Guardrail results](#6-guardrail-results)
7. [Known limitations of the harness](#7-known-limitations-of-the-harness)
8. [Bugs found in the harness itself](#8-bugs-found-in-the-harness-itself)
9. [What was built](#9-what-was-built)
10. [Suggested order of work](#10-suggested-order-of-work)

---

## 1. Headline results

| Result | Count | Verdict |
|---|---|---|
| INVARIANT violations | **0** | State integrity is sound across 139,536 logged sets |
| Crashes (production code threw) | **0** | No exception on any path exercised |
| CONTRACT violations | **32** | All one defect — [Finding 001](#3-finding-001--the-contract-violation) |
| Guardrail warnings | 18,902 | Advisory; [needs triage](#6-guardrail-results) |
| Pre-existing bugs found by audit | 7 | [B1–B7](#4-pre-existing-bugs-found-during-the-audit-b1b7) |
| Dead tables / exports | 3 tables, 5 exports | [§5](#5-dead-code) |

**The zero in the first row is the most important number here.** No set was
counted twice, no reference dangled, no `set_number` collided, no NaN reached a
prescription, no delete left a row behind — across 350 runs, seven personas and
~six simulated months each. The accounting is solid.

**The Phase 0 stop condition was never triggered.** No prescription, volume,
fatigue, trend or progression *calculation* needed to change to make any of this
possible — only their callers and dependencies.

---

## 2. Decisions I need from you

| # | Decision | Why it's yours | My recommendation |
|---|---|---|---|
| **D1** | Is Finding 001 an engine bug or a contract that needs an approved reason code? | Only you may extend `APPROVED_REPETITION_REASONS` (constraint 10) | Engine bug — see §3 |
| **D2** | Triage B1–B7 | Product/severity calls | Fix B1 and B3 soon; rest are low |
| **D3** | Delete or wire up the dead code in §5 | Product intent | Delete `exercise_performance_snapshots` path; decide on `exercise_history` |
| **D4** | Promote any guardrail to a CONTRACT? | Guardrails become hard failures only by your say-so (constraint 11) | Not yet — tune thresholds first |
| **D5** | Invest in the local-Supabase suite? | Cost/benefit call | Yes, eventually — it's the biggest coverage gap |
| **D6** | Open a PR now, or land fixes first? | Yours | PR now; the harness is independently useful |

---

## 3. Finding 001 — the contract violation

**`REGRESSION_SET3_UNATTAINED_TARGET`** · CONTRACT · **OPEN**
Full writeup: `docs/SIMULATION_FINDING_001_SET3_REPEAT.md`

### The contract

> When a working set fails the prescribed rep target **and** reported RIR is at
> or below the target RIR, an immediately subsequent same-session prescription
> for the same exercise may not return the identical unattained (load, reps)
> target — unless the engine emits a reason code from the approved list.
>
> `APPROVED_REPETITION_REASONS = []` — empty.

### What happens

Within one session, 8–12 range, target RIR 2:

| Set | Engine asks | Lifter does | Reported RIR |
|-----|-------------|-------------|--------------|
| 1 | 85 × 10 | 85 × 10 @ RPE 8 | 2 — on target |
| 2 | 80 × 10 | 80 × **9** @ RPE 9 | **1** |
| 3 | 80 × 10 | — | — |

Set 2 missed at a reported RIR at or below target. The engine has been told, in
the only vocabulary it accepts, that the ask wasn't attainable. Set 3 asks again.

Deterministic, persona-free reproduction in
`simulation/__tests__/scenarios.test.ts`, pinned with `it.failing` so it goes
**red** the moment the engine changes.

### Scale

**32 of 350 runs (9.1%)** hit it. Each run stops at its first hard failure, so
that is 32 distinct runs, not 32 occurrences.

| Persona | Runs affected | Reproducing seeds |
|---|---|---|
| ego-lifter | 25 | 3, 4, 7, 8, 14, 19, 22–29, 32, 36–39, 42–44, 46, 48, 49 |
| plateauer | 3 | 14, 35, 42 |
| messy-editor | 2 | 13, 47 |
| detrainer | 1 | 15 |
| chaotic-intermediate | 1 | 22 |

Reason codes claimed: `load_lever` ×21, `position_match` ×10,
`session_capacity_cap` ×1. **None is on the approved list.**

### Why the ego lifter dominates

It reports RIR *higher* than actual — grinds to failure, claims 1–2 in reserve.
That lands it exactly in the contract's window: a genuine miss reported at a RIR
the engine reads as "near target". This is signal, not sampling noise, and it
suggests the defect is specifically about how the engine reconciles *a missed
rep count* with *an unalarming RIR*.

### Note: the canonical scenario passes

The spec's `SET3_MISS` (100×10 three times, degrading 10 → 9 → 7) **passes** —
the engine handles the obvious case correctly. The defect lives in a subtler
region, which is what the stochastic search was for.

### D1 — the actual question

There's a defensible reading where set 3's ask isn't "the same target" but "the
same target under new fatigue". The engine's own `load_lever` provenance says it
*wanted* to move the load and the increment grid had nothing finer to offer. On
that reading the fix is to the **contract** (add an approved reason code), not
the engine.

**My recommendation: treat it as an engine bug.** Two reasons. First, from the
lifter's seat the app is asking for something they just failed, with no new
information — regardless of what the provenance says internally. Second,
`position_match` (10 cases) isn't an increment-grid problem at all; it's the
engine copying last session's set at this position without checking that today's
attempt at that same target already failed. That one looks like a genuine miss.

If you disagree on `load_lever` specifically, the honest fix is to split the
contract: approve `load_lever` only when the grid genuinely has nothing to offer
*and* the engine says so explicitly, and keep `position_match` failing.

---

## 4. Pre-existing bugs found during the audit (B1–B7)

None of these were found by the simulation — they came out of reading the code
during Phase 0. None is fixed.

### B1 — Set deletion renumbers local state but never the database

`lib/training/logSet.ts:268` (`renumberBlockSets`), called from the workout page.

After a mid-session delete, surviving sets are renumbered to a dense `1..n` in
React/Zustand state, but **no `set_number` UPDATE is issued**. The database keeps
its gaps. `logSet`'s DB-max probe floors at the *local* number, so the next
logged set can reuse a `set_number` the database already holds —
`UNIQUE(exercise_block_id, set_number)` then rejects the insert and the set is
rolled back in front of the user.

**Severity: medium.** Needs a mid-session delete followed by more sets.
**Recommend fixing.** The behaviour is preserved verbatim and documented in
`renumberBlockSets`, so the fix is contained.

### B2 — `upsertWeeklyFatigueLog` is an emulated upsert with no unique constraint

`app/(dashboard)/dashboard/workout/[id]/_lib/sessionWrites.ts:222`

SELECT-then-UPDATE-or-INSERT with no backing `UNIQUE(user_id, mesocycle_id,
week_number)`. Idempotent under sequential retry; **not** under concurrency —
two overlapping finishes both read "no row" and both insert. Duplicate weekly
rows are then read by `ProgramEngine.checkDeloadTriggers` as consecutive weeks,
skewing deload decisions.

**Severity: low-medium.** Finish is user-driven and outbox-serialised.
**Recommend:** add the unique constraint + a real upsert. Small, safe.

### B3 — Post-session updates can be skipped entirely

`app/(dashboard)/dashboard/workout/[id]/_lib/finishWorkout.ts:215–221`

`runFinishPostProcessing` runs only when *this* call's flush covered the finish
entry. If another flush path (dashboard mount, `online` listener, page poll)
drains the outbox first, `completionSynced` is false and **the meso week advance
and deload check never run for that session**.

**Severity: medium.** Silent — the user sees a successful finish. The individual
sub-operations are idempotent, so a *double* run is harmless; a *missed* run is
the hazard.
**Recommend fixing.** This is probably costing users week advances today.

### B4 — `edited_at` stamp is non-atomic

`lib/training/logSet.ts:452` (`persistSetEdit`)

The edit lands, then a *separate* statement stamps `edited_at`. If the stamp
fails, `staleTargets.isTargetStale` never learns of the edit and the
target-recalc prompt is silently skipped.

**Severity: low.** Requires the second write to fail alone.
**Recommend:** fold into one update when the migration is applied everywhere.

### B5 / B6 — see [§5 Dead code](#5-dead-code)

### B7 — e1RM anchor has no explicit tie-break

`services/suggestionEngine/e1rmAnchor.ts:97`

`.sort((a,b) => b[1] - a[1]).slice(0, ANCHOR_QUALIFYING_SESSIONS)` — two sessions
with identical newest-set timestamps at the 5th/6th boundary resolve by
incidental row order, which can change the anchor e1RM.

**Severity: very low** in production (timestamps are ms-precision and distinct).
It matters to the *harness*, which is why the driver advances the clock between
every logged set.
**Recommend:** add a secondary sort on session id. One line, removes a class of
irreproducibility.

---

## 5. Dead code

Three tables have **no live writer**, and the code that would write them has no
callers. `ProgramEngine.loadUserData()` therefore always reads empty history and
empty calibrations in production.

| Table | Writer | Reader | Status |
|---|---|---|---|
| `exercise_performance_snapshots` | `writePerformanceSnapshots` (`_lib/sessionWrites.ts:38`) — **never called** | `hooks/useExerciseHistory.ts` — **no consumers** | Fully inert (B5) |
| `strength_calibrations` | `ProgramEngine.recordExerciseHistory` — reachable only via `recordWorkoutExerciseHistory`, **no callers** | `programEngine.ts:226` | Inert; live data is in `calibrated_lifts` |
| `exercise_history` | same dead path | `programEngine.ts:291` | Inert |

Also: **five of six `lib/training/workoutIntegration.ts` exports have no
callers** (B6). Only `checkShouldDeload` is live, reached from the finish flow.

**D3 — the question:** was this wiring lost in a refactor, or deliberately
abandoned? If abandoned, deleting it removes a trap — the next person to find
`writePerformanceSnapshots` will reasonably assume the table is populated. If
lost, `ProgramEngine`'s deload triggers are running on less data than intended,
which is a quiet correctness problem.

I've documented the situation in `workoutIntegration.ts` so nobody builds on it
by accident, but the call is yours.

---

## 6. Guardrail results

Advisory only — they never fail a run. From the full sweep (139,536 sets):

| Guardrail | Count | Reading |
|---|---|---|
| `RATCHET_ON_FLAT_PERFORMANCE` | 12,003 | Almost certainly **too sensitive** |
| `LOAD_JUMP` (>10% session-to-session) | 3,955 | Worth a look |
| `OSCILLATION` (A/B/A/B targets) | 2,683 | Worth a look |
| `PROGRESSION_AFTER_LAYOFF` | 261 | Plausible signal |

**D4 — my read:** don't promote any of these to CONTRACT yet. At ~8.6% of all
logged sets, `RATCHET_ON_FLAT_PERFORMANCE` is firing far too readily to be
actionable — its window (8 sessions, >5% load growth, ≤1 rep change) needs
tightening before the count means anything. `PROGRESSION_AFTER_LAYOFF` at 261 is
the one I'd examine first: it's rare enough to be real, and "load went up on the
first session back from a 2-week gap" is a behaviour worth confirming is intended.

These thresholds were my invention, not derived from HyperTracker's documented
requirements. They're a starting point for you to calibrate, not a verdict.

---

## 7. Known limitations of the harness

Recorded, not hidden. A green run means *these* paths, at *these* seeds, against
the in-memory client.

| # | Limitation | Impact | Fix |
|---|---|---|---|
| L1 | **The fake client enforces no constraints, RLS or triggers** | The audit found these load-bearing — `UNIQUE(exercise_block_id, set_number)` is what actually prevents concurrent double-logging. B1's real-world symptom can't surface here. | Local Supabase suite (**D5**) |
| L2 | **Session start is seeded, not driven** | `startMesocycleWorkoutSession` has a wide query surface (program_data resolution, transfer candidates, warmup generation) the fake doesn't cover. Its own logic is untested by the harness. | Extend the fake, or use local Supabase |
| L3 | Two exercises, one fixed rep range | No supersets, dropsets, bodyweight, duration exercises, or rep_total exercises in a full run | Widen fixtures |
| L4 | No deload / mesocycle progression across a run | Sessions are seeded from a template; week advance and deload aren't exercised end to end | Follows from L2 |
| L5 | Phase-isolation and training-gap contracts not implemented | Spec §3.2 lists them; I built the Set-3, empty-period and sanity contracts | Next phase |
| L6 | Single-process isolation only | Module-level singletons (Supabase client, Zustand, outbox) prevent in-process parallel runs | Shard by worker — already sufficient |

**L1 and L2 are the same investment** (D5) and together are the biggest gap. My
recommendation is to do it, but not urgently — the in-memory suite is fast enough
to run on every push, which is where most of the value lives.

---

## 8. Bugs found in the harness itself

Listing these because they're the reason to trust the rest. Each was caught by a
failing test, not by inspection, and each would have produced **false findings**.

1. **The first "violation" the harness reported was its own.** Fixture working
   weights sat at ~90–100% of the personas' true 1RM, so personas logged
   zero-rep sets and the Set-3 contract fired on a degenerate input. I traced it
   before believing it. Fixtures are now calibrated to ~70% and the reason is
   documented in `simulation/fixtures.ts`.
2. **Unclamped reported RIR** — `honestAttempt` returned values up to 11, feeding
   the engine an RIR no user can enter through the 0–4 chip.
3. **Detraining landed a session late** — applied *after* the comeback workout,
   so the engine met a lifter still at pre-layoff strength on exactly the session
   the detrainer persona exists to probe.
4. **The runner drove one session repeatedly**, so only the first cycle logged
   anything.
5. **The short-set specialist never missed its targets** until given a rep-poor
   body — it was just a weak lifter, not a Set-3 probe.
6. **The fake client validated embeds lazily**, so an unknown embed against an
   *empty* table silently returned `[]` — precisely the failure mode the module
   exists to prevent.

The discipline that matters: a harness that cries wolf is worse than no harness.
Every finding in §3 was traced to a deterministic, persona-free reproduction
before being reported.

---

## 9. What was built

All seven phases, one commit per phase, on the branch above.

| Phase | Delivered |
|---|---|
| **0** | Two audit reports (`SIMULATION_HARNESS_PHASE0_STAGE_A/B.md`). Stop condition not triggered. |
| **1** | `lib/clock.ts` seam + controllable clock · client injection for `ProgramEngine`/`fetchExerciseHistory` · five extractions (`logSet`, `createMesocycle`, `loadSession`, `getPrescription`, edit/delete) · `SessionDriver` |
| **2** | Seeded RNG · `PerformanceOutcome` contract · seven personas |
| **3** | INVARIANT / CONTRACT / GUARDRAIL assertions, checked after every state-changing operation |
| **4** | Deterministic regression scenarios |
| **5** | Per-set trace with reported *and* ground-truth effort; every finding carries a one-command repro |
| **6** | `npm run simulate` (4 modes) · CI wiring |

Production changes made along the way — all behaviour-preserving, all covered:

- **27 modules** routed through the clock seam, guarded by a static test that
  fails if a bare `new Date()` is reintroduced.
- **`logSet` now takes a caller-supplied `setId`**, closing the audit's H9: the
  operation has an idempotency key, so a retry can't create a duplicate set.
  Previously the only protection was a React re-entry flag.
- **`getPrescription` extracted** from a 4,705-line component, guarded by a
  33-case equivalence suite against the pre-extraction assembly. I mutation-tested
  that suite: dropping the position offset fails 10 cases, grading against target
  RIR instead of logged effort fails 16, blinding the bump gate fails 5.
- The pinned `engineRegressionBaseline` (captured before any audit fix landed)
  passes unchanged throughout.

**The engine was never modified to make an assertion pass, and no reason code was
ever added to the approved list.**

---

## 10. Suggested order of work

1. **Decide D1** (Finding 001). Everything else is smaller.
2. **Fix B3** — silently skipped week advances are likely affecting users now.
3. **Fix B1** — user-visible failure, contained fix.
4. **Resolve D3** (dead code) — cheap, and removes a trap for the next reader.
5. **Open the PR.** The harness is independently useful even with the above open.
6. **Tune the guardrail thresholds** (D4) before drawing conclusions from counts.
7. **Local-Supabase suite** (D5) when there's appetite — biggest coverage gain.
8. **B2, B4, B7** — low severity, batch them.

I'd suggest keeping harness work and engine fixes in separate PRs, as the
constraints require; I can take any of B1–B7 as its own change whenever you want.
