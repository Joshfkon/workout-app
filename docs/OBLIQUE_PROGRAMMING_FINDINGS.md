# Oblique programming findings — open tickets

Two defects surfaced while making the Obliques volume row visible. Both
**predate** that change and neither is fixed by it. Recorded here rather than
folded into the visibility PR, because each is a programming/selection change
with its own review surface.

Measured 2026-08-22 against `generateFullProgram`, 48 programs
(3 experience tiers × 4 goals × 4 days/week), credited volume computed with
`perSetStandardCredit` — the same function the volume counter uses
(primary 1.0/set, secondary `SECONDARY_MUSCLE_CREDIT` = 0.5/set).

---

## Ticket 1 — hypertrophy-tier ranking never selects oblique-bearing work for ab slots

**Result: 0.0 credited oblique sets in 48 of 48 generated programs.** Median 0,
range 0–0. Not "low" — a point mass at zero. Abs over the same programs: median
6, range 3–6.

The credit math is not at fault. Every ab slot in all 48 programs was filled by
**Cable Crunch** and/or **Machine Ab Crunch**, both tagged
`primary=abs, secondaries=[]`. The pool `getExercisesSync()` returns
(`FALLBACK_EXERCISES`) does contain oblique-bearing work:

- obliques-primary: Pallof Press, Russian Twist, Cable Woodchop, Side Plank,
  Dumbbell Side Bend
- obliques-secondary: Plank, Hanging Leg Raise, Captain's Chair Leg Raise,
  Suitcase Carry

`muscleMatchesGroup` expands an `abs` target legacy-first, so any of these is a
*legal* candidate for an ab slot (`mesocycleBuilder.selectExercises`, the
`muscleMatchesGroup(e.primaryMuscle, muscle)` filter). They lose the slot on
hypertrophy-tier ranking — the crunch variants outrank them, and nothing in the
selector is aware that a muscle in the group is receiving zero credit.

**Consequence.** The credited MEV for obliques is 4. A user on a generated
program cannot reach it without hand-editing their program, so the Obliques row
sits at 0/4 indefinitely. It renders as a quiet gray 0 rather than an amber
warning (verified — see "Why this is not urgent" below), so the current cost is
a permanently empty row, not a nag.

**Reachable by hand, but only just.** Indirect credit accrues at 0.5/set, so
the credited MEV of 4 needs **8 sets** of oblique-secondary work:

| Routine | Credited obliques |
|---|---|
| What the generator produces | **0** |
| Plank ×3 | 1.5 |
| Plank ×3 + Hanging Leg Raise ×3 | 3.0 |
| HLR ×4 + Captain's Chair ×4 | 4.0 |
| Plank ×3 + HLR ×3 + Suitcase Carry ×3 | 4.5 |
| Any one obliques-primary exercise ×4 | 4.0 |

A plausible self-built core routine (planks + leg raises) lands at 3.0 and stays
below the threshold.

**Not proposed here:** whether the fix is a selection-level rule (ensure a group
with a zero-credit member gets at least one exercise that feeds it), a tier
adjustment, or an explicit oblique slot. All three are programming changes.

### Why this is not urgent

The row does not nag. In the mixed case — `abs` has logged Cable Crunch work,
nothing tagged obliques — the Obliques child row is:

```
sets: 0, band: {mev: 4, mrv: 10}, zone: 'below_mev',
belowMev: true, reachable: false, colorToken: 'neutral'
```

Two independent guards keep it quiet, and both must be preserved by any future
change here:

1. `zoneColorToken` returns `'neutral'` (gray) whenever `sets <= 0`, regardless
   of zone. Amber requires **more than zero** sets below MEV.
2. Every warning/pin/recommendation path gates on `reachable`, which is false:
   `laggingChildren` (parent not demoted — Abs still reads `success`),
   `pinLaggingChild` (not pinned open while collapsed), `isMuscleWarnable`
   (excluded from the MEV summary and atrophy card), and `flattenCandidates`
   (never offered as a target).

---

## Ticket 2 — `lib/training/constants.ts` has zero obliques-primary entries

The `programEngine` path draws from `EXERCISE_DATABASE` in
`lib/training/constants.ts`, which is a **different pool** from the one
`mesocycleBuilder` uses. It contains:

- obliques-primary: **none**
- obliques-secondary: Hanging Leg Raise, Plank

So for that path, direct oblique work is unreachable by construction — not a
ranking outcome but an absent option. Even a selection fix for Ticket 1 would
leave this path capped at 0.5-credit trickle.

`lib/training/__tests__/templatePoolReachability.test.ts` pins reachability
only, not adequacy, so this passes today.

---

## Out of scope for both tickets

No value in `DEFAULT_VOLUME_LANDMARKS` or `MEV_TARGETS` should be edited to
resolve either ticket. Obliques' direct MEV of 0 and credited MEV of 4 are
different units, not a disagreement — see the direct/credited convention notes
at both table definitions, and
`services/__tests__/directCreditedConvention.test.ts`.
