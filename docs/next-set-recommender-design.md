# Next-Set Recommender — Design (DRAFT for review)

**Status:** proposal. Nothing implemented yet — this is the spec to sanity-check the
training logic before writing code.

**Author:** Claude (Opus 4.8), 2026-06-26. Review owner: Josh.

---

## 1. Problem & scope

During an active workout, after you log a set the app suggests the **weight × reps
for your next set**. Today there are two competing engines:

- `services/setSuggestionEngine.ts` (main's) — reactive RPE-% weight nudges, every set.
- `services/progressionEngine.ts → recommendNextSet` (this branch's) — double-progression
  style, holds weight in range, models a flat fatigue drop.

Both fixed the old "fewer reps at the same weight / 30-rep" bug. Neither is fully
correct. This doc specifies a single engine that is.

**In scope:** the within-session next-set suggestion + the two auxiliary predictions
(manual weight change, AMRAP).
**Out of scope (separate concern):** session-to-session load progression (double
progression). Covered briefly in §10 but lives elsewhere.

---

## 2. The core idea: two different questions

The bug in both current engines is that they blur two questions:

1. **"What's my *next set right now*?"** — For straight sets the weight should
   normally **stay the same**, and reps **decline across sets** as fatigue accumulates
   (e.g. 12 → 11 → 10 → 9). You don't change plates between sets unless something was
   clearly off.
2. **"What should I load *next session*?"** — Double progression: once you clear the
   top of the rep range, add weight **next time**. This is a between-session decision,
   not a between-set one.

This engine answers **#1 only**. #2 is a separate, session-level rule (§10).

---

## 3. Inputs

```
RecommendInput {
  // The set just completed
  lastWeightKg: number
  lastReps: number
  lastRir: number              // reps in reserve, 0..n (10 - RPE)

  // Session context for THIS exercise (NEW vs today's engines)
  setsCompletedThisExercise: number      // n: how many working sets already done
  sessionBestE1RMKg?: number             // freshest capacity anchor — see §6

  // Targets
  targetRepRange: [repMin, repMax]
  targetRir: number
  minIncrementKg?: number
}
```

The two **new** inputs vs `recommendNextSet` today:
- `setsCompletedThisExercise` — fatigue is cumulative; set 5 ≠ set 2. This is the single
  most important missing signal.
- `sessionBestE1RMKg` — the strongest (least-fatigued) E1RM observed so far this
  exercise, used as the capacity anchor (§6). The workout page already has every
  completed set, so it can compute and pass this.

---

## 4. Tunable constants (← please sanity-check these numbers)

| Const | Default | Meaning |
|---|---|---|
| `DEADBAND_RIR` | `2` | How far the last set's RIR must miss target before we change the weight at all. Inside ±2, hold. |
| `MAX_STEP_PCT` | `0.10` | Cap on per-set load change (±10%). Prevents wild jumps. |
| `HOLD_DROP_RATE` | `0.07` | Expected rep decline per set at a fixed load (~7%). Used in the HOLD case. |
| `FATIGUE_PER_SET` | `0.05` | Rep de-rating per already-completed set, used only when the weight changed (§6). |
| `FATIGUE_FLOOR` | `0.60` | Lower bound on the fatigue factor (never predict below 60% of fresh). |
| `OVERSHOOT_CEILING` | `5` | Max reps shown above `repMax` (so you never see "30 reps", but honest under-load still shows, e.g., 16 for an 8–12 range). |

These are the dials. The defaults are conservative and evidence-aligned (rep drop-off
at a fixed load with ~2–3 min rest is typically 5–10% per set), but they're exactly
what you should eyeball against how your sets actually feel.

---

## 5. Algorithm (within-session)

```
recommend(input):
  guard: if lastWeightKg <= 0 or lastReps <= 0 → return {hold lastWeight, repMin, maintain}

  [repMin, repMax] = targetRepRange
  e1rm = sessionBestE1RMKg ?? epley(lastWeightKg, lastReps, lastRir)   // §6
  dev  = lastRir - targetRir            // + = easier than target, - = harder
  n    = setsCompletedThisExercise

  // ---- 1) Decide the WEIGHT (default: hold) ----
  if lastReps < repMin  OR  dev <= -DEADBAND_RIR:
      // too heavy / went too close to failure → back off
      ideal     = weightFor(e1rm, midRange, targetRir)
      newWeight = roundToInc(max(ideal, lastWeightKg * (1 - MAX_STEP_PCT)))
      rationale = 'reduce_load'

  else if lastReps >= repMax  AND  dev >= DEADBAND_RIR:
      // hit the top of the range AND still had ≥2 in reserve → clearly too light
      ideal     = weightFor(e1rm, repMax, targetRir)
      newWeight = roundToInc(min(ideal, lastWeightKg * (1 + MAX_STEP_PCT)))
      rationale = 'increase_load'

  else:
      newWeight = lastWeightKg
      rationale = 'maintain'

  // ---- 2) Predict the REPS for the next set ----
  if rationale == 'maintain':
      // Anchor on what you just did and shave incremental fatigue.
      // Tracks the real per-set decline (12→11→10→9) without double-counting.
      drop = max(1, round(lastReps * HOLD_DROP_RATE))
      reps = lastReps - drop
  else:
      // Weight changed → no "last reps at this weight" to decrement from.
      // Predict from the fresh capacity anchor, de-rated for sets already done.
      fresh   = 30 * (e1rm / newWeight - 1) - targetRir     // reps at targetRir, fresh
      fatigue = max(FATIGUE_FLOOR, 1 - FATIGUE_PER_SET * n)
      reps    = round(fresh * fatigue)

  reps = clamp(reps, 1, repMax + OVERSHOOT_CEILING)

  return { weightKg: newWeight, reps, rir: targetRir, rationale }
```

Helpers:
```
epley(w, reps, rir)      = w * (1 + (reps + rir) / 30)              // capacity, unclamped
weightFor(e1rm, r, rir)  = e1rm / (1 + (r + rir) / 30)              // inverse Epley
midRange                 = round((repMin + repMax) / 2)
```

---

## 6. Fatigue model & the capacity anchor (the subtle part)

**Why the anchor matters.** E1RM estimated from a *late, fatigued* set under-states your
true capacity. If we recompute capacity from the last set every time and *then* subtract
more fatigue, we **double-count** — predictions spiral down.

**Resolution:** anchor on `sessionBestE1RMKg` = the **highest** E1RM seen across the
working sets so far this exercise (the freshest, strongest estimate). Apply fatigue to
*that* once. If no session anchor is available (first set), fall back to the last set's
E1RM.

**Two fatigue paths, deliberately:**
- **HOLD (weight unchanged):** decrement from the **actual last reps** (`lastReps - drop`).
  This tracks the observed decline directly and needs no anchor math — most accurate for
  straight sets.
- **CHANGE (weight moved):** there's no "last reps at the new weight", so predict from the
  anchor E1RM and de-rate by set number.

**Worth deciding (open question Q1):** a flat `HOLD_DROP_RATE` is simple but a set taken
*to* failure (RIR 0) fatigues more than one left at RIR 3. Optional refinement: scale the
drop by proximity to failure, e.g. `drop = round(lastReps * (HOLD_DROP_RATE + 0.02*(targetRir - lastRir)))`.
Flagged, not assumed.

---

## 7. Why this fixes both engines' problems

- **No jumpiness (vs main):** the `DEADBAND_RIR` means a set within ±1–2 of target RIR
  does **not** move the weight. Straight sets stay put.
- **No eager mid-session bumping (vs current `recommendNextSet`):** weight only increases
  when you both **clear the top of the range** and **leave ≥2 RIR** — a genuinely-too-light
  signal, not noise.
- **Honest reps:** predictions aren't clamped to the range; an under-load shows (e.g. 16),
  which is the signal §10 uses to add weight next session. Capped at `repMax + 5` so it
  never shows absurd numbers.
- **Fatigue-aware:** reps decline set-to-set the way they actually do.

---

## 8. Auxiliary predictions (keep main's, they're good)

These answer different UI questions and stay as-is (lightly folded into the new module):

- **`estimateRepsForWeight(newWeightKg, reference, ctx)`** — you manually type a different
  weight → predict reps at it. Same inverse-Epley math, clamp to range. (main's "key fix"
  for the 30-rep bug.) *Optional:* de-rate by set number for consistency with §5.
- **`predictAmrapReps(lastSet, ctx)`** — AMRAP set: `lastReps + RIR`, floored at `repMin`,
  capped at `repMax + 5`.

---

## 9. Edge cases

- **First working set (n = 0, no prior data):** there's nothing to recommend *from* — seed
  from the program's target weight / last session, not this engine. Engine only runs once
  ≥1 set is logged this exercise.
- **No RIR logged:** default `lastRir = targetRir` (assume on-target) → engine holds weight,
  predicts `lastReps - drop`. Safe.
- **Bodyweight / assisted:** operate on `effectiveLoadKg` (bodyweight ± modification), same
  as the rest of the app; `minIncrementKg` may be the added-weight increment.
- **Bad inputs (≤0):** guard returns a held, in-range set.
- **Duration/time-based exercises:** out of scope — they use the duration input, not reps.

---

## 10. Progression (separate, session-to-session)

Not part of this engine. Rule, evaluated at session end / next-session seeding:

> If on your top working set(s) you hit `≥ repMax` reps at `≤ targetRir`, increase the
> exercise's starting weight next session by one `minIncrement` (or a small % for the
> exercise). If you couldn't reach `repMin` at target RIR, decrease it.

This is what consumes the "honest reps" signal from §7. It belongs in
`SessionSummary` / program seeding, not the within-set engine.

---

## 11. Worked examples (target 8–12 reps, target RIR 2)

| Last set | n done | This engine → | main's → | current recommendNextSet → |
|---|---|---|---|---|
| 100×11 @ RIR3 (slightly easy, in range) | 1 | **100 × 10** (hold, fatigue) | 104 × 12 (bumps both) | 100 × 10 (hold) |
| 110×20 @ RIR4 (way too easy, over range) | 1 | **121 × 16** (+10% cap, honest reps) | 118 × 10 (jumps, hides under-load) | 121 × 17 |
| 100×9 @ RIR1, set 4 done (normal fatigue) | 4 | **100 × 8** (hold, decrement) | ~97 × 8 (drops weight on fatigue ✗) | 100 × 8 |
| 100×6 @ RIR0 (missed range, too heavy) | 1 | **~92 × 10** (reduce toward mid) | ~97 × ~7 | ~92 × 10 |

The row that matters most: **set 4 at normal fatigue.** main *drops the weight* because
the set felt hard (RPE up) — but that's just fatigue, not over-load; you should hold. This
engine and `recommendNextSet` hold; main doesn't. That's the clearest correctness win.

---

## 12. Decisions (the science calls)

- **Q4 — within-session increases? → DECIDED: YES (2026-06-26).** The engine adjusts the
  load mid-session. The `increase_load` branch fires during the session, but gated by the
  deadband so it reacts to a *clear* under-load (top of range **and** ≥2 RIR left), not to
  every RPE wobble. Normal "hit the top of the range at target RIR" stays a between-session
  progression trigger (§10), not a between-set one.
- **Q1 — fatigue rate:** default ~7% reps/set (`HOLD_DROP_RATE`). Tunable; proximity-to-
  failure scaling (§6) left out of v1, revisit from feel.
- **Q2 — deadband:** default ±2 RIR. Tunable.
- **Q3 — step cap:** default ±10%/set. Tunable.

Q1–Q3 shipped at defaults (they're named constants — trivially adjustable after live feel).

---

## 13. Implementation plan (once the science is signed off)

1. New `services/setRecommender.ts` (pure, tested) implementing §5–§6 + folding in
   `estimateRepsForWeight` / `predictAmrapReps`.
2. Unit tests: the §11 examples + edge cases + property tests (never fewer reps at same
   weight after an easy set; weight monotonic w.r.t. deviation; reps ≥ 1).
3. Wire `ExerciseCard.tsx` + `CompactSetRow.tsx` to it: pass `setsCompletedThisExercise`
   and `sessionBestE1RMKg` (both already derivable from logged sets on the page).
4. Retire `recommendNextSet` *and* `setSuggestionEngine`'s `suggestWeight`/`suggestReps`
   (keep the two aux fns). Update their tests.
5. Live-QA on a real workout; tune constants from feel.

Estimated: ~half a day incl. tests, after the science is signed off.
