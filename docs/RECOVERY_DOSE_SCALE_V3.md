# Recovery dose model v3 — dose scales the window

Reported 2026-08-14: the in-workout readiness sheet marked **Lats — Fatigued,
ready in ~2d** after two sets of `Dead Hang`. Investigation found three
separable causes, all fixed here.

## What was actually happening

`Dead Hang` was tagged `primary: forearms, secondaries: ['lats']`, so two sets
credited **1.0 effective set** to lats (`SECONDARY_MUSCLE_CREDIT` = 0.5/set)
against a lats session capacity of 10 (`MRV 20 ÷ 2 planned sessions/wk`) — a
normalized dose ratio of 0.10.

`SET_LOAD_LOW` was 0.15, so the v2 dose model scored that session at **zero
load** — and then handed it the *minimum* adjustment, `-12h`, on a 60h base:

| Session | dose | v2 adjustment | v2 window | Fatigued for |
|---|---|---|---|---|
| Dead hang ×2 @ RIR 3 | 1.0 | −12h | **48h** | 28.8h |
| Dead hang ×2 to failure | 1.0 | −9.1h | 50.9h | 30.5h |
| Full pull day (4 pulldown + 5 row) | 6.5 | +19.7h | 79.7h | 47.8h |

A session the model itself scored as *no load* bought 60% of a full pull day's
window. Two structural defects, plus one data error:

1. **Dose was an OFFSET, not a scale.** The adjustment ranged over
   `[-12h, +24h]` on top of a per-muscle base, so the floor was only a 20%
   discount on a 60h base. Any nonzero involvement was charged nearly the whole
   base window.
2. **The response was flat at the low end.** `smoothstep` has zero derivative
   at its edge, so 1 set and 3 sets of lat work differed by 2.6h.
3. **Last-session-wins.** `computeMuscleRecovery` took the most recent session
   that involved the muscle and discarded every other. A heavy pull day
   followed by a dead hang read as *only* the dead hang:

   ```
   heavy pull 3d ago only          → recovering, fresh in 7.7h
   heavy pull 3d ago + hang 6h ago → fatigued,   fresh in 42h
   ```

   One effective set added 34 hours of unreadiness by overwriting a debt it did
   not create.

## The three fixes

### 1. Retag `Dead Hang` (data)

`supabase/migrations/20260814000001_dead_hang_drop_lats_secondary.sql` drops
the `lats` secondary. A dead hang loads the grip to failure and holds the lats
at long length under bodyweight traction; the shoulder girdle is supporting,
not working through a range. Primary (`forearms`) is unchanged.

This is necessary but not sufficient — it fixes one row and leaves the model
that would do the same thing to the next light secondary.

### 2. Dose SCALES the window (model)

```
window = base × clamp((blend / REFERENCE_DOSE_RATIO) ^ DOSE_EXPONENT,
                      MIN_DOSE_SCALE, MAX_DOSE_SCALE)
blend  = totalDoseRatio + HARD_DOSE_BONUS × hardDoseRatio
```

| Constant | Value | Meaning |
|---|---|---|
| `REFERENCE_DOSE_RATIO` | 0.50 | dose earning exactly the base window |
| `DOSE_EXPONENT` | 0.65 | sublinear — 2× the dose is well short of 2× the time |
| `HARD_DOSE_BONUS` | 0.30 | a set at/below `hardRirThreshold` counts 1.3 sets |
| `MIN_DOSE_SCALE` | 0.20 | floor; binds only below ~4% of session capacity |
| `MAX_DOSE_SCALE` | 1.45 | a maximal session extends the window by ~45% |

The curve passes through the origin, so a trivial dose earns a trivial window.
`blend` is **linear** in both inputs (`hardDoseRatio ≤ totalDoseRatio`, so no
`min()` is needed), which makes independent monotonicity structural rather than
emergent. Continuity, boundedness and the parent-resolved capacity denominator
are unchanged from v2 and still pinned in
`services/__tests__/doseAdjustment.test.ts`.

`RECOVERY_WINDOW_BOUNDS_HOURS.min` moved **24h → 8h**. The 24h floor was
harmless under an additive model, which could not produce a small window from a
real session; under a multiplicative one it would have swallowed exactly this
fix, still claiming a full day off after two dead hangs.

Every constant above is a **heuristic policy choice**, fitted to leave ordinary
sessions where v2 had them. They are not measured physiological quantities.

### 3. Every session leaves an independent debt (model)

`computeMuscleRecovery` now evaluates **all** sessions that involve the muscle
and reduces twice:

- `estimatedReadyAt` — the **latest** ready-time across outstanding debts;
- `status` / `readinessRatio` — the **worst** verdict (equivalently, the
  minimum `hoursSince / window`) across them.

These can come from different sessions — *"Fatigued (trained 6h ago), Fresh in
10h (from Monday's heavy day)"* is a coherent readout — and they can never
contradict, because `fresh` requires every debt settled, which forces
`hoursUntilReady` to 0.

New result fields: `readinessRatio`, `debts[]`, `governingTrainedAt`,
`hoursSinceGoverning`. `lastTrainedAt` / `hoursSinceLast` stay literal (the
most recent touch, which is what the sheet displays), while `windowHours` /
`dose` / `breakdown` describe the **governing** session.

Surfaces that previously divided `hoursSinceLast / windowHours` now read
`readinessRatio` directly — those two fields describe *different sessions* once
a light session follows a heavy one, and dividing one by the other could report
"ready" while the status said Fatigued. `hoursUntilReadinessThreshold` reduces
over `debts` because the least-recovered debt is not always the slowest one.

## Before / after

Intermediate, 2 planned sessions/wk. v2 recomputed for an honest comparison.

| Session | Muscle | eff sets | v2 window | v3 window | change |
|---|---|---|---|---|---|
| Dead hang ×2 (secondary lats, RIR 3) | lats | 1.0 | 48.0h | **21.1h** | −56% |
| RDL ×3 → glutes (secondary) | glutes | 1.5 | 48.0h | **27.4h** | −43% |
| 3 easy lat sets | lats | 3.0 | 50.6h | 43.0h | −15% |
| 4 bicep sets to failure | biceps | 4.0 | 46.7h | 39.5h | −15% |
| Chest: 10 sets all to failure | chest_upper | 10.0 | 72.0h | 69.6h | −3% |
| Leg day: 8 quad sets, 3 hard | quads | 8.0 | 80.4h | 82.0h | +2% |
| Full pull day (4 pulldown + 5 row) | lats | 6.5 | 79.7h | 84.4h | +6% |

Ordinary productive sessions move by under 6%. Incidental and secondary-only
exposures — the ones the report was about — fall away.

End to end on the reported scenario:

```
heavy pull 3d ago only                    recovering   fresh in 12.4h
+ dead hang 6h ago (old tag, new model)   fatigued     fresh in 15.1h
+ dead hang 6h ago (retagged)             recovering   fresh in 12.4h
```

The middle row is the model fix working without the retag: the hold still adds
its own short debt — you did hang from a bar six hours ago — but bounded by its
own ~21h window instead of replacing the pull day's. Pre-fix that row read
*fatigued, fresh in 42h*.

## Known consequence, deliberately not fixed here

The parent → child edge in `involvementFactor` applies `secondaryDoseFactor`
**twice** for a secondary group tag (once for being secondary, once for the tag
not naming a head), so each bounded component sees half the group's dose. Under
the additive model every window bottomed out near the base and this was
invisible; a multiplicative window makes it explicit — a deadlift can leave
`traps` reading Fatigued while `upper_traps` and `mid_lower_traps` read Fresh.

Resolving it means deciding whether a group row aggregates its components'
fatigue or carries its own, which is the disjoint-credit question in
`MUSCLE_VOLUME_AUTHORITY` and out of scope for a dose-response change. It is
pinned as an observation in
`services/__tests__/recoveryMuscleFamilies.test.ts` ("KNOWN CONSEQUENCE: …"),
so that test goes red when the family model is fixed.
