# Simulation finding 001 — `REGRESSION_SET3_UNATTAINED_TARGET`

**Class:** CONTRACT (hard failure)
**Status:** OPEN — reported, **not fixed**. Per harness constraint 9, engine
fixes are separate work from harness work.
**Found by:** Phase 3 stochastic sweep, 2026-08.
**Deterministic reproduction:** `simulation/__tests__/scenarios.test.ts`

---

## What the contract says

> When a working set fails the prescribed rep target AND reported RIR is at or
> below the prescribed/target RIR, an immediately subsequent same-session
> prescription for the same exercise may not return the identical unattained
> (load, reps) target — UNLESS the engine emits a reason code from the
> enumerated approved list.
>
> `APPROVED_REPETITION_REASONS = []` — currently empty.

## What the engine does

It re-serves the identical target.

Within one session, 8–12 rep range, target RIR 2:

| Set | Engine asks | Lifter does | Reported RIR |
|-----|-------------|-------------|--------------|
| 1 | 85 × 10 | 85 × 10 @ RPE 8 | 2 — on target |
| 2 | 80 × 10 | 80 × **9** @ RPE 9 | **1** |
| 3 | 80 × 10 | — | — |

Set 2 missed its rep target (9 of 10) at a reported RIR **at or below** the
target (1 ≤ 2). The engine has been told, in the only vocabulary it accepts,
that the ask was not attainable. Set 3 asks for it again, unchanged.

Prior session for the same exercise: `82.5×10 @8`, `77.5×10 @8`, `77.5×10 @8`.

`provenance.source` on the repeated prescription is **`load_lever`**. A second
variant reaches the same outcome through **`position_match`**. Neither is on the
approved list, and per constraint 10 neither may be added to make this pass.

## Scale

Stochastic sweep: **175 runs** (7 personas × 25 seeds × ~6 simulated months),
**73,100 logged sets**.

- **20 CONTRACT violations**, all `REGRESSION_SET3_UNATTAINED_TARGET`.
- **0 INVARIANT violations.** No double-counted sets, no dangling references,
  no NaN, no numbering collisions, no failed hard-deletes.
- **0 crashes.** Production code did not throw once.

Violations by persona:

| Persona | Violations | Reproducing seeds |
|---|---|---|
| ego-lifter | 14 | 3, 4, 7, 8, 14, 19, 22, 23, 24, 25 |
| chaotic-intermediate | 1 | 22 |
| detrainer | 1 | 15 |
| plateauer | 1 | 14 |
| messy-editor | 1 | 13 |

The ego lifter dominating is a signal, not noise. It reports RIR **higher** than
actual — it grinds to failure and claims 1–2 in reserve. That lands it in
exactly the window the contract covers: a genuine miss reported at a RIR the
engine reads as "at target", which is the input pattern the repeat requires.

## Why this matters

The lifter is told to do something they have just demonstrably failed, with no
new information offered. In the harness this shows up as a contract violation;
in the app it is a set the user cannot complete, immediately after the one they
could not complete.

## Reproducing

```bash
# Deterministic, persona-free (fast):
npx jest --testPathPatterns "scenarios"

# The original stochastic reproduction:
npm run simulate -- --persona=ego-lifter --seed=3
```

The deterministic scenario is marked `it.failing`, so it passes while the defect
exists and turns **red** the moment the engine's behaviour changes — whoever
fixes this will be told to flip it to `it`.

## Explicitly NOT done here

- The engine was not modified. `services/setRecommender` is untouched.
- `APPROVED_REPETITION_REASONS` stays `[]`. Adding `load_lever` or
  `position_match` would convert a defect into a documented feature by fiat,
  which is the exact failure the empty list exists to prevent. Only Josh may
  extend it, in a separate change.

## Open question for Josh

Is the repeat *ever* correct here? A defensible reading is that set 3's ask is
not "the same target" but "the same target under new fatigue" — the engine's
own `load_lever` provenance says it wanted to move the load and the increment
grid had nothing to offer. If that is the intended behaviour, the fix is to the
contract (an approved reason code) rather than to the engine. That call is
yours; the harness's job was to make the disagreement visible and reproducible,
and it has.
