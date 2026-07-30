# Preset re-derivation v2 (group-cap follow-up, Change 2) — **APPLIED (v3, 2026-07-30)**

**Status: APPLIED.** After sign-off, the v2 proposed values below became
`recommendVolume`'s live table, shipped in the SAME deploy as flipping
`CAPPED_CREDIT_PROJECTION_DEFAULT` to ON — the pair cancels to the pre-cap
real doses (pinned by the pairing gate in `cappedCreditProjection.test.ts`;
per-group |Δ| ≤ 2 real sets, triceps cut exactly 7 on every template).
Shipping either half alone is an INVALID configuration: v3 presets +
uncapped projection under-dose triceps/calves ~33%; old presets + capped
projection over-dose ~1/ρ. The mesocycle ramp is deliberately UNUSED — it
softens a real dose change and this deploy has none.

**Placeholder-MV gate (sign-off condition): PASSED — all five placeholder
MVs (glutes/abs/traps/forearms/adductors) are INERT.** For each,
cutFloor(MV) < the group MEV so the base floor is always the MEV
constraint; no proposal was raised by a placeholder; every applied cut
output clears its placeholder with margin ≥ 1 (tightest: traps novice,
4 vs 3). Real MV authoring for those five is deferred; a pinned test fires
if any placeholder ever starts binding.

Derivation code: `services/presetRecalibration.ts` (now derives from the
FROZEN `PRE_CAP_PRESETS` so it documents the applied conversion); gates:
`services/__tests__/presetRecalibration.test.ts`, including the acceptance
gate `recommendVolume === proposedPreset` for every group × experience.

**v2 (2026-07-30): goal-aware floors.** v1 held every goal's output to the
band MEV. That was the wrong constraint for cut presets: MEV is the minimum
effective volume for GROWTH; a cut targets RETENTION, whose minimum —
maintenance volume (MV) — sits meaningfully below MEV. The corrected rule:

    bulk / maintenance / recomp outputs ≥ band MEV
    cut outputs                        ≥ MV

Two v1 findings dissolve under the corrected rule:

1. **The "seven pre-existing novice-cut MEV violations" were an artifact of
   the wrong floor.** Every current cut output clears the proposed MV and
   every growth-goal output clears MEV — the LIVE table is compliant (pinned
   as an empty violations list in the test). The ×0.7 cut multiplier is not
   broken.
2. **The intermediate triceps/calves real-dose increase is gone.** v1 raised
   intermediate triceps 10 → 11 and calves 9.3 → 11 purely to hold cut
   outputs to the growth floor. v2 proposes the same-real-dose values
   (10 / 9). The only remaining floor binds are triceps and calves at
   NOVICE (7.3 → 8, 6.7 → 8), and those come from the undisputed
   growth-goal constraint — the capped-currency MAINTENANCE output (= the
   base preset) falling below MEV — not from the cut floor.

## MV — the real gap (authoring decision required, NOT adopted here)

No maintenance-volume landmark is authored anywhere: `VolumeLandmarks` is
`{mev, mav, mrv}` and nothing else in the app defines MV. The values below
are a PROPOSAL (`PROPOSED_MAINTENANCE_VOLUME`), stated in the app's
total-inclusive credited currency, and are NOT a silent uniform fraction of
MEV:

| Group | MV | Basis |
|---|---|---|
| chest | 6 | RP pecs MV:MEV 8:10 → ×0.8 of our MEV 8 |
| back | 10 | RP back 8:10 → ×0.8 of 12 |
| shoulders | 9 | RP side-delts 6:8 → ×0.75 of 12 |
| biceps | 6 | RP biceps 5:8 → ×0.62 of 10 |
| triceps | 5 | RP triceps 4:6 → ×0.67 of 8 |
| quads | 6 | RP quads 6:8 → ×0.75 of 8 |
| hamstrings | 5 | RP hams 4:6 → ×0.67 of 8 |
| glutes | 3 | **declared 0.5×MEV placeholder** (RP lists ≈0 for compound-trained; 0 would let a cut prescribe nothing) |
| calves | 6 | RP calves 6:8 → ×0.75 of 8 |
| abs | 3 | **placeholder 0.5×MEV** (RP ≈0) |
| traps | 3 | **placeholder 0.5×MEV** (RP ≈0) |
| forearms | 2 | **placeholder 0.5×MEV** (no published MV) |
| adductors | 2 | **placeholder 0.5×MEV** (no published MV) |

Sources: Renaissance Periodization per-muscle volume landmarks (Israetel et
al., RP hypertrophy guides — MV published alongside MEV per muscle);
maintenance-dose literature suggesting these are conservative-high as
floors: Bickel et al. 2011 (1/9–1/3 of building volume maintained size in
younger adults), Iversen et al. 2021 (~4 weekly sets minimum effective
dose). RP ratios are applied to OUR authored total-inclusive group MEVs, so
the MV inherits the same currency as the rest of the zone config.

## v2 proposal table (with diff against v1)

ρ = measured cap ratio (pooled 3d/4d/6d × bulk/cut generated templates —
unchanged from v1: triceps 0.667, calves 0.667, glutes 0.934, others 1.0).
Floor = max(MEV [maintenance output], smallest base whose ×0.7 cut output
clears MV). Proposed = max(round(ρ × old), floor).

| Group | Exp | Old | ρ | Same-dose | Floor | **v2 proposed** | v1 was | Δ v1→v2 |
|---|---|---|---|---|---|---|---|---|
| chest | novice | 10 | 1 | 10 | 8 | **10** | 11 | −1 (bind dropped) |
| chest | int/adv | 14 / 18 | 1 | 14 / 18 | 8 | **14 / 18** | same | — |
| back | novice | 14 | 1 | 14 | 14 | **14** | 17 | −3 (bind dropped) |
| back | int/adv | 18 / 23 | 1 | 18 / 23 | 14 | **18 / 23** | same | — |
| shoulders | novice | 14 | 1 | 14 | 13 | **14** | 17 | −3 (bind dropped) |
| shoulders | int/adv | 19 / 24 | 1 | 19 / 24 | 13 | **19 / 24** | same | — |
| biceps | novice | 12 | 1 | 12 | 10 | **12** | 14 | −2 (bind dropped) |
| biceps | int/adv | 17 / 22 | 1 | 17 / 22 | 10 | **17 / 22** | same | — |
| triceps | novice | 11 | 0.667 | 7.3 | 8 | **8** \*FLOOR\* | 11 | −3 (MEV-on-maintenance bind only) |
| triceps | intermediate | 15 | 0.667 | 10 | 8 | **10** | 11 | −1 (**real-dose increase gone**) |
| triceps | advanced | 20 | 0.667 | 13.3 | 8 | **13** | 13 | — |
| quads | novice | 10 | 1 | 10 | 8 | **10** | 11 | −1 (bind dropped) |
| quads | int/adv | 14 / 18 | 1 | 14 / 18 | 8 | **14 / 18** | same | — |
| hamstrings | all | 12 / 16 / 19 | 1 | same | 8 | **12 / 16 / 19** | same | — |
| glutes | all | 15 / 19 / 23 | 0.934 | 14 / 17.8 / 21.5 | 6 | **14 / 18 / 22** | same | — |
| calves | novice | 10 | 0.667 | 6.7 | 8 | **8** \*FLOOR\* | 11 | −3 (MEV-on-maintenance bind only) |
| calves | intermediate | 14 | 0.667 | 9.3 | 8 | **9** | 11 | −2 (**real-dose increase gone**) |
| calves | advanced | 18 | 0.667 | 12 | 8 | **12** | 12 | — |
| abs | all | 8 / 12 / 16 | 1 | same | 6 | **8 / 12 / 16** | same | — |
| traps | novice | 6 | 1 | 6 | 6 | **6** | 8 | −2 (bind dropped) |
| traps | int/adv | 8 / 10 | 1 | 8 / 10 | 6 | **8 / 10** | same | — |
| forearms | any | 12† | 1 | 12 | 4 | **12** | 12 | — |
| adductors | any | 12† | 1 | 12 | 4 | **12** | 12 | — |

† still the generic `|| 12` fallback — no authored base preset; worth an
explicit entry when applied.

Net v2 effect vs the live values: only ρ-driven currency conversion
(triceps/calves/glutes) plus two novice growth-floor binds. **No preset
raises anyone's real cut dose.**

## Hard assertion

`presetFloorViolations(...)` — goal-aware, both recovery profiles. Green
against the PROPOSED values AND against the LIVE table (pinned empty).
When the proposal is applied, the same assertion pointed at
`recommendVolume` becomes the permanent gate with no carve-outs.

## Application dependencies (unchanged)

Proposed values are capped-currency and assume the Change-3 capped
projection; apply together, per the agreed ordering (review → apply Change 2
→ full mesocycle → then consider enabling Change 3 with the ramp; Change 3
stays OFF throughout). Combined, Change 2 + Change 3 are designed to
reproduce the PRE-CAP real doses (P′ = ρ × P with capped projection cancels
exactly), so they do not compound — the standalone Change-3 projection
numbers in docs/CAPPED_PROJECTION_ROLLOUT.md are measured against the
CURRENT live presets, the configuration the rollout doc already forbids.
