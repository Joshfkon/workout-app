# HyperTrack Major Refactor Plan

Source: clean-slate review (July 2026). Four workstreams executed in order. Each phase is
independently shippable; phases 1–4 each land as their own PR chain against `main`.

Target visuals: the three approved mockups (home dashboard, set logger, nutrition page).
The mockups define **layout, hierarchy, and components**. Colors map onto the existing
`surface-*` theme system (dark default, light via CSS-variable inversion) using the token
map in "Visual language" below.

---

## Visual language (applies to every phase)

**Token map (mockup → app):**

| Mockup element | App token |
|---|---|
| Phone/page background | `bg-surface-950` |
| Card surface | `bg-surface-900 border border-surface-800` |
| Inner tile / secondary surface | `bg-surface-800/50` |
| Accent fill (buttons, bars, active chips) | `bg-primary-500`, text `text-white` (use theme-safe class per theme-system notes) |
| Accent tint (suggestion banner, badges) | `bg-primary-500/10 text-primary-400` |
| Success / warning / danger | existing `success-*` / `warning-*` / `danger-*` |
| Hairline borders | `border-surface-800` |

**Grammar rules (enforced in Phase 0, swept everywhere):**
- One card style: `rounded-xl border border-surface-800 bg-surface-900 p-4`. No `p-5`/`p-6` variants.
- Type scale: page title 17px/`font-medium`; card title 15px/`font-medium`; body 13px; meta 12px; micro-label 11px `text-surface-500`. No `font-bold` outside stat numbers.
- Icons: `@tabler/icons-react` (outline), 18–20px. **All emoji-as-icon usages removed** (meal emojis, card emojis, tab emojis).
- Progress bars: 4px tall, `rounded-full`, track `bg-surface-800`.
- Pills/chips: `rounded-full px-2.5 py-1 text-[11px]`.
- Status is expressed one way: a tinted pill or a tinted card background — never colored card borders except the single accent-bordered hero.

---

## Phase 0 — Foundations (decomposition + design grammar)

Goal: make phases 1–3 cheap. No behavior change.

### 0.1 Split `app/(dashboard)/dashboard/DashboardClient.tsx` (2,275 lines)
- `components/dashboard/home/GlanceHeader.tsx` — greeting, date, meso week context, readiness pill
- `components/dashboard/home/TodayHeroCard.tsx` — today's workout hero (all 4 states: ready / in-progress / completed / none)
- `components/dashboard/home/MetricTileGrid.tsx` + `MetricTile.tsx`
- `components/dashboard/home/QuickLogRow.tsx`
- `components/dashboard/home/InsightCards.tsx` — atrophy alert, deload alert (Phase 1), check-in prompt
- `hooks/useDashboardGlance.ts` — consolidates the data fetching currently inline in DashboardClient
- Card-order/edit-mode code stays temporarily; deleted in Phase 3.

### 0.2 Split `app/(dashboard)/dashboard/workout/[id]/page.tsx` (3,337 lines)
- `app/(dashboard)/dashboard/workout/[id]/_components/AddExercisePicker.tsx` (search, filters, multi-select — currently inline modal)
- `_components/WorkoutHeader.tsx`
- `_lib/useWorkoutSession.ts` — session load/persist/state machine (extends existing `_lib/sessionWrites.ts` pattern)
- `_lib/suggestions.ts` — coach-message + weight-suggestion glue (wraps `weightEstimationEngine`, `progressionEngine.recommendNextSet`)

### 0.3 Design grammar sweep
- Add `@tabler/icons-react`; replace emoji icons in: dashboard cards, bottom nav, nutrition meal headers, AddFoodModal tabs.
- Normalize all cards to the single card style; single type scale.
- `components/ui/Card.tsx`: remove `padding` prop variants; one default.

**Acceptance:** `npm run build` + `npm test` green; every screen renders identically in structure (visual diff limited to icons/padding normalization).

---

## Phase 1 — Close the auto-regulation feedback loop

Goal: the engines that already exist start changing what the user is told to do. This is the
competitive moat (RP-style adaptive volume + readiness modulation + auto-deload + RIR calibration).

### 1.1 Migration: per-muscle session feedback
`supabase/migrations/20260701000001_session_muscle_feedback.sql`

```sql
CREATE TABLE IF NOT EXISTS session_muscle_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  muscle_group TEXT NOT NULL,
  -- asked at START of the NEXT session hitting this muscle:
  soreness_before SMALLINT CHECK (soreness_before BETWEEN 0 AND 3), -- 0 none, 1 mild, 2 sore, 3 very sore
  -- asked at END of the session that trained it:
  pump SMALLINT CHECK (pump BETWEEN 0 AND 3),        -- 0 none … 3 skin-splitting
  workload SMALLINT CHECK (workload BETWEEN 0 AND 3), -- 0 easy … 3 too much
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (session_id, muscle_group)
);
-- + RLS policies matching existing per-user pattern
```
Types added to `types/schema.ts` (`MuscleFeedback`, 0–3 enums) and `types/database.ts`.

**UI capture (10-second budget):**
- End of session: SessionSummary gains one row per trained muscle — two chip groups (pump, workload). Defaults pre-selected to 1/1; one tap to change; skippable.
- Start of next session: ReadinessCheckIn gains "How sore is X?" chips only for muscles trained in the last 4 days that are on today's menu; writes `soreness_before` onto the *previous* session's row.

### 1.2 New service: `services/weeklyProgressionEngine.ts` (pure)
```ts
export interface WeeklySetAdjustmentInput {
  muscle: StandardMuscleGroup;
  currentWeeklySets: number;
  landmarks: VolumeLandmarks;              // MEV/MAV/MRV for user experience level (or learned muscleTolerance)
  feedback: MuscleFeedback[];              // last week's rows for this muscle
  performanceTrend: 'improving' | 'flat' | 'declining';  // from progressionEngine set-quality + e1rm delta
  weekInMeso: number;
  isDeloadWeek: boolean;
}
export function recommendWeeklySetAdjustment(input: WeeklySetAdjustmentInput):
  { action: 'add' | 'hold' | 'remove'; delta: number; reason: string }
```
Rules (v1, tuned later):
- `isDeloadWeek` → hold.
- soreness ≤ 1 AND workload ≤ 1 AND trend ≠ declining → **add 1 set** (cap at MRV; above MAV require pump ≥ 2).
- soreness == 2 (healed just in time) OR workload == 2 → **hold**.
- soreness == 3 OR workload == 3 OR trend == declining → **remove 1 set** (floor at MEV).
- Missing feedback → hold (never guess upward).

**Wiring:** week-rollover session generation (`sessionBuilderWithFatigue` call site in the mesocycle progression path) applies deltas by adding/removing a set on the highest-SFR exercise for that muscle. Adjustment + reason stored on the block (`suggestionReason` pattern already exists) and surfaced in the workout header ("+1 set chest — recovering well and beating targets").
Add jest coverage threshold entry (70/60/50/70) per CLAUDE.md convention.

### 1.3 Readiness → session modulation
- New pure helper in `services/fatigueEngine.ts`:
  `applyReadinessModulation(targets: { targetRIR: number; sets: number }, readiness: number)` →
  readiness < 40: `targetRIR + 1` and flag `suggestSetReduction: true`; 40–55: `targetRIR + 0.5` (rounded at prescription time); ≥ 55: unchanged.
- Applied in `_lib/suggestions.ts` when the session loads after check-in; banner in WorkoutHeader: "Adjusted for low readiness — targets eased today". Dismissable override ("Train as planned").

### 1.4 Wire the deload
- After session completion (`sessionWrites.ts` already writes `weekly_fatigue_logs`), server action calls `ProgramEngine.checkDeloadTriggers(mesocycleId)` (`lib/training/programEngine.ts:1416` via `lib/training/workoutIntegration.ts:62`).
- Result stored on the mesocycle (`deload_recommended_at`, `deload_reasons jsonb` — small migration `20260701000002_deload_recommendation.sql`).
- Home InsightCards renders: "Fatigue is high — deload recommended" with reasons + CTA "Make next week a deload", which regenerates the coming week using `deloadEngine.getExerciseDeloadMultiplier` per movement pattern.
- Experience gating already in `deloadEngine` (novice 1 trigger, advanced 2+) — keep.

### 1.5 RPE calibration bias → prescriptions
- `rpeCalibration.getAdjustedRIR` output feeds `setPrescription.calculateTargetRIR` and `progressionEngine.recommendNextSet` (bias passed as optional param; only applied at confidence ≥ medium).
- Suggestion reason string mentions it: "target RIR 1 — your AMRAPs show you usually leave 2 extra reps".

### 1.6 E1RM clamp
- In `recommendNextSet` (progressionEngine.ts ~line 240): clamp the rep term to 12 in the Epley anchor (`effectiveReps = min(reps + rir, 12 + rir)` — decide exact form in PR, add regression tests for 15–20-rep sets).

### 1.7 Surface plateau detection
- Exercise card overflow menu shows a badge when `plateauDetector.detectPlateau` fires; tapping opens a sheet listing `generatePlateauSuggestions` with one-tap apply: "switch to 5–8 reps" (updates block rep range) or "swap exercise" (opens existing SwapModal pre-filtered).

### 1.8 Fatigue budget → swap/picker ranking (or delete)
**Recommendation: wire it (small).** `fatigueBudgetEngine` SFR ratings become a sort key + "high fatigue cost" hint in `exerciseSwapper` results and the AddExercisePicker. If descoped, delete the service — no dead engines.

**Acceptance:** simulated 4-week meso (test fixture) shows sets ramping per feedback, deload firing on trigger conditions, and a chronically-sandbagging user getting tighter RIR targets. All existing coverage thresholds hold.

---

## Phase 2 — Set logger rebuild (match mockup 2)

Goal: 1-tap set logging when accepting the suggestion; suggestions visible with reasoning.

### 2.1 New `components/workout/SetLoggerRow.tsx` (replaces SetInputRow + SetFeedbackCard two-phase flow)
Single card, exactly per mockup:
- Row 1: set number · weight stepper (− / value+unit / +, increments from equipment `minIncrementKg`) · reps stepper (±1). Tapping the number itself opens a bare numeric input (keyboard) for direct entry.
- Row 2: `RIR` label + chips `3 2 1 0`, default = predicted RIR from prescription (pre-selected, accent fill); note icon (`IconMessagePlus`) on the right opens a bottom sheet containing **form rating, discomfort logger, and free-text note** (all optional — this is where SetFeedbackCard's content moves).
- Row 3: full-width `Log set` button (`bg-primary-500`). One tap = commit weight/reps/RIR as shown, fire rest timer, advance.
- Completed sets collapse to the compact line per mockup: `✓ Set 1 · 62.5 lb × 9` + right-aligned `2 RIR · stimulative` (quality tag from existing `calculateSetQuality`).
- Pending sets render as muted single lines with target.

### 2.2 `components/workout/SuggestionBanner.tsx`
- Tinted accent strip inside the exercise card: `IconSparkles` + "62.5 lb × 8 @ 2 RIR — +2.5 lb, you hit the top of your rep range twice".
- Reason text produced in `_lib/suggestions.ts` from `recommendNextSet`'s decision branch (maintain / add-weight / reduce) + Phase 1.3/1.5 modifiers.
- `IconInfoCircle` opens a sheet explaining the math (E1RM anchor, target RIR, calibration/readiness adjustments) — this is the trust-building surface.

### 2.3 Header + rest timer + up-next (per mockup)
- `WorkoutHeader`: name, elapsed, "exercise 2 of 6", per-exercise progress segments (completed `success`, active `primary`, pending `surface-800`), compact `Finish` button.
- `RestTimerBar`: slim row — clock icon, progress bar, mm:ss, `+15s`, `Skip`. Replaces the current inline/panel dual mode.
- Up-next list: one row per remaining exercise (name · sets · muscle), drag handle wired to the **existing but unexposed** drag state (`workout/[id]/page.tsx:591`), swipe-left → `Skip today` (block flagged `skipped`, excluded from progression math and summary).

### 2.4 Exercise card header slimmed
- Name + tier pill + one meta line ("Upper chest · last session 60 lb × 9, × 8 @ 2 RIR"). History accordion stays behind a tap. Warmup accordion unchanged.

**Acceptance:** logging a set accepting all defaults = exactly 1 tap; changing RIR = 2; steppers never open the keyboard; SetFeedbackCard deleted; existing set-persistence tests updated and green.

---

## Phase 3 — Home dashboard rebuild (match mockup 1)

Goal: glance view IS the dashboard. ~5 sections, everything above the fold on mobile.

### 3.1 New layout (top → bottom, exactly per mockup)
1. `GlanceHeader`: "Tuesday, Jul 1" (17px) + "Week 3 of 5 · Push Pull Legs" (12px muted) + readiness pill (right, tinted success/warning/danger by score; hidden if no check-in and no prompt pending).
2. `TodayHeroCard`: accent-bordered card — "Today's workout" accent label, name, "6 exercises · ~55 min · muscles", `Start` button (`bg-primary-500`). Divider + one AI coach line (`IconSparkles`) sourced from the existing coach-message generation. States: ready / continue (warning border) / done (success, "View summary") / no plan ("Plan a workout" → mesocycle or quick).
3. `MetricTileGrid` (2×2, gap 10px, tiles `bg-surface-800/50 rounded-lg p-3`, each a `<Link>`):
   - **Nutrition** → `/dashboard/nutrition`: kcal / target, 4px bar, "128g protein · on pace"
   - **Recovery** → recovery detail: "5 ready · 2 sore", per-muscle segment strip (success/warning), "Chest, triceps still sore" (from `useMuscleRecovery`)
   - **Weekly volume** → volume page: sets / target bar, "All muscles above MEV" or worst offender
   - **Weight** → progress: current, trend arrow + weekly delta, "TDEE 2,890 · stable"
4. `QuickLogRow` (4 buttons: Weight, Water, **Food**, Cardio — Tabler icons, open existing modals; Food opens AddFoodModal with meal inferred from time of day).
5. `InsightCards` — render only when triggered: atrophy alert (warning tint, per mockup, with "Add sets" one-tap action wiring into Phase 1.2), deload recommendation (Phase 1.4), daily check-in prompt (compact chip row, replaces the always-on DailyCheckIn card).

### 3.2 Deletions
- The entire ordered card stack + `DEFAULT_CARD_ORDER`, `<details>` collapsed cards, edit mode (reorder/hide + localStorage keys), rest-day card, quick-actions gradient card. `DashboardCard.tsx` wrapper removed.

### 3.3 Relocations (nothing lost, just moved)
- Weight graph, steps/activity, hydration history, cardio history → `/dashboard/analytics` (rename nav label to **Progress**); nutrition page already shows weight trend.
- Hydration/steps/cardio *logging* survives via QuickLogRow modals.

### 3.4 Navigation
- Bottom nav (flat, per mockup — remove raised center button): Home `IconHome`, Train `IconBarbell`, Eat `IconSalad`, Progress `IconChartLine`, More `IconDots` (More = settings, feed, AI coach, learn, science). Sidebar (desktop) mirrors the same five + secondary links.

### 3.5 Desktop
- `max-w-5xl`; ≥`lg`: hero spans full width, tiles go 4-across, insight cards 2-across. No second sidebar of cards.

**Acceptance:** on a 375px viewport, header→hero→tiles→quick-log all visible without scrolling; no data shown twice; Lighthouse/CLS unchanged or better; every relocated feature reachable in ≤2 taps from Progress.

---

## Phase 4 — Nutrition rebuild (match mockup 3)

### 4.1 `components/nutrition/MacroSummaryCard.tsx` (replaces the 4-box grid)
Per mockup: kcal headline + "/ target", right-aligned "1,120 left · ~370 per meal", 5px calorie bar, then 3 mini-columns (Protein/Carbs/Fat: 11px label + 3px bar). Existing remaining-per-meal math reused.

### 4.2 `QuickActionsRow`: Describe · Scan · Search · Meals
- **Describe (new — AI meal parsing).** `lib/actions/nutrition.ts` server action `parseMealDescription(text: string)` → Claude (use a fast/cheap model; consult the claude-api skill for current model id at implementation time) with a strict JSON schema → `{ items: { name, quantity, calories, protein, carbs, fat }[] }` → review list (editable rows, per mockup grammar) → one tap logs all to the selected meal. Server-side only (`ANTHROPIC_API_KEY`); rate-limit per user; feature-gate to the paid tier if desired.
- **Scan**: existing barcode flow. Fixes: on not-found, open CreateCustomFoodModal prefilled with the barcode (wiring the half-built `showCustomForm`); toast "Saved to your foods" after the silent auto-save.
- **Search (unify + wire the dead USDA path)**: one tab merging system foods, custom foods, and `usdaService.searchFoods` (already imported at `AddFoodModal.tsx:9`; `handleSearch` at line 234 is currently unreachable). 300ms debounce; sections: "Your foods" → "Common foods" → "USDA database". Delete the FatSecret service unless a second source is wanted.
- **Meals (saved meals — new)**: migration `20260701000003_saved_meals.sql`: `saved_meals (id, user_id, name, items jsonb, total_calories, total_protein, total_carbs, total_fat, times_logged, created_at)` + RLS. "Save as meal" action on any meal card header; Meals tab lists them, 1 tap logs.

### 4.3 Meal sections (per mockup)
- Compact bordered cards: header "Breakfast · 640 kcal · 42p" + `IconPlus`; rows "name · qty | kcal" (13px/12px). Swipe-to-delete stays; tap row → EditFoodModal.
- Empty meal = dashed-border card with **Copy yesterday** (new: duplicates yesterday's entries for that meal type) + **+ Add**.
- Frequent-food chips row above the meals (existing frequent-foods data, horizontal scroll, 1-tap log to time-appropriate meal).

### 4.4 Page slimming
- Date nav moves into the page header (per mockup); trend graph, weight card, step tracking, TDEE dashboard move below the meals (TDEE stays — it's a differentiator) or to Progress; "Calculate macros" lives behind a settings icon in the header once targets exist (first-run CTA unchanged).

**Stretch (flag, don't block):** fiber tracking column; meal photo capture.

**Acceptance:** log a described meal in ≤4 taps + one sentence; re-log a saved meal in 2 taps; USDA search returns results in the modal; macro summary + first meal visible above the fold at 375px.

---

## Sequencing, testing, rollout

| Phase | Depends on | Rough size |
|---|---|---|
| 0 Foundations | — | 3–5 days |
| 1 Feedback loop | 0 (light) | 1.5–2 weeks (biggest: 1.1/1.2 + tests) |
| 2 Set logger | 0, 1.3/1.5 reason strings | 1 week |
| 3 Home | 0, insight cards from 1.4 | 4–6 days |
| 4 Nutrition | 0 | 1–1.5 weeks |

- Every phase: `npm test` + `npm run build` green; new pure services get jest.config coverage thresholds; UI changes verified at 375px and desktop; `npm run cap:sync` smoke test on iOS before merging (native gating per App Store Path A notes).
- Migrations are additive-only until Phase 3 deletions land; no destructive schema changes anywhere in this plan.
- Suggested PR granularity: 0.1 / 0.2 / 0.3, then 1.1+1.2, 1.3–1.6, 1.7–1.8, then one PR per numbered section in phases 2–4.

## Decisions taken (flag if you disagree)

1. **Edit mode (card reorder/hide) is removed** in Phase 3 — the fixed glance layout replaces it.
2. **Hydration/steps/cardio detail moves to Progress**; logging stays one tap from home.
3. **Fatigue budget engine gets wired into swap/picker ranking** rather than deleted.
4. **FatSecret service is deleted** in Phase 4 (OpenFoodFacts + USDA + system + custom is enough).
5. Mockup visuals are implemented in the existing dark `surface-*` token system (light theme inherits via the existing inversion), not a new palette.
