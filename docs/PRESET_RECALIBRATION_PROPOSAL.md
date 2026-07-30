# Preset re-derivation proposal (group-cap follow-up, Change 2) — FOR REVIEW

**Nothing is applied.** `recommendVolume` still returns the old values; this
table is the reviewed input for the change that will apply them. Derivation
code: `services/presetRecalibration.ts`; gates:
`services/__tests__/presetRecalibration.test.ts`.

Scope distinction (per the review directive): the authored GROUP BANDS in
`services/volumeBands` are external research landmarks and are untouched.
What is re-derived here is `mesocycleBuilder.recommendVolume`'s base preset
table and the outputs of its goal multipliers (×1.1 bulk / ×0.7 cut) plus
the MRV clamp — values tuned against the pre-cap inflated numerator.

## Measured cap ratios (generated reference templates)

ρ = capped ÷ uncapped credited volume, pooled over 3d/4d/6d templates ×
{bulk, cut}, intermediate profile. Template-authored tags and seed-convention
tags measure IDENTICALLY (the generator's pool already carries seed-derived
tags), so the ratios are not contingent on the Change-4 retag:

| Group | ρ | Notes |
|---|---|---|
| triceps | **0.667** | every pushdown/extension: lat_med primary + long secondary (1.5/set) |
| calves | **0.667** | every raise: gastroc↔soleus pair (1.5/set) |
| glutes | **0.934** | abduction/SL-hip-thrust accessories in the bulk mix only |
| all others | 1.000 | cap never binds in the generated mixes |

## Proposal table

Columns: old base preset → per-goal outputs (bulk/maint/cut) in the pre-cap
currency (= what tracking used to read); ρ; what tracking reads POST-cap if
presets stay (bulk/maint/cut); the same-real-dose value (ρ × old, capped
currency); the MEV floor (smallest integer base whose ×0.7 cut output still
clears the band MEV); **proposed = max(round(same-real-dose), floor)**.
`*FLOOR*` marks where the floor raised the proposal above same-real-dose —
i.e. the old preset was prescribing below the minimum effective dose in real
terms and the increase is a deliberate correction, not drift.

| Group | Exp | Old | Old out b/m/c | ρ | New tracked b/m/c | Same-dose | Floor | Proposed |
|---|---|---|---|---|---|---|---|---|
| chest | novice | 10 | 11/10/7 | 1 | 11/10/7 | 10 | 11 | **11** \*FLOOR\* |
| chest | intermediate | 14 | 15/14/10 | 1 | 15/14/10 | 14 | 11 | 14 |
| chest | advanced | 18 | 20/18/13 | 1 | 20/18/13 | 18 | 11 | 18 |
| back | novice | 14 | 15/14/10 | 1 | 15/14/10 | 14 | 17 | **17** \*FLOOR\* |
| back | intermediate | 18 | 20/18/13 | 1 | 20/18/13 | 18 | 17 | 18 |
| back | advanced | 23 | 25/23/16 | 1 | 25/23/16 | 23 | 17 | 23 |
| shoulders | novice | 14 | 15/14/10 | 1 | 15/14/10 | 14 | 17 | **17** \*FLOOR\* |
| shoulders | intermediate | 19 | 21/19/13 | 1 | 21/19/13 | 19 | 17 | 19 |
| shoulders | advanced | 24 | 26/24/17 | 1 | 26/24/17 | 24 | 17 | 24 |
| biceps | novice | 12 | 13/12/8 | 1 | 13/12/8 | 12 | 14 | **14** \*FLOOR\* |
| biceps | intermediate | 17 | 19/17/12 | 1 | 19/17/12 | 17 | 14 | 17 |
| biceps | advanced | 22 | 24/22/15 | 1 | 24/22/15 | 22 | 14 | 22 |
| triceps | novice | 11 | 12/11/8 | 0.667 | 8/7.3/5.3 | 7.3 | 11 | **11** \*FLOOR\* |
| triceps | intermediate | 15 | 17/15/11 | 0.667 | 11.3/10/7.3 | 10 | 11 | **11** \*FLOOR\* |
| triceps | advanced | 20 | 22/20/14 | 0.667 | 14.7/13.3/9.3 | 13.3 | 11 | 13 |
| quads | novice | 10 | 11/10/7 | 1 | 11/10/7 | 10 | 11 | **11** \*FLOOR\* |
| quads | intermediate | 14 | 15/14/10 | 1 | 15/14/10 | 14 | 11 | 14 |
| quads | advanced | 18 | 20/18/13 | 1 | 20/18/13 | 18 | 11 | 18 |
| hamstrings | novice | 12 | 13/12/8 | 1 | 13/12/8 | 12 | 11 | 12 |
| hamstrings | intermediate | 16 | 18/16/11 | 1 | 18/16/11 | 16 | 11 | 16 |
| hamstrings | advanced | 19 | 20/19/13 | 1 | 20/19/13 | 19 | 11 | 19 |
| glutes | novice | 15 | 17/15/11 | 0.934 | 15.9/14/10.3 | 14 | 8 | 14 |
| glutes | intermediate | 19 | 21/19/13 | 0.934 | 19.6/17.8/12.1 | 17.8 | 8 | 18 |
| glutes | advanced | 23 | 24/23/16 | 0.934 | 22.4/21.5/14.9 | 21.5 | 8 | 22 |
| calves | novice | 10 | 11/10/7 | 0.667 | 7.3/6.7/4.7 | 6.7 | 11 | **11** \*FLOOR\* |
| calves | intermediate | 14 | 15/14/10 | 0.667 | 10/9.3/6.7 | 9.3 | 11 | **11** \*FLOOR\* |
| calves | advanced | 18 | 20/18/13 | 0.667 | 13.3/12/8.7 | 12 | 11 | 12 |
| abs | novice | 8 | 9/8/6 | 1 | 9/8/6 | 8 | 8 | 8 |
| abs | intermediate | 12 | 13/12/8 | 1 | 13/12/8 | 12 | 8 | 12 |
| abs | advanced | 16 | 18/16/11 | 1 | 18/16/11 | 16 | 8 | 16 |
| traps | novice | 6 | 7/6/4 | 1 | 7/6/4 | 6 | 8 | **8** \*FLOOR\* |
| traps | intermediate | 8 | 9/8/6 | 1 | 9/8/6 | 8 | 8 | 8 |
| traps | advanced | 10 | 11/10/7 | 1 | 11/10/7 | 10 | 8 | 10 |
| forearms | any | 12† | 13/12/8 | 1 | 13/12/8 | 12 | 5 | 12 |
| adductors | any | 12† | 12/12/8 | 1 | 12/12/8 | 12 | 5 | 12 |

† forearms/adductors have NO authored base preset — they fall through to
`recommendVolume`'s generic `|| 12` default. Worth an explicit entry when the
proposal is applied (12 is above their bands' midpoints; adductors' bulk
output only avoids exceeding MRV 12 via the clamp).

## Findings the review should weigh

1. **The cap's preset impact is confined to triceps, calves, glutes.** The
   generated mixes contain no cap-binding chest (no incline/decline variants
   selected), abs, or shoulder exercises — abs binding seen in the seed
   library does not occur in generated programs. User-authored programs can
   still differ; the tracking surfaces are already correct regardless.
2. **Pre-existing MEV violations, independent of the cap** (pinned in the
   test, pre-cap currency, all novice cut): chest 7<8, back 10<12,
   shoulders 10<12, biceps 8<10, quads 7<8, calves 7<8, traps 4<6. The ×0.7
   cut multiplier was already prescribing below the minimum effective dose at
   novice. The floors in the proposal close all of them; the alternative —
   softening the cut multiplier itself (e.g. ×0.8 at novice) — is a design
   call left to review.
3. **Triceps and calves floor-bind at novice AND intermediate**: the
   same-real-dose values (10 / 9.3) sit below the MEV floor (11), so applying
   the proposal INCREASES the real dose for intermediates vs pre-cap
   behavior. That is the "preset prescribed below MEV was broken" case made
   explicit: pre-cap these groups only ever looked MEV-compliant because the
   numerator was inflated 1.5×.
4. **Currency**: proposed values are in CAPPED credited currency and assume
   the generator projects capped credit (Change 3). Applying them while
   `creditWeek` still projects uncapped would over-allocate by ~1/ρ on the
   affected groups — apply together with (or after) enabling the Change-3
   flag.

## Hard assertion

`presetMevViolations(...)` — no preset output below the group band MEV for
any (experience, goal, recovery profile). Green against the PROPOSED values
(both profiles); pinned-red-list against the LIVE values (see finding 2).
When the proposal is applied, repoint the assertion at `recommendVolume` and
delete the pinned list — that is the acceptance gate for the apply-change.
