# Capped credit projection — gated rollout (Change 3)

`mesocycleBuilder.creditWeek` can now project group credit in the CAPPED
currency (the one tracking reports since the group-cap fix), routed through
the canonical `services/shared/volumeCredit` per-set math.

**This is a training prescription change, not bookkeeping**: with the flag
on, the generator stops believing a cap-binding exercise (triceps pushdown,
calf raise — 1.5 within-group credit/set) delivers 1.5× per set, so its
trim pass trims less and REAL prescribed sets rise toward the credited
targets.

## Gate

- Flag: `CAPPED_CREDIT_PROJECTION_DEFAULT`, driven by
  `NEXT_PUBLIC_CAPPED_CREDIT_PROJECTION=1`. **Default OFF**; unset env
  behaves byte-identically to the legacy uncapped projection (tested).
- Per-call override: `generateFullProgram(..., projection)` /
  `applyIndirectAwareAllocation(sessions, targets, projection)` with
  `{ capped: boolean, rampFraction?: number }`.
- **Dependency: do not enable against the un-recalibrated presets.** The
  preset table is being re-derived into capped currency
  (docs/PRESET_RECALIBRATION_PROPOSAL.md); enabling this flag first would
  over-allocate cap-binding groups by ~1/ρ. Enable together with (or after)
  applying the reviewed presets.

## Ramp (available before the flag goes on, as required)

`rampFraction` blends the projection linearly: 0 = legacy uncapped
(byte-identical to OFF, tested), 1 = fully capped. Schedule helper:
`cappedProjectionRampFraction(weekInMeso, rampWeeks)` = min(1, w/N) — an
N-week ramp phases the real-set increase in N even steps; every week ≥ N
(and later mesocycles) is fully capped. Monotonicity (OFF ≤ half ≤ full for
the binding groups) is pinned in `cappedCreditProjection.test.ts`.

## Projected week-1 REAL set counts (intermediate, 60-min sessions)

Primary-attributed working sets per group, generated reference templates,
flag OFF → ON (fully capped):

| Goal | Days | triceps | calves | abs | chest | shoulders |
|---|---|---|---|---|---|---|
| bulk | 3d | 11 → **12** | 3 → 3 | 3 → 3 | 15 → 15 | 9 → 9 |
| bulk | 4d | 6 → 6 | 6 → 6 | 6 → 6 | 15 → 15 | 9 → 9 |
| bulk | 6d | 11 → **17** | 6 → 6 | 6 → 6 | 15 → 15 | 9 → 9 |
| cut | 3d | 7 → **11** | 3 → 3 | 4 → 4 | 10 → 10 | 7 → 7 |
| cut | 4d | 7 → **11** | 7 → **10** | 6 → 6 | 10 → 10 | 9 → 9 |
| cut | 6d | 7 → **11** | 7 → **10** | 6 → 6 | 10 → 10 | 9 → 9 |

Reading notes:

- **Incline/decline chest and shoulders never move**: the generated mixes
  contain no cap-binding chest press variants (the only "incline" pick is a
  biceps curl) and no Arnold-class shoulder press, so the flag is a no-op
  there. Chest/shoulders exposure to this change is via user-authored
  programs, not the generator.
- **Abs never move** for the same reason — the generator's ab picks are
  abs-only-tagged in its pool.
- The increases are bounded by the trim-only allocator: the flag restores
  sets the old projection wrongly trimmed; it cannot add beyond the
  pre-trim selection (bulk 4d triceps stays at 6 because no trim fired
  there to begin with).
- Neighbor adjustments exist (not in the requested groups): glutes 9 → 12
  with hamstrings 16 → 15 on the 4d/6d bulk templates — restored glute
  accessories bring back their hamstring secondary credit, which fires one
  hamstrings trim. Net program size never decreases (tested); per-group
  decreases are bounded at one trim.
