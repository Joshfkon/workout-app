# Volume group set-credit cap (2026-07-30)

Fix for the group-level set-credit double-count: an exercise tagged
primary-to-one-head + secondary-to-another-head-in-the-same-group credited its
muscle GROUP 1.5 sets per performed set (Iso-Lateral Incline Press: 4 sets →
6 group-level effective; Arnold Press retag shape: 4 → 6 at Shoulders), while
split-weighted legacy primaries (Cable Fly) summed to exactly 1.0/set —
inconsistent per exercise, and every group fullness bar biased high.

## What changed

- **Canonical module**: `services/shared/volumeCredit.ts` is now the ONLY
  source of set-credit math (mirrors `services/shared/e1rm.ts`). It owns
  `SECONDARY_MUSCLE_CREDIT`, the legacy primary splits,
  `resolvePrimaryMuscleCredits`, `perSetCredits` / `perSetStandardCredit`,
  and the new `perSetGroupCredits` / `groupCapScale`.
  `services/volumeTracker.ts` re-exports for import-path compatibility;
  `weeklyVolume.accumulateExerciseVolume`, `hooks/useWeeklyVolume`,
  `computeSecondaryCreditRatio` and `muscleAttributionAudit` all delegate.
- **Group cap**: per set, the credit any single muscle group receives is
  `min(1.0, Σ within-group member credit)`. Applied per exercise block in
  `buildVolumeRows` (`groupCapScale`), so group headers AND the group
  breakdown panel derive from the same capped per-exercise entries — header
  ≡ Σ(panel) for raw, effective, composition and unrated, before display
  rounding. RIR weighting rides ON TOP of the cap.
- **WITHIN-GROUP ONLY** — cross-group indirect inflow (bench → front delts →
  Shoulders 0.5/set) is untouched; the authored bands were calibrated against
  it. Do NOT generalize to a global per-set cap without re-running band
  calibration (guard comments in `volumeCredit.ts`, pinned by
  `volumeGroupCap.test.ts` "cross-group inflow is NOT capped").
- **Sub-muscle (head) counters are unchanged** and may overlap — correct for
  per-head programming decisions. Only the group rollup is capped.
- **Group zones stay AUTHORED** (`RESEARCH_VOLUME_BANDS`) — decision
  2026-07-30: with the cap, the numerator is a total-inclusive count on the
  same footing as the authored denominator; deriving from sub-zones would
  re-introduce the overlap at the denominator; reachability-scaling is
  rejected (non-comparable week-over-week, user-gameable). A typo-guard
  asserts group mev/mrv ≥ every fine child's, both recovery profiles.
- Closed in the same pass: `setsByStandardMuscle` legacy-keyed stats now
  share-scale their per-exercise entries (audit §5 latent double-count);
  `useWorkoutMuscleVolume` history entries use real exercise identity instead
  of the primary-muscle token (distinct exercises no longer merge in the
  drill-down or the cap).

## Persisted volume figures (backfill review — NO migration run)

Every user-facing volume surface derives from `set_logs` at read time, so the
capped numbers apply to ALL history immediately — **no step discontinuity, no
backfill required** for the volume page, readiness sheet, workout strip, home
tiles, or warnings.

Two persisted stores exist and were reviewed:

1. `weekly_muscle_volume` (tables in `20241209000001_initial_schema.sql` /
   `20241222000003_adaptive_volume.sql`): **no production code writes it**
   (`toWeeklyMuscleVolume` is an unused formatter; only tests call it). BUT
   `hooks/useWeeklyVolume` prefers stored rows over set-log derivation when
   any exist for the week. If any environment ever wrote rows, they would be
   stale-convention. Proposed (not executed): drop the stored-rows fast-path
   from `useWeeklyVolume` (always derive) or `DELETE FROM
   weekly_muscle_volume` — decide before running anything.
2. `user_volume_profiles` / `mesocycle_analyses` (adaptive-volume learning):
   store learned per-muscle tolerances aggregated under the OLD convention.
   Affected only for the cap-biting groups below; the "reset to defaults +
   relearn" path already exists. Flagged for review, not migrated.

## Unreachable sub-muscle diagnostic (one-off report)

Standard muscles NO exercise in a corpus can feed (primary or secondary):

- `seed-db` (148 retagged stock exercises): orphans = **`triceps`, `calves`**
  — the coarse *bucket* members only; every fine head (incl. triceps_long /
  triceps_lat_med, gastrocnemius/soleus) is reachable. Expected: stock
  exercises are fine-tagged; the coarse buckets exist for user/legacy tags.
- `service-fallback` (126): orphans = **`calves`** (same class).
- `program-template` (`lib/training/constants.EXERCISE_DATABASE`, 60, never
  retagged): orphans = **`upper_traps`, `triceps`(bucket), `glute_med`,
  `adductors`, `gastrocnemius`, `soleus`, `obliques`** — a generated program
  drawn from this pool cannot feed these fine muscles at all. Pre-existing
  gap (audit §5), now quantified.

User-created custom exercises are not statically auditable; the runtime
dry-run in `lib/migrations/coarsePrimaryRetag.ts` covers those.

## Cap impact / in-flight mesocycle check (report only — nothing auto-adjusted)

Where the cap binds (per-set group credit was 1.5, now 1.0 → those exercises'
GROUP credit drops 33%; current seed tags):

| Group | Seed exercises where the cap binds |
|---|---|
| triceps | ALL 9 pushdown/extension isolations (lat_med primary + long secondary) |
| abs | 9 of the ab movements (abs↔obliques pairs: planks, leg raises, twists, woodchop, Pallof, suitcase carry) |
| calves | ALL 7 raise/press variants (gastrocnemius↔soleus pairs) |
| chest | Incline DB Press, Decline BB Press, Dips (Chest), Smith Incline (upper↔lower pairs) |
| glutes | Abduction accessories + Single-Leg Hip Thrust (glutes↔glute_med) |
| shoulders | Arnold Press (fallback/template tag shape; user-lib retags like front+side) |

Consequence for active mesocycles: `mesocycleBuilder`'s presets and its
allocator (`creditWeek` → `applyIndirectAwareAllocation`) project a week's
credited group totals **uncapped**, so a generated program now TRACKS below
what the generator believes it prescribed wherever it includes the exercises
above — by up to a third of their isolation share. Against the unchanged
authored bands (intermediate presets → band):

- **triceps** (preset 15, band 8–24): an isolation-heavy allocation (e.g. 9
  pushdown/extension sets projecting 13.5 credited) now tracks 9 — still ≥
  MEV 8 but far under the preset; borderline cut-goal programs (preset ×0.7 ≈
  10.5 projected) can now track ≈ 7 → **below MEV**.
- **calves** (preset 14, band 8–20): ~9 performed raise sets projected 13.5 →
  track 9; cut-goal ≈ 10 projected → ≈ 6.5 tracked → **below MEV**.
- **abs** (preset 12, band 6–20): same shape; cut-goal programs can dip to ≈
  5.5 tracked → **below MEV**.
- **chest / glutes / shoulders**: only partial exercise coverage — typical
  mixed programs drop ≈ 0.5–1.5 credited sets; stay in zone.

Recommended follow-up (separate, reviewed change): route `creditWeek` through
`perSetGroupCredits` so the generator projects in the same capped currency it
is tracked in. Not done here per instruction.

## Downstream consumers reviewed

- **Tracking surfaces** (volume page, readiness sheet, workout strip, home
  tiles, atrophy warning, muscle map): all render `buildVolumeRows` → get the
  cap automatically; parity tests updated (calves mixed fixture 14 → 11,
  triceps motivating week 12.5 → 11).
- **Prescription/readiness**: `fatigueEngine` / `muscleRecovery` consume RAW
  set counts + load by scope guard — mechanical work drives fatigue — and are
  deliberately NOT capped (unchanged).
- **Share formatters** (`lib/workout-sharing.ts`, social): no volume usage.
- **`computeSecondaryCreditRatio`** (learned-MEV rescale reference): now uses
  capped group credit — consistent with the rollup it reconciles against.
- **`volumeTracker.calculateWeeklyVolume`**: standard-muscle level (no group
  rollup) — unchanged behavior, now built on the canonical constants; live
  consumers are tests only.

## Tests

`app/(dashboard)/dashboard/_lib/__tests__/volumeGroupCap.test.ts` (written
failing-first against the reported reconstruction):
Σ(credit toward G) ≤ Σ(sets touching G) per group and per exercise; header ≡
Σ(panel) pre-rounding for both metrics; 4-set primary+same-group-secondary →
exactly 4 at group; the Shoulders 15.5/15.1 screen → 13.5/13.1 with heads
unchanged (side delts 5 raw / 4.6 eff); RIR-on-top-of-cap; cross-group inflow
uncapped; authored-band ≥ child-band typo guard (both recovery profiles).
