# Weight/Rep Suggestion Engine Audit

**Date:** 2026-07-18 · **Scope:** read-only diagnosis, no code changed.
All line numbers are against `main` @ `bd960de`.

---

## 1. Summary verdict

**The live engine is genuinely autoregulated, e1RM-anchored double progression — with one
scheduled-linear layer still alive underneath it (the mesocycle block targets), and a
history-fetch cap that can silently knock a well-trained exercise back into aggressive
cold-start mode.**

It is *not* naive linear progression wearing an e1RM costume. The within-session and
session-start recommenders (`services/setRecommender.ts`) hold load by default, bump only on
demonstrated over-performance, honor the logged RIR, cap steps as a percentage, and derive
everything from one Epley curve. That core is sound and, if anything, slightly
**conservative** (a bump requires clearing the top of the range with ≥2 RIR to spare).

The problems are at the edges, not the core:

1. The **mesocycle session builder prescribes `target_weight_kg` blind to direct history**
   (it never passes the user's own e1RM in) and then multiplies by a **scheduled weekly
   intensity modifier** — a fixed-increment layer the UI usually overrides but which is the
   fallback whenever the e1RM anchor is missing.
2. The **batched history query is capped globally (≤120 rows)**, so an infrequently trained
   exercise can arrive with zero history → the card treats it as a **cold start**
   (+15% steps, easy-RIR auto-bumps) for a lift the user has years of data on. This is the
   one real "misread last session" boundary bug found; `localDay` itself is clean — the
   prescription path never uses it.
3. **Five different e1RM formulas** coexist across the surface, so the number driving the
   prescription is not the number displayed, stored, or used by "repeat workout".

Calibration: within a session, well calibrated. Across sessions, the e1RM path re-centers to
mid-range each session rather than letting the lifter run the range to the top — a
philosophical deviation from textbook double progression, but performance-gated, so not
over-aggressive. The genuinely over-aggressive paths are the cold-start misclassification
(#2) and the scheduled block targets (#1).

---

## 2. The actual code paths (what runs, with numbers)

### 2.1 Layer A — mesocycle session build (persisted block targets)

`lib/training/startMesocycleSession.ts`

- Per exercise: `quickWeightEstimate(name, repRange, targetRir, bw, height, bf%, experience,
  undefined, 'kg', undefined /* knownE1RM */, {transferCandidates, targetMeta})`
  (`startMesocycleSession.ts:525`, fallback path `:639`).
  **`knownE1RM` is `undefined`**, `profile.exerciseHistory` is `[]`, and the transfer ladder
  explicitly excludes the same exercise
  (`weightEstimationEngine.ts:203-209`, `!isSameExercise(c.exerciseName, targetName)`), so
  for an exercise the user has trained for years the estimate falls through to
  related-exercise ratios → FFMI/experience strength standards → bodyweight ratios.
- Then: `targetWeight = baseWeight * progressionModifiers.intensityModifier`
  (`startMesocycleSession.ts:550`, `:661`). The modifier is a **pure schedule**:
  linear model `0.85 + progress·0.15` (`services/mesocycleBuilder.ts:725`), block model
  `0.70→1.00` (`:772-793`), deload `0.6` (`:802`) — applied regardless of logged
  performance.
- `target_rir` comes from `services/repRangeEngine.ts:164-172` — a real RIR ramp
  (novice 3→2, intermediate 3→1, advanced 2→0 across the meso), further tightened by
  `sessionBuilderWithFatigue.ts:538-541`
  (`targetRIR + round((1 − intensityModifier)·3)`, clamped 0–4).
- Result stored on `exercise_blocks.target_weight_kg` / `target_rir`
  (`startMesocycleSession.ts:591-592`).

### 2.2 Layer B — workout page load (history → e1RM anchor)

`app/(dashboard)/dashboard/workout/[id]/page.tsx` +
`app/(dashboard)/dashboard/workout/[id]/_lib/suggestions.ts`

- One batched query for all of today's exercises, ordered
  `workout_sessions(completed_at) desc`, **`.limit(min(exerciseIds.length·10, 120))`
  globally** (`page.tsx:1021`).
- `buildExerciseHistories` (`suggestions.ts:285`) groups by exercise (≤10 blocks each),
  drops deload sessions (`suggestions.ts:158`), applies location scoping, and computes:
  - `lastWorkoutSets`: the most recent non-deload session's normal working sets, ordered by
    `set_number` (`suggestions.ts:190-199`);
  - `estimatedE1RM`: **best** e1RM across all kept sets, via a local Brzycki-with-RIR
    (`calculateE1RM`, `suggestions.ts:40-46`), softened −10% if it came from another gym.

### 2.3 Layer C — session-start seed per set slot (what actually pre-fills the inputs)

`components/workout/ExerciseCard.tsx:779-800` → `services/setRecommender.ts:524-619`
(`recommendSeedForSlot`), engine version 3.

- **Set role** first (`services/suggestionEngine/setRoles.ts`): a slot whose
  previous-session load was `< 75%` of that session's top set is a `ramp` set
  (`RAMP_ROLE_MAX_FRACTION = 0.75`, `constants.ts:45`) and is prescribed at
  `57.5%` of today's top working set with **no RIR target and no progression grading**
  (`RAMP_LOAD_FRACTION = 0.575`).
- **Working slot with an e1RM anchor** (`anchorE1RMKg = exerciseHistory.estimatedE1RM`,
  `ExerciseCard.tsx:771`):
  `weight = e1RM / (1 + (midOfRepRange + targetRir)/30)` (inverse Epley,
  `setRecommender.ts:125-127, 484-505`), rounded to the exercise's
  `min_weight_increment_kg` (per-exercise in DB: e.g. Lateral Raise 1.0 kg, Back Squat
  2.5 kg — `supabase/seed.sql`), then **clamped to ±10% of last session's top working
  weight** (`WORKING_WEIGHT_CLAMP_FRACTION = 0.10`, `constants.ts:66`).
- **Working slot with no anchor**: falls back to `recommendSessionStart`
  (`setRecommender.ts:351-368`) — the previous session's corresponding set run through the
  deadband policy below; on a hold, it repeats last session's actual reps.
- `block.targetWeightKg` (Layer A's scheduled number) is only the seed **fallback** when the
  slot seed produced 0 (`ExerciseCard.tsx:718-722, 1509-1518`).
- Effective RIR = calibration-adjusted RIR + readiness delta, clamped 0–4
  (`ExerciseCard.tsx:388-393`).

### 2.4 Layer D — within-session next-set recommendation

`services/setRecommender.ts:241-328` (`recommendSet`), fed by `ExerciseCard.tsx:581-592`.

- Effort ground truth: `resolveLastRir` (`setRecommender.ts:105-113`) — logged
  `feedback.repsInTank` first, then `rpe → rpeToRir`, target RIR only if no signal exists.
- Capacity anchor `e1rm = max(sessionBestE1RM, epley(lastSet))` (`:262`).
- **Weight policy (deadband):**
  - **Increase** only if `lastReps > repMax + 2` (`REP_OVERSHOOT`) **or**
    (`lastReps ≥ repMax` **and** `loggedRIR − targetRIR ≥ 2` (`DEADBAND_RIR`)). New weight
    aims for `repMax @ targetRir` on the curve, capped **+10%/set** (`MAX_STEP_PCT`).
  - **Reduce** if `lastReps < repMin` or `loggedRIR ≤ targetRIR − 2`; aims mid-range,
    capped −30% (`MAX_REDUCE_PCT`).
  - **Otherwise hold.** On a hold, next-set reps = `lastReps + (loggedRIR − targetRIR) −
    max(1, 7%·reps)` (`HOLD_DROP_RATE`, `:311-320`).
- Within-session fatigue is an **input-side e1RM haircut**: −1%/completed set, floor −8%
  (`FATIGUE_E1RM_PER_SET`, `FATIGUE_E1RM_FLOOR`).
- **Cold start** (`exerciseHistory.totalSessions === 0`): step cap widens to **+15%**
  (`COLD_START_STEP_PCT`) and an "easy" rating (RIR ≥ 4) bumps the load even mid-range
  (`COLD_START_EASY_RIR`, `setRecommender.ts:279-297`).

### 2.5 Dead code (documented as retired, still exported)

`progressionEngine.calculateNextTargets` (`progressionEngine.ts:512` — the classic
load→reps→sets hierarchy with `analyzePerformance`'s hit-top-of-range gates),
`recommendNextSet` (`:239`), and `checkForPR` (`:1557`) have **no call sites outside tests
and comments**. Ironically, the compound-vs-isolation progression-priority distinction
(`PHASE_CONFIGS`: hypertrophy `['reps','sets','load']` vs strength `['load','reps']`,
`:391-460`) lives only here, in the dead orchestrator. `SessionSummary.tsx:264` computes PRs
itself; `WeightEstimationEngine.updateFromWorkout`'s 3-session downgrade hysteresis
(`weightEstimationEngine.ts:1630-1687`) is likewise not on the live path.

---

## 3. Principle-by-principle grades

| # | Principle | Grade | Evidence |
|---|-----------|-------|----------|
| 1 | Load bumps earned, not scheduled | **PARTIAL** | Live core: earned, and stricter than classic — a bump needs top-of-range **plus** ≥2 RIR spare, or a +2 rep overshoot (`setRecommender.ts:282`); the e1RM seed only rises if the e1RM rose, clamped ±10% of last top set (`setRecommender.ts:497-501`). **But** (a) `exercise_blocks.target_weight_kg` is `estimate × scheduled intensityModifier` with zero performance input (`startMesocycleSession.ts:550`), and it's the seed fallback; (b) the gate reads **one best set**, not "top of range across the required number of sets" — a single strong top set moves the anchor even if sets 2–4 collapsed; (c) the e1RM path also *lowers* weight ~5% after a grind session instead of holding to accumulate reps — autoregulation, not textbook double progression. |
| 2 | Increment scales to the exercise | **PARTIAL (mostly pass)** | Steps are percentage-capped (+10%, cold-start +15%) and rounded to per-exercise `min_weight_increment_kg` seeded in the DB (1.0 kg isolation, 2.5 kg squat — `seed.sql:113,248`; `setRecommender.ts:288,295`). No flat "+5 lbs" anywhere live. **But** the compound-progresses-load / isolation-progresses-reps distinction exists only in the retired `PHASE_CONFIGS` (`progressionEngine.ts:391`) — the live engine treats a lateral raise and a squat with the same mid-range-recenter policy; `weightEstimationEngine.roundToNearestPlate` ignores the per-exercise increment (hard-coded 2.5 lb / 2.5 kg / 1 kg, `weightEstimationEngine.ts:1406-1419`); missing DB increments default to 2.5 kg (`page.tsx:2802`), coarse for cables. |
| 3 | e1RM as ground truth | **PASS with caveats** | e1RM genuinely drives prescription: the anchor picks the seed weight (`setRecommender.ts:565-584`), the same curve answers every weight edit and next-set rep prediction, and the engine-v3 notes say the fix was precisely "the e1RM that was displayed-but-ignored" (`setRecommender.ts:520-522`). Caveats: **five formulas coexist** — `shared/strengthCalculations.estimate1RM` (avg Brzycki/Epley/Lombardi, RIR capped at 4, reps>12 linear), `suggestions.calculateE1RM` (Brzycki, unclamped RIR), `setRecommender.epleyE1RM` (pure Epley), `lib/utils.estimateE1RM` (Epley clamped to 12 eff. reps, RIR defaulting to 0 = assumes failure — used by `repeatWorkout.ts:79-83`), `progressionEngine.calculateE1RM`. The prescribing number ≠ the displayed/stored number. Also the anchor is **best-of-last-10-sessions with no recency decay** (`suggestions.ts:202-224`) — a 9-session-old peak prescribes today, contained only by the ±10% clamp. |
| 4 | Respects the mesocycle RIR ramp | **PASS** | `block.target_rir` descends across the block (`repRangeEngine.ts:164-172`: 3→2 / 3→1 / 2→0 by experience; plus `sessionBuilderWithFatigue.ts:538-541`), and every weight formula is parameterized on `targetRir`, so week-over-week load rises *because* RIR falls — coherent coupling. Readiness and RPE-calibration further modulate the effective RIR (`ExerciseCard.tsx:388-393`). Caveat: `startMesocycleSession.ts:550` multiplies by `intensityModifier` **on top of** the RIR-driven increase — the same weekly intensification counted twice in stored targets; and the coach-message week is calendar-derived (`page.tsx:1077-1080`) while block targets use session-count `current_week` — two clocks that can disagree after skipped days. |
| 5 | One variable at a time | **PASS** | Hold is the default; when weight moves, reps are re-derived from the same curve (they *drop* as weight rises — `predictRepsAtWeight`, `setRecommender.ts:220-235`), and when weight holds, only the rep expectation shifts. The seed prescribes a rep **range**, never weight+rep targets that both increased. No double-dip path found. |

Bonus check — **does it ignore logged RIR/RPE?** No. `resolveLastRir`
(`setRecommender.ts:105`) makes the logged chip the first-class signal at every read site,
and v3's changelog (`constants.ts:28-32`) exists specifically because an earlier version
graded against target RIR.

---

## 4. Concrete failure modes, ranked by distortion

1. **Mesocycle block targets are history-blind and schedule-driven** —
   `startMesocycleSession.ts:525` (no `knownE1RM`; own-exercise history structurally
   unreachable: empty profile + `weightEstimationEngine.ts:207` same-exercise exclusion)
   then `:550` (`× intensityModifier`). For a trained lifter, the persisted
   `target_weight_kg` is a population/transfer guess on a weekly escalator. Mostly masked by
   Layer C, but it *is* the number used for warmup protocols (`:556-577`), the suggestion
   reason, and the seed fallback whenever the anchor is missing — see #2.
   `SuggestedWorkoutSheet.tsx:549-559` has the identical no-`knownE1RM` call.

2. **Global 120-row history cap can misread a trained exercise as a cold start** —
   `page.tsx:1021`. Rows are ordered by `completed_at` across *all* of today's exercises,
   then capped. An exercise trained less frequently than its session-mates can get zero rows
   → `totalSessions = 0` → `isColdStartExercise = true` (`ExerciseCard.tsx:579`) →
   **+15% step caps and easy-RIR auto-bumps** on a lift with real history, seeded from the
   scheduled Layer-A number. This is the closest thing to the suspected
   "last-session misread" bug — it's a fetch-window boundary, not a `localDay` one.
   (`localDay` is only used by sleep/recovery/BP engines; the prescription path is
   timestamp-ordered and correctly excludes deloads at `suggestions.ts:158`.)

3. **Anchor = max e1RM over ≤10 sessions, no recency weighting** — `suggestions.ts:202-224`.
   After an illness/layoff dip, the stale peak keeps prescribing ~the old level; the ±10%
   clamp against last session's top set is the only containment, and it re-inflates by up to
   +10% every session while the peak stays in the 10-block window. (The 28-day windows and
   3-lower-session hysteresis that would handle this live in `weightEstimationEngine.ts`
   paths the workout page doesn't take.)

4. **e1RM formula divergence (5 variants)** — see grade #3. Concrete effects: the stored
   card e1RM and the prescription e1RM differ by several percent at 8–12 reps (avg-of-three
   vs pure Epley; RIR capped at 4 vs uncapped); `repeatWorkout.ts:79-83` builds
   `knownE1RM` with **RIR ignored** (assumes failure), so repeated workouts under-anchor
   lifters who log honest 2–3 RIR sets. The codebase itself records that this class of
   inconsistency caused the "× 20" rep-display bug (`ExerciseCard.tsx:550-554`).

5. **Single-set gating** — both `recommendSessionStart` and the anchor update key off the
   best/corresponding single set, not "all prescribed sets hit the range top". A lifter who
   hits 12-12-8-6 reads the same as 12-12-12-12 for anchor purposes (the recenter partially
   compensates; the earned-bump semantics don't).

6. **Minor boundary/consistency nits** — `order('workout_sessions(completed_at)', desc)`
   puts a `completed` session with NULL `completed_at` *first* (Postgres DESC = NULLS
   FIRST), making it "last session" with an empty date (`suggestions.ts:188-199`); dual week
   clocks (calendar vs session-count, `page.tsx:1077` vs `startMesocycleSession.ts:417`);
   `lastSessionE1RM` treats missing RPE as "on target" while `suggestions.calculateE1RM`
   treats it as failure — two different assumptions about the same unlogged set.

---

## 5. Recommended fixes (prioritized — none implemented)

1. **Feed direct history into session build.** Pass the exercise's own `estimatedE1RM` as
   `knownE1RM` in `startMesocycleSession.ts:525` (and `SuggestedWorkoutSheet`), and **stop
   multiplying by `intensityModifier`** when the RIR ramp is already driving intensity —
   pick one intensification mechanism. This deletes the only truly scheduled load path.
2. **Fix the history fetch window.** Per-exercise limit (lateral-join / one query per
   exercise / raise cap with per-exercise trim), or before declaring cold start, fall back
   to `fetchExerciseHistory(exerciseId)` (`suggestions.ts:342`) which already does the
   correct per-exercise `limit(10)`. Cold-start aggression should require *proven* absence
   of history.
3. **One e1RM function.** Standardize on the unclamped Epley-with-RIR already used for
   prescription (`setRecommender.ts:120-127`); make display/storage/repeat-workout consume
   it (repeatWorkout must pass RPE). Delete or quarantine the other four.
4. **Recency-bound the anchor.** Window the `estimatedE1RM` max to ~28 days or apply the
   half-life weighting that already exists in `selectBestEstimate`
   (`weightEstimationEngine.ts:1059-1082`), so a stale peak decays instead of prescribing.
5. **Make progression style mechanic-aware.** Port the reps-first-for-isolation intent from
   the dead `PHASE_CONFIGS` into `recommendSeedForSlot`: e.g. isolation slots target the
   *top* of the range before the weight recenters; compounds keep mid-range recentering.
   Optionally gate the anchor bump on ≥N sets reaching the range top for stricter
   double-progression semantics.
6. **Delete the dead engines** (`calculateNextTargets`, `recommendNextSet`, `checkForPR`,
   unused hysteresis) or move them out of `/services` — they encode a *different*
   progression philosophy and are a standing trap for future wiring (CLAUDE.md already
   declares them retired).
7. **Small ones:** NULLS-LAST tiebreak on the history order; unify the week clock; use
   per-exercise increments in `roundToNearestPlate`; align the two missing-RPE assumptions.
