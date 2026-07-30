# Fatigue-Model Inventory (Part 0 of Fatigue-Aware Prescription)

**Status: audit deliverable — read-only survey, no code changed.**
Produced for the "Fatigue-Aware Prescription (separate prescription from progress
metric)" task. Parts 2–5 of that task must not begin until this inventory has been
reviewed; the proposed consolidations in §6 are the review decisions.

The app contains **eleven distinct implicit fatigue models** (plus two stimulus/display
models that are deliberately *not* fatigue models but define the terms fatigue models
need). They do not share state; several define the same concept — "near failure",
"effective set", secondary-muscle involvement, recovery time — with different constants.
Each instance below records: location, inputs, verbatim constants, its definition of the
shared concepts, and the surface it drives.

---

## 1. Within-session models (the prescription path — where Parts 1–2 land)

### 1.1 `fatigueAdjustedE1RM` — per-exercise e1RM haircut
- **Where:** `services/setRecommender.ts:776-779`; constants `services/suggestionEngine/constants.ts:222-224`.
- **Consumes:** `setsCompletedThisExercise` (count only — no RIR, no muscle, no other exercises).
- **Constants:** `FATIGUE_E1RM_PER_SET = 0.01` (1 %/set), `FATIGUE_E1RM_FLOOR = 0.92` (max −8 %).
  ```ts
  export function fatigueAdjustedE1RM(e1RMKg: number, setsCompleted: number): number {
    const n = Math.max(0, Math.floor(setsCompleted));
    return e1RMKg * Math.max(FATIGUE_E1RM_FLOOR, 1 - FATIGUE_E1RM_PER_SET * n);
  }
  ```
- **Definitions:** no "near failure" concept; every completed set costs the same regardless of RIR. No muscle overlap — blind to everything done on *other* exercises.
- **Drives:** rep prediction on the weight-changed branch and manual weight edits (`predictRepsAtWeight`, `estimateRepsForWeight`).
- **This is already a `workingCapacity` in miniature** — `effective e1RM = e1rm × (1 − discount)` applied to the curve *input*, exactly the shape Part 2 specifies — but scoped to one exercise and RIR-blind. The comment on `PrescribeInput` (`setRecommender.ts:700-706`) states the architecture rule Part 2 must follow: *"every adjustment layer is applied to the INPUTS before the curve is evaluated — never to the output reps/weight."*

### 1.2 `sessionCapacityCapE1RM` (INV-2) — "capped at today's best"
- **Where:** `services/setRecommender.ts:842-865` + the trim in `finalizeRec` (`:978-985`); constants `constants.ts:245,270`.
- **Consumes:** today's logged sets for this exercise, in performed order (weight, reps, RIR).
- **Constants:** `FATIGUE_K = 0.97` (each observation's implied e1RM decays 3 % per set performed since it), `SESSION_CAPACITY_TOLERANCE = 0.01`.
- **Definitions:** RIR enters only through the canonical `impliedE1RMFloor` (effective reps = reps + RIR, Brzycki, capped at 12 effective reps). No muscle overlap — same-exercise only.
- **Drives:** the within-session prescription. **This is Bug A's mechanism:** the cap is correct fatigue detection, but its remedy is `while (reps > 1 && !underCap(reps)) reps -= 1` — reps are truncated at a held load, which is how `45 × 5` shipped against an 8–12 range. Part 1 replaces the sub-floor outcome with a load reduction.

### 1.3 `HOLD_DROP_RATE` — hold-branch rep decline
- **Where:** `services/setRecommender.ts:1311-1320`; constant `constants.ts:201`.
- **Consumes:** last set's reps and RIR-vs-target deviation.
- **Constants:** `HOLD_DROP_RATE = 0.07` (expected rep decline per set at fixed load); shifted by `dev = lastRir − targetRir`.
- **Drives:** next-set rep prefill on the maintain branch. Can and does predict below the range floor (the INV-1 `outsideRange: 'below'` flag, `sessionInvariants.test.ts:184`) — the second producer of sub-floor prescriptions Part 1 must catch.

### 1.4 Set-position matching (Phase A) — fatigue by replay
- **Where:** `services/setRecommender.ts:552-632`.
- **Consumes:** previous session's set at the same position.
- **Model:** *"Last session's set at the SAME position already embeds that session's fatigue shape — no fitted fatigue model needed."* Implicitly assumes the two sessions carry the **same upstream (cross-exercise) fatigue** — precisely the assumption Bug A breaks: when earlier chest work differs between weeks, the positional replay imports last week's fatigue context into a different one. Part 2's accumulator is the missing term.
- **Drives:** within-session targets and session-start seeds.

### 1.5 `recalibrateSessionE1RM` — freshness *credit* (fatigue in reverse)
- **Where:** `services/setRecommender.ts:2132-2149`; constants `constants.ts:172-175`.
- **Constants:** `RECAL_FATIGUE_CORRECTION_PER_SET = 0.02` (+2 %/preceding working set), `RECAL_MAX_FRESHNESS_CORRECTION = 0.08` (cap).
- **Consumes:** working-set position within the exercise.
- **Drives:** the stored e1RM recalibration — a late set's raw e1RM is corrected *upward* for the fatigue it fought through.
- **Direct relevance to Bug B:** this is the one existing mechanism that already tries to keep fatigued observations from depressing the anchor. Note the sign convention: per-set within-exercise fatigue is 2 %/set here, 1 %/set in §1.1, 3 %/set in §1.2 — three different within-session decay constants on the same axis.

### 1.6 Rest prescription — the rest timer's fatigue response
- **Where:** `services/restPrescription.ts:76-103`; constants `constants.ts:348-365`; call site `app/(dashboard)/dashboard/workout/[id]/page.tsx:2228-2241`.
- **Consumes:** resolved RIR of the completed set vs the *effective* target RIR (calibration-adjusted + readiness `rirDelta`).
- **Constants:** `dev ≤ −DEADBAND_RIR (−2)` → `+REST_EXTEND_FAILURE_S (60 s)` with copy *"last set at/near failure"*; `dev ≤ −1` → `+REST_EXTEND_HARD_S (30 s)`; cap `REST_MAX_S = 600`.
- **Definition of "near failure": RELATIVE** — `actualRIR − targetRIR ≤ −2`. A 2-RIR set against a 4-RIR target reads "at/near failure"; a 0-RIR set against a 0-RIR target reads on-target.
- **Drives:** the rest bar (`RestTimer.tsx:83-90`). (The inline set-table timer, `InlineRestTimerBar.tsx`, has no adjustment-note prop — a modulated timer looks stock there.)

### 1.7 AMRAP intra-session rep decay (RPE calibration)
- **Where:** `services/shared/fatigueConstants.ts:74-101` (`AMRAP_DECAY_CONSTANTS`), consumed by `services/rpeCalibration.ts`.
- **Consumes:** intervening working sets of the same exercise, rest durations (timestamps).
- **Constants:** `DECAY_RATE_PER_SET: 0.15` (fraction of implied max reps lost per intervening set), min 1 / max 3 reps per set, total cap 6; rest modulation `≤120 s → ×1.25`, `≥300 s → ×0.75`; Enhanced mode divides decay by 1.225.
- **Drives:** calibration-bias and sandbagging verdicts. A **fourth** within-session same-exercise decay constant (15 %/set in rep space, vs 7 % rep drop, 1 % e1RM, 3 % cap decay).

### 1.8 Warmup engine — session warmth as anti-fatigue state
- **Where:** `services/warmupEngine.ts`.
- **"Working sets already logged" detection (verbatim):** `warmupEngine.ts:556-562` — any completed non-warmup set on the same exercise this session → warmup `'none'` (*"Warmup complete — working sets already logged on this exercise this session."*, `:686-695`).
- **Constants:** `WARMTH_HALF_LIFE_MINUTES = 15` (flagged in-code as "A FITTED CONSTANT ON ZERO USER DATA"), `MUSCLE_TEMP_SATURATION_CREDITS = 1.25`, `PATTERN_SATURATION_CREDITS = 2`, `PAID_THRESHOLD = 0.5`.
- **Muscle overlap — its own third coefficient set:** shared standard primary = 1; sibling sub-muscles = 0.5; secondary match = 0.5 *only when the prior set was a working set*; warmup-type sets half-credit (`:462-482, :586-588`).
- **Drives:** warmup prescription/skip on the workout page.

## 2. Stimulus / display models (define terms; deliberately not fatigue)

### 2.1 Effective volume — THE RIR-proximity weight table
- **Where:** `services/effectiveVolume.ts:28-34`.
  ```ts
  export const EFFECTIVE_VOLUME_WEIGHTS: Readonly<Record<RepsInTank, number>> = {
    0: 1.0, 1: 1.0, 2: 1.0, 3: 0.6, 4: 0.25,
  };
  ```
  Unrated sets are **excluded** (`UNRATED_EXCLUDED = null`), never defaulted.
- **Scope guard (verbatim, `:9-13`):** *"effective volume is a STIMULUS measure only. The readiness / fatigue models (fatigueEngine, fatigueBudgetEngine, muscleRecovery) continue to consume RAW set counts + load — mechanical work drives fatigue regardless of stimulus — and must NOT import these weights for their accumulation math."*
- **Shape:** flat 1.0 across RIR 0–2, dropping only at 3 (0.6) and 4+ (0.25). It measures *stimulus sufficiency* — "did this set count" — not *cost*. It is monotone the wrong way for Part 2: it cannot distinguish a 0-RIR grinder from a 2-RIR set, which is the whole point of `proximityWeight`.
- **Drives:** weekly volume pipeline, volume cards, readiness sheet's volume half, adaptive-volume targeting.
- Legacy divergence: `hooks/useAdaptiveVolume.ts:150-155` still ships a second binary "effective set" (RIR ≤ 3 + clean/some_breakdown form, with the `10 − rpe` fallback the canonical module explicitly refuses) on the same row as the weighted number.

### 2.2 Muscle-attribution / volume credit — THE overlap source of truth
- **Where:** `services/shared/volumeCredit.ts` (canonical), resolvers in `types/schema.ts:2071-2089`.
- **Coefficients (all that exist):** primary = 1.0 (or a legacy coarse split: chest/back ½+½, shoulders ⅓×3 — `LEGACY_PRIMARY_VOLUME_WEIGHTS`, `volumeCredit.ts:99-107`); secondary = `SECONDARY_MUSCLE_CREDIT = 0.5`, *divided* across resolved standards for coarse tags; per-set per-GROUP cap `GROUP_SET_CREDIT_CAP = 1.0` (within-group only).
- **There is no per-exercise contribution fraction anywhere.** `Exercise.primaryMuscle`/`secondaryMuscles` are untyped strings; "Iso-Lateral Incline Press → front delts 0.4" is not currently expressible — the closest the taxonomy gets is "front_delts is a secondary → 0.5".
- **Known duplication (pre-existing):** the `SECONDARY_MUSCLE_CREDIT / standards.length` loop is re-implemented rather than imported in at least four production sites (`services/volumeTracker.ts:168-199`, `hooks/useAdaptiveVolume.ts:183-198`, `lib/training/weeklyRollover.ts:184-195`, `services/mesocycleBuilder.ts:1490-1506`); exercise→muscle *tag data* exists in four copies (seed SQL → generated `SEED_EXERCISE_TAGS` → name-reconciled fallback list; plus the hand-maintained `lib/training/constants.ts` `EXERCISE_DATABASE` that nothing reconciles).

## 3. Between-session / per-muscle recovery models

### 3.1 `muscleRecovery` — the "sore, recovered" line
- **Where:** `services/muscleRecovery.ts` (pure; consumed by `hooks/useMuscleRecovery`, `useMuscleReadiness`, train page, dashboard, workout readiness sheet).
- **Consumes:** per-muscle session history (sets, RIR), time since, sleep (2-night avg), wearable scale, learned per-muscle multipliers, Enhanced flag.
- **Constants (verbatim, `:96-139`):** base windows 48 h (60 h large muscles, 36 h small); `highDoseSetThreshold: 8`, `highDoseHardSetThreshold: 2`, **`hardRirThreshold: 1`**, `highDoseExtraHours: 24`, `lowDoseSetThreshold: 3`, `lowDoseReducedHours: 12`, `recoveringThreshold: 0.6`; sleep `<6 h avg → ×1.15`, `≥8 h → ×0.95`; learned multiplier bounds 0.7–1.5, step 0.05 per soreness answer; Enhanced → windows × 1/1.225.
- **Definition of "hard set" (near failure): ABSOLUTE — RIR ≤ 1** (`:373-376`).
- **Muscle overlap:** primary = 1.0, secondary = `SECONDARY_MUSCLE_CREDIT` (0.5) via `involvementFactor` — but a legacy coarse primary fans out to *every* covered standard muscle at 1.0 each, where volume credit splits it ½/½ or ⅓/⅓/⅓ (a real divergence, §5-C4).
- **Drives:** readiness dots/sheet, "still sore" notes, suggested-workout muscle gating. **Not** consumed by the prescription engine or session builder.

### 3.2 Soreness learning loop
- **Where:** `muscleRecovery.ts:262-275` + `hooks/useRecoveryMultipliers.ts`; same-day "still sore" override forces `fatigued` (`workout/[id]/_lib/readiness.ts:227-233`).
- **Drives:** the per-muscle window multiplier (0.7–1.5). This is the app's only *calibrated-from-user-feedback* recovery constant — the pattern Part 5's telemetry is meant to reproduce for prescription.

### 3.3 Wearable recovery (HRV / resting HR)
- **Where:** `services/wearableRecovery.ts` (`WEARABLE_RECOVERY`, `:22-63`): 14-day median baseline (min 5 samples), HRV −20 % onset / RHR +8 % onset, scale bounds 0.95–1.15, total window-scale cap 1.25; deload evidence after 5 consecutive deviating days (5 pts + 1/day, cap 8).
- **Drives:** recovery-window scaling (into §3.1) and deload evidence. Global scalar; muscle-agnostic.

## 4. Session-planning and week/block models

### 4.1 Readiness harness (`fatigueEngine`)
- **Where:** `services/fatigueEngine.ts`; weights `services/shared/fatigueConstants.ts:108-113`.
- **Consumes:** check-in sleep hours/quality, stress, nutrition, previous-session RPE, days since last session.
- **Constants:** `READINESS_WEIGHTS { sleep: 0.35, stress: 0.25, nutrition: 0.20, recovery: 0.20 }`; sleep sub-score bands (7–9 h = 100 … <5 h = 30, quality ×(0.6+q×0.1)); modulation (`applyReadinessModulation`, `:716-732`): score < 55 → `rirDelta +1`, score < 40 → `rirDelta +1` + suggest set reduction; target adjustment (`adjustTargetsForReadiness`, `:541-588`): ≥60 → RIR +1/rest +30 s; ≥40 → **weight −10 %**, RIR +2, sets −1, rest +60 s; <40 → **weight −20 %**, RIR 4, 2 sets, rest +90 s.
- **Drives:** readiness check-in UI; `readinessModulation.rirDelta` feeds the workout page's `effectiveTargetRirForBlock` — i.e. **readiness already modulates prescription through the target-RIR input**, and compounds into the rest timer's relative "near failure" test. Part 3's `readinessDiscount` multiplier must not double-apply on top of `rirDelta` without accounting for this existing path.
- Also carries a mesocycle fatigue-points accumulator (session RPE → 2–14 points via `FATIGUE_ACCUMULATION`, movement multipliers squat 1.4 / hinge 1.5 / isolation 0.6, recovery `FATIGUE_RECOVERY_RATE = 3`/day × 1.225 enhanced).

### 4.2 Fatigue budget engine (mesocycle generation only)
- **Where:** `services/fatigueBudgetEngine.ts`; sole consumer `services/sessionBuilderWithFatigue.ts` (mesocycle/new).
- **Constants:** systemic cost per pattern (hinge 30, squat 25, lunge 15, h-push 12 … isolation 3); `EQUIPMENT_FATIGUE_MULTIPLIER` (barbell 1.3, dumbbell 1.1, cable 0.8, machine 0.65); volume factor `sets × (1 + (sets−1)×0.1) × 0.15`; intensity factor `1 + (3 − RIR)×0.15` (RIR 0 = 1.45×); position penalty `1 + (position−1)×0.05`; local cost primary `sets×8`, secondary `sets×4`; budget limits systemic 100 / local 80; per-muscle weekly recovery `rate = 30 pts/day` (age/sleep/fiber/enhanced-scaled); readiness gate `currentFatigue < 25`.
- **Definition of near failure:** `rirTarget ≤ 1` adds +0.5 recovery days (a third absolute-RIR threshold).
- **Muscle overlap: a SECOND coefficient system** — secondary = 0.5 × primary but in absolute points (`sets×4` vs `sets×8`), with legacy primaries collapsed to a *single* standard muscle (unlike both volume credit and muscleRecovery). Its `recoveryDays` output has **no consumer**; its weekly tracker records primary local cost only.
- **Drives:** exercise selection/ordering and set counts at mesocycle *generation* time (`currentFatigue > 50 → skip muscle`, `> 25 → trim sets`). Never touches live prescription.

### 4.3 Deload / week-level accumulated fatigue
- **Where:** `services/deloadEngine.ts` + the **duplicate production path** `lib/training/programEngine.ts:1417-1532`; weekly ramp `services/weeklyProgressionEngine.ts` + `lib/training/weeklyRollover.ts`.
- **Key constants:** triggers (perceived fatigue ≥4 then ≥3; sleep ≤2 twice; missed reps >5; joint-pain score ≥4; overdue = deloadFrequency+2); `DELOAD_THRESHOLDS { fatigueScore: 75, missedTargets: 3, rpeCreep: 1.5 }`; `DELOAD_MODIFIERS` volume/intensity/full; weekly set ramp +1 (natural) / +2 (enhanced, `ENHANCED_WEEKLY_SET_INCREMENT`), remove on soreness/workload = 3, hold on = 2, MRV ceiling, above-MAV pump gate.
- **Pre-existing divergences found (flagged, not fixed here):** the two deload detectors disagree on the novice rule (services: novice deloads on ≥1 reason; programEngine: novice *requires* ≥2 — inverted) and programEngine lacks TRIGGER 6 entirely; `deloadEngine.getDeloadStrategy` (advanced → reactive) contradicts `mesocycleBuilder.buildPeriodizationPlan:683` (novice → reactive); deload-frequency for trainingAge ≥ 5 goes *up* in deloadEngine (+1, "tolerate longer blocks") and *down* in mesocycleBuilder (−1, "need more frequent deloads"); auto-logged `missedReps`/`strengthDecline` are hardwired 0/false (`sessionWrites.ts:202-203`), so TRIGGER 2 is dead on the auto path.
- **Drives:** deload recommendation banner and program rewrite. `recommendSet` already accepts the result as an explicit `regressionDirective: 'deload' | 'readiness' | 'phase'` (`setRecommender.ts:149`) — the pre-built junction where week-level models legitimately reach prescription.

### 4.4 Enhanced Athlete Mode — recovery-rate assumptions
- **One constant:** `ENHANCED_RECOVERY_MULTIPLIER = 1.225` (`fatigueConstants.ts:45`), used three ways: recovery windows × 1/1.225 (muscleRecovery), recovery points-rate × 1.225 (fatigueEngine / budget tracker), AMRAP decay ÷ 1.225 (rpeCalibration). Fatigue *accumulation* per set is deliberately unchanged.
- Volume side: tiered `ENHANCED_MRV_MULTIPLIERS` (1.15/1.25/1.35), `ENHANCED_MAV_MULTIPLIER = 1.1`, MEV never scaled, +1 accumulation week, +0.1 ramp bonus.
- **Implication for Part 2:** the session-fatigue accumulator is *within-session*, so the enhanced recovery multiplier (a *between-session* time constant) must NOT enter `sessionFatigueDiscount`. Anything Part 2 later adds about between-session carry-over must read this constant, not invent a new one.

---

## 5. The five required answers

### A. Where do RIR-proximity weights already exist?
Two places, measuring different things:

1. `EFFECTIVE_VOLUME_WEIGHTS` (`services/effectiveVolume.ts:28`) — **stimulus** weights `{0:1.0, 1:1.0, 2:1.0, 3:0.6, 4:0.25}`, flat across RIR 0–2, with an explicit scope guard forbidding fatigue models from importing them.
2. `EFFECTIVE_VOLUME_WEIGHTS`' inverse does **not** exist for cost: nothing weights a set's *fatigue cost* by RIR proximity. The nearest analogues are the budget engine's intensity factor `1 + (3 − RIR)×0.15` (linear, generation-time only) and the rest timer's two-step relative deadband.

**Conclusion:** the task's `proximityWeight()` table (3+: 0.5, 2: 1.0, 1: 1.6, 0: 2.4) **cannot reuse** `EFFECTIVE_VOLUME_WEIGHTS` — the existing table is a stimulus-sufficiency plateau (flat 0–2 by design) and its own scope guard says fatigue must not import it. A new, separate **cost** table is correct and is not a duplicate: it should live beside the stimulus table (see §6) with cross-referencing comments so the two curves are reviewed together, but they are different quantities and must not be merged.

### B. Where does exercise→muscle overlap already exist?
`services/shared/volumeCredit.ts` is the declared single source (`perSetCredits`: primary 1.0 / legacy split, secondary 0.5 ÷ fan-out, group cap 1.0), reused by `muscleRecovery.secondaryDoseFactor`. **The taxonomy cannot currently express per-exercise fractions** ("iso-lateral incline → front delts 0.4"); the only available coefficients are the categorical 1.0/0.5. Per the task's own rule ("if the taxonomy cannot express this, add the coefficient to the taxonomy"), Part 2's `overlap()` must call `perSetCredits` — giving Arnold press → front_delts 1.0, incline press → front_delts 0.5, cable fly → front_delts 0.5-if-tagged-secondary — and accept the coarser 0.5 instead of the illustrative 0.4/0.1 until a per-exercise coefficient column is added to the taxonomy itself (not to the fatigue module). Note the illustrative target for cable fly (~0.1) is *not* representable today: if that fidelity is required in v1, the schema change (a per-pair involvement fraction on the exercise's secondary tags) is a prerequisite, and it belongs in `types/schema.ts`/seed data, not in a new coefficient table inside the accumulator.

### C. What is the existing definition of "near failure"?
Four, mutually inconsistent:

| Site | Definition | Type |
|---|---|---|
| Rest prescription (`restPrescription.ts:88`) | `actualRIR − targetRIR ≤ −2` (note copy: "at/near failure") | **relative** |
| Sanity checks (`sanityChecks.ts:252`) | `reportedRIR ≤ 1` | absolute |
| Muscle recovery `hardRirThreshold` (`muscleRecovery.ts:123`) | `RIR ≤ 1` | absolute |
| Fatigue budget recovery bump (`fatigueBudgetEngine.ts:171`) | `rirTarget ≤ 1` | absolute (on *target*, not actual) |

The same set can be "near failure" under one and not another (RIR 1 vs a 1-RIR target: sanityChecks/muscleRecovery say yes, rest prescription says on-target). The Part 2 accumulator's `proximityWeight` is a *graded* function of absolute RIR, which is consistent with the absolute-threshold family (RIR ≤ 1 ⇔ weight ≥ 1.6) and sidesteps the binary question. The rest timer's relative definition serves a different question ("did this set exceed its plan") and can stand, but the conflict between it and the absolute definitions should be acknowledged in code comments at both sites.

### D. Is there a conflict?
Yes — several, in two classes.

**Class 1: conflicts inside the feature's own blast radius (resolve before/with Part 2):**
1. **Four within-session same-exercise decay constants:** 1 %/set e1RM (`FATIGUE_E1RM_PER_SET`), 3 %/set cap decay (`FATIGUE_K`), 7 %/set rep drop (`HOLD_DROP_RATE`), 15 %/set AMRAP rep decay (`DECAY_RATE_PER_SET`) — plus the 2 %/set freshness *credit* (`RECAL_FATIGUE_CORRECTION_PER_SET`). These are different projections of one physical quantity and were tuned independently. Part 2 adds a **cross-exercise** term, which none of them model, so it does not duplicate them — but the accumulator must be documented against this list so the next reader knows which constant models what, and Part 5's telemetry is the instrument that can eventually reconcile them.
2. **Secondary-involvement coefficients:** 0.5 set-credit (volume/recovery) vs `sets×4`-points (budget engine) vs 0.5-working-sets-only (warmup engine). Part 2 must use the volume-credit 0.5, not add a fourth.
3. **"Near failure"** — see C.

**Class 2: pre-existing conflicts adjacent to but outside this feature (file as bugs; do not fix in this task):**
4. Duplicate deload detectors with an inverted novice rule (`deloadEngine` vs `programEngine`); contradictory deload strategy and deload-frequency-by-training-age rules (§4.3).
5. `muscleRecovery`'s legacy-primary fan-out (1.0 to every covered standard) vs volume credit's weighted split (½/⅓) — recovery over-doses coarse-tagged exercises relative to volume accounting.
6. Legacy binary "effective set" (`useAdaptiveVolume.ts:150`, with the forbidden `10 − rpe` fallback) shipping beside the canonical weighted metric; four stale doc comments still describing the retired "unknown RIR weighs 1.0" rule.
7. Dead code: `fatigueBudgetEngine.recoveryDays` (computed, never read), unreachable `age >= 55` branch (`fatigueBudgetEngine.ts:207-215`), `weekInMeso` accepted-but-unread (`weeklyProgressionEngine.ts:57`), auto-log `missedReps`/`strengthDecline` hardwired to 0/false.

### E. What should be consolidated vs left alone?
Minimum consolidation that prevents divergence:

**Consolidate / build on (in this task):**
- Put `proximityWeight()` and the discount buckets in **`services/shared/fatigueConstants.ts`** (the file that already exists for exactly this purpose), exported as named constants, with a comment cross-referencing `EFFECTIVE_VOLUME_WEIGHTS` (stimulus ≠ cost) and the §D-1 constant list.
- `overlap()` = `services/shared/volumeCredit.ts` `perSetCredits` — no new table. If per-exercise fractions are required, extend the taxonomy (schema + seed), not the accumulator.
- The discount applies as an input-side e1RM multiplier exactly like `fatigueAdjustedE1RM` (§1.1) — same layer, composed with it, so there is one architecture for capacity adjustment. Long-term, `FATIGUE_E1RM_PER_SET` (same-exercise, RIR-blind) should become a special case of the muscle-level accumulator; v1 keeps both but documents the overlap and lets Part 5's telemetry decide.
- Readiness stays a separate multiplier (Part 3) wired through the **existing** `regressionDirective`/`rirDelta` junctions, never blended into the session-fatigue number.

**Leave alone (working, no overlap with this feature):**
- Rest prescription (its relative deadband serves plan-compliance, not capacity), warmup engine, AMRAP calibration decay, muscleRecovery windows + soreness learning, wearable recovery, deload/weekly-ramp machinery, Enhanced-mode multipliers, effective-volume stimulus weights.

**File as separate bugs (found by this audit, not fixed by this task):**
- The Class-2 items above (§D 4–7), plus the stale `unknown RIR weighs 1.0` doc comments and `volumeTracker`'s missing `unratedSets` surfacing.

---

## 6. Where Parts 1–2 will land (for review)

- **Part 1 (range-floor fix):** `services/setRecommender.ts` `finalizeRec` — when the final within-session prescription's reps sit below the range floor (whether produced by the cap trim §1.2, the hold decline §1.3, or a positional replay §1.4), step the load down the increment grid (respecting `availableIncrementsKg`, bounded by `MAX_REDUCE_PCT`) until predicted reps — from the same curve + cap that produced the sub-floor number — land inside the range. `outsideRange: 'below'` remains as the honest fallback when no achievable load reaches the floor within bounds.
- **Part 2 (accumulator):** new pure service (per-muscle session accumulator + bucket discount), constants in `services/shared/fatigueConstants.ts`, overlap via `volumeCredit.perSetCredits`, applied as an e1RM input multiplier beside `fatigueAdjustedE1RM`; `SetContext` instrumentation stored with each set.
