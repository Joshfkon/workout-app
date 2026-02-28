# HyperTrack Refactoring Plan

> **Scope:** Full codebase audit and phased cleanup plan
> **Date:** 2026-02-07
> **Codebase stats:** ~159 components, 36 services (22k LOC), 25 hooks (5.8k LOC), 3 stores, 76 DB migrations, 42 test files (19k LOC)

### Progress Key
- ~~Strikethrough~~ = Completed
- **(PARTIAL)** = Partially completed, see notes
- Unmarked = Not yet started

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Issues](#critical-issues)
3. [Phase 1: Architectural Violations & Data Integrity](#phase-1-architectural-violations--data-integrity)
4. [Phase 2: God Objects & Oversized Files](#phase-2-god-objects--oversized-files)
5. [Phase 3: State Management Consolidation](#phase-3-state-management-consolidation)
6. [Phase 4: Eliminate Code Duplication](#phase-4-eliminate-code-duplication)
7. [Phase 5: Type Safety & Consistency](#phase-5-type-safety--consistency)
8. [Phase 6: Testing & Tooling Improvements](#phase-6-testing--tooling-improvements)
9. [File-Level Issue Index](#file-level-issue-index)
10. [Dependency Graph of Changes](#dependency-graph-of-changes)
11. [Risk Assessment](#risk-assessment)

---

## Executive Summary

The HyperTrack codebase is functionally rich but has accumulated significant technical debt across six areas:

| Area | Severity | Summary | Status |
|------|----------|---------|--------|
| Architectural violations | CRITICAL | 5 services make DB calls, violating the pure-functions rule | **Phase 1.2 not started**; 1.1/1.3/1.4 done |
| God objects | HIGH | 8 files exceed 1,000 lines; `workout/[id]/page.tsx` is 5,646 lines with 73 `useState` hooks | **Not started** (Phase 2) |
| State management | HIGH | 3 competing patterns (Zustand, custom globals, localStorage) for similar concerns | **Not started** (Phase 3) |
| Code duplication | HIGH | Auth user loading duplicated 13 times; fatigue constants defined independently in 2 files | **Mostly done** (4.1-4.4 complete, 4.5 remaining) |
| Type safety | MEDIUM | 24 `any` usages, 6 `as never` assertions, duplicated type definitions | **Partial** (5.1 partial, 5.2-5.4 remaining) |
| Tooling gaps | MEDIUM | Minimal ESLint config, duplicate migration timestamps, missing convenience scripts | **Mostly done** (6.1-6.2 complete, 6.3-6.4 remaining) |

The plan is organized into 6 phases, ordered by risk and impact. Each phase is independently shippable.

---

## Critical Issues

These are the items that should be addressed first due to correctness or deployment risk.

### ~~1. Database migrations have duplicate timestamps~~

~~Four pairs of migration files share identical timestamps. Supabase's migration runner cannot determine execution order for files with the same timestamp, which will break fresh database deployments.~~ **(PARTIAL — see note below)**

~~**Affected files:**~~

| Duplicate Timestamp | File A | File B | Status |
|---------------------|--------|--------|--------|
| `20241218000001` | `add_meals_per_day.sql` | `supersets_dropsets.sql` | ~~Fixed~~ (**Note:** new conflict — `20241218000002_supersets_dropsets.sql` now conflicts with `20241218000002_workout_templates.sql`. Needs rename to `000003`.) |
| `20241221000001` | `ai_exercise_completions.sql` | `user_exercise_preferences.sql` | ~~Fixed~~ |
| `20260110000002` | `preferred_workout_days.sql` | `remove_crash_the_economy_share_type.sql` | ~~Fixed~~ |
| `20260113000001` | `add_monthly_alltime_leaderboards.sql` | `add_session_duration_minutes.sql` | ~~Fixed~~ |

~~**Fix:** Rename the second file in each pair to use the next sequential number (e.g., `000001` → `000002`).~~

### 2. Five services violate the "no DB calls" rule

The `CLAUDE.md` and project conventions require `/services` files to be pure functions with no database access. Five services break this rule:

| Service | Lines | Violation |
|---------|-------|-----------|
| `coachingContextService.ts` | 427 | 10+ Supabase queries (users, training_phases, mesocycles, etc.) |
| `exerciseService.ts` | 882 | Queries `exercises` table with custom caching |
| `equipmentFilter.ts` | 132 | Queries `user_equipment` table |
| `exercisePreferencesService.ts` | 408 | Queries `user_exercise_preferences` with caching |
| `exerciseVarietyService.ts` | 512 | Queries `exercise_variety_preferences` |

**Fix:** Extract all Supabase calls into server actions (`lib/actions/`) or data-fetching hooks. Pass data as arguments to the pure service functions.

### ~~3. Missing `'use client'` directives~~

~~Three hooks are missing the `'use client'` directive despite using browser-only APIs: `useSharedWorkouts`, `useFollow`, `useComments`. This can cause hydration errors in Next.js App Router.~~ **Done** — all three hooks now have `'use client'` at line 1.

---

## Phase 1: Architectural Violations & Data Integrity

**Goal:** Fix correctness issues and align code with documented architecture rules.

### ~~1.1 Fix duplicate migration timestamps~~ **(PARTIAL)**

~~Rename files to sequential timestamps. No schema or data changes needed—only filename changes.~~ **Done** — 3 of 4 pairs fixed. Remaining: `20241218000002_workout_templates.sql` conflicts with `20241218000002_supersets_dropsets.sql` — needs rename to `000003`.

### 1.2 Extract DB calls from services

For each of the 5 violating services, the pattern is:

```
BEFORE (services/equipmentFilter.ts):
  export async function getUnavailableEquipment(userId: string) {
    const supabase = createUntypedClient();
    const { data } = await supabase.from('user_equipment')...
    return filterByEquipment(data);
  }

AFTER:
  // lib/actions/equipment.ts (new server action)
  export async function fetchUserEquipment(userId: string) {
    const supabase = createUntypedClient();
    return supabase.from('user_equipment')...
  }

  // services/equipmentFilter.ts (now pure)
  export function filterByEquipment(exercises: Exercise[], equipment: Equipment[]) {
    // Pure filtering logic only
  }
```

Apply this pattern to all 5 files:

| Service File | New Action File | Data to Extract |
|-------------|-----------------|-----------------|
| `coachingContextService.ts` | `lib/actions/coaching-context.ts` | 10+ queries for coaching context |
| `exerciseService.ts` | `lib/actions/exercises.ts` | Exercise table queries + caching |
| `equipmentFilter.ts` | `lib/actions/equipment.ts` | User equipment queries |
| `exercisePreferencesService.ts` | `lib/actions/exercise-preferences.ts` | Preferences + caching |
| `exerciseVarietyService.ts` | `lib/actions/exercise-variety.ts` | Variety preferences |

### ~~1.3 Add missing `'use client'` directives~~

~~Add `'use client'` to the top of `useSharedWorkouts.ts`, `useFollow.ts`, and `useComments.ts`.~~ **Done.**

### ~~1.4 Fix `workoutStore` Map serialization~~

~~Replace `Map<string, SetLog[]>` and `Map<string, Exercise>` with `Record<string, SetLog[]>` and `Record<string, Exercise>`. Remove the fragile custom `onRehydrateStorage` logic and `as any` type assertions.~~ **Done** — store now uses `Record<string, T>` types.

---

## Phase 2: God Objects & Oversized Files

**Goal:** Break apart files that are too large to understand, review, or maintain.

### 2.1 Pages (App Router)

| File | Current Lines | Target | Split Into |
|------|--------------|--------|------------|
| `workout/[id]/page.tsx` | 5,646 | ~600 | `WorkoutSessionProvider.tsx` (state), `ExerciseSetTracker.tsx`, `WarmupSection.tsx`, `WorkoutCoachPanel.tsx`, `useWorkoutSession.ts` (hook for 73 useState) |
| `workout/page.tsx` | 3,285 | ~400 | `WorkoutList.tsx`, `TemplateSelector.tsx`, `useWorkoutList.ts` |
| `analytics/page.tsx` | 2,593 | ~400 | Extract chart sections into individual components, move data fetching to server actions |
| `workout/new/page.tsx` | 2,400 | ~400 | `NewWorkoutForm.tsx`, `ExerciseSelector.tsx`, `useNewWorkout.ts` |
| `DashboardClient.tsx` | 2,021 | ~300 | `DashboardCardGrid.tsx`, `useDashboardCards.ts` |
| `nutrition/page.tsx` | 1,722 | ~400 | Extract meal logging, macro display, and TDEE sections |
| `exercises/page.tsx` | 1,680 | ~400 | `ExerciseLibrary.tsx`, `ExerciseFilters.tsx` |
| `settings/page.tsx` | 1,516 | ~300 | One component per settings tab |

The highest-priority target is `workout/[id]/page.tsx`. Its 73 `useState` hooks and 18 `useEffect` hooks indicate that the entire workout session state machine should live in a dedicated hook or Zustand store slice, not inline in the page component.

### 2.2 Services

| File | Current Lines | Target | Split Into |
|------|--------------|--------|------------|
| `mesocycleBuilder.ts` | 1,615 | ~400 each | `periodizationPlanner.ts`, `volumeDistributor.ts`, `mesocycleFormatter.ts` |
| `weightEstimationEngine.ts` | 1,554 | ~400 each | `weightEstimator.ts`, `strengthAnalyzer.ts` (keep `shared/strengthCalculations.ts`) |
| `progressionEngine.ts` | 1,494 | ~400 each | `progressionCalculator.ts`, `setQualityClassifier.ts`, `warmupProtocol.ts` |
| `sessionBuilderWithFatigue.ts` | 1,297 | ~400 each | `sessionBuilder.ts`, `fatigueAwareScheduler.ts` |
| `coachingEngine.ts` | 1,105 | ~400 each | `benchmarkData.ts` (static data), `coachingLogic.ts` |

### 2.3 Components

| File | Current Lines | Target | Split Into |
|------|--------------|--------|------------|
| `ExerciseCard.tsx` | 2,908 | ~300 each | `ExerciseCardHeader.tsx`, `SetInputSection.tsx`, `SetFeedbackPanel.tsx`, `WarmupDisplay.tsx`, `exerciseCardUtils.ts` |
| `ExerciseDetailsModal.tsx` | 1,621 | ~400 each | `ExerciseHistoryChart.tsx`, `ExerciseDetailsContent.tsx` |
| `AddFoodModal.tsx` | 1,348 | ~400 each | `FoodSearchTab.tsx`, `ManualEntryTab.tsx`, `BarcodeScanTab.tsx` |
| `ImportExportSettings.tsx` | 1,122 | ~400 each | `ImportHandler.tsx`, `ExportHandler.tsx` |

---

## Phase 3: State Management Consolidation

**Goal:** Eliminate competing state management patterns. Use Zustand consistently.

### 3.1 Problem: Three patterns for the same concern

Currently the codebase uses three different state management approaches:

1. **Zustand stores** (`userStore`, `workoutStore`, `exerciseStore`) — with `persist` middleware
2. **Custom global listeners** (`useSubscription`, `useUserPreferences`, `useExercisePreferences`) — hand-rolled pub/sub with `sessionStorage` or module-level variables
3. **localStorage directly** (`useRestTimer`, `useWorkoutTimer`, `useDurationTimer`) — manual read/write

Pattern #2 reimplements what Zustand already provides. Pattern #3 is acceptable for timers but inconsistent with the rest of the app.

### 3.2 Migration plan

| Current Hook | Current Pattern | Target |
|-------------|----------------|--------|
| `useSubscription` (299 lines) | Custom global + sessionStorage | New `subscriptionStore.ts` (Zustand + persist) |
| `useUserPreferences` | Custom global listeners | Merge into existing `userStore.ts` |
| `useExercisePreferences` (287 lines) | Custom global + Map cache | New `exercisePreferencesStore.ts` (Zustand + persist) |

For each migration:
1. Create the Zustand store with `persist` middleware
2. Move the fetch logic into a store action
3. Update all consumers to use the store selector
4. Delete the old hook

### 3.3 Standardize hook return shapes

Adopt a consistent return type for all data-fetching hooks:

```typescript
interface HookResult<T> {
  data: T;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}
```

Currently, hooks use inconsistent names (`refetch` vs `refresh` vs `revalidate`), inconsistent loading granularity (single boolean vs per-field), and inconsistent error handling (some set error state, some silently log, some ignore).

---

## Phase 4: Eliminate Code Duplication

### ~~4.1 Auth user loading (duplicated 13 times)~~

~~Create a shared hook:~~

```typescript
// hooks/useAuthUser.ts — CREATED
export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createUntypedClient();
    supabase.auth.getUser()
      .then(({ data: { user }, error }) => { /* ... */ })
      .finally(() => setIsLoading(false));
  }, []);

  return { user, isLoading, error };
}
```

**Done** — `hooks/useAuthUser.ts` created and integrated into:
~~`useAdaptiveVolume`~~, ~~`useMuscleRecovery`~~, ~~`useActivityFeed`~~, ~~`useSharedWorkouts`~~, ~~`usePWA`~~, ~~`useSubscription`~~, ~~`useUserPreferences`~~, ~~`useComments`~~, ~~`useReactions`~~, ~~`useFollow`~~

**Remaining (not yet integrated):** `useWeeklyVolume`, `useProgressionTargets`, `useBestLifts`

### ~~4.2 Profile fetching (duplicated 4 times)~~

~~Create a shared utility:~~

```typescript
// lib/profiles.ts — CREATED
export async function fetchUserProfiles(supabase, userIds, fields = 'basic') { ... }
```

**Done** — `lib/profiles.ts` created with `fetchUserProfiles` (supports `'basic'` and `'full'` field modes). Integrated into:
~~`useActivityFeed`~~, ~~`useSharedWorkouts`~~, ~~`useComments`~~

**Remaining (not yet integrated):** `useLeaderboard`

### ~~4.3 Fatigue constants (defined independently in 2 files)~~

~~Both `fatigueEngine.ts` and `fatigueBudgetEngine.ts` define `MOVEMENT_FATIGUE_MULTIPLIERS` and `EQUIPMENT_FATIGUE_MULTIPLIERS` with slightly different values.~~

~~**Fix:** Create `services/shared/fatigueConstants.ts` with a single canonical definition. Audit which values are correct and consolidate.~~ **Done** — `services/shared/fatigueConstants.ts` created with canonical constants. Both engines now import from the shared file.

### ~~4.4 `calculateE1RM` (duplicated 3+ times)~~

~~This function is defined inline in `ExerciseCard.tsx`, `ExerciseDetailsModal.tsx`, `SessionSummary.tsx`, and `workout/[id]/page.tsx`. It already exists in `services/progressionEngine.ts`.~~

~~**Fix:** Delete all inline copies. Import from the service.~~ **Done** — `services/shared/strengthCalculations.ts` created with canonical `estimate1RM` and `estimateE1RMSimple`. Inline copies replaced with imports.

### 4.5 Caching logic (reimplemented 3 times)

`exercisePreferencesService.ts`, `exerciseVarietyService.ts`, and `exerciseService.ts` each implement their own `Map` + TTL caching.

**Fix:** After Phase 1 moves DB calls out of these services, caching should live in the new server actions or in a shared `lib/cache.ts` utility:

```typescript
// lib/cache.ts
export function createTTLCache<K, V>(ttlMs: number) {
  const cache = new Map<K, { value: V; expires: number }>();
  return {
    get(key: K): V | undefined { /* ... */ },
    set(key: K, value: V): void { /* ... */ },
    invalidate(key: K): void { /* ... */ },
  };
}
```

---

## Phase 5: Type Safety & Consistency

### 5.1 Remove duplicate type definitions **(PARTIAL)**

| Type | Defined In | Duplicate In | Action | Status |
|------|-----------|-------------|--------|--------|
| `Equipment` | `types/schema.ts` | `types/training.ts` | ~~Delete from `training.ts`, re-export from `schema.ts`~~ | **Kept local** — re-exporting breaks `Record<Equipment, number>` indexing (TS7053 bug). Both definitions are identical. |
| `MovementPattern` | `types/schema.ts` | `services/coachingEngine.ts` | ~~Delete from service, import from types~~ | ~~**Done**~~ |
| `InjuryArea` | (should be shared) | `services/injuryAwareSwapper.ts` | ~~Move to `types/training.ts`~~ | ~~**Done**~~ |
| Exercise-related types | `types/schema.ts` | `types/database-queries.ts`, `lib/exercises/types.ts` | Consolidate: keep canonical in `schema.ts`, keep DB-specific in `database-queries.ts` | **Not started** |

### 5.2 Eliminate `as never` assertions (6 occurrences)

These appear in hooks that query Supabase tables not yet added to the typed schema:

```typescript
// Current (unsafe)
.from('activities' as never)
.from('shared_workouts' as never)
.rpc('calculate_weekly_volume_leaderboard' as never)
```

**Fix:** Update `types/database.ts` to include the missing table definitions. Then remove all `as never` casts.

### 5.3 Reduce `any` usage (24 occurrences across 9 files)

| File | Count | Recommended Fix |
|------|-------|----------------|
| `lib/actions/dashboard.ts` | 6 | Type the Supabase query results properly |
| `lib/migrations/migrateBodyweightSets.ts` | 5 | Type migration data shapes |
| `lib/integrations/capacitor-stub.ts` | 5 | Keep (intentional for optional dynamic imports) |
| `lib/workout-sharing.ts` | 3 | Type the Supabase client parameter |
| `lib/actions/exercise-completion.ts` | 2 | Type AI response shape |
| Others | 3 | Case-by-case |

### 5.4 Standardize class vs function pattern in services

6 services use classes; 30 use pure functions. The project convention favors pure functions.

**Recommendation:** Keep classes only for services that genuinely need stateful tracking across multiple calls (e.g., `PerformanceTracker`, `SessionFatigueManager`). Convert the rest to function-based patterns. Document the guideline: "Use a class only when tracking accumulated state across a session; otherwise use exported functions."

---

## Phase 6: Testing & Tooling Improvements

### ~~6.1 Expand ESLint configuration~~

~~Current config is just `next/core-web-vitals`. Add:~~

```json
{
  "extends": "next/core-web-vitals",
  "rules": {
    "complexity": ["warn", 20],
    "max-lines": ["warn", 600],
    "no-console": ["warn", { "allow": ["error", "warn"] }]
  }
}
```

~~The `max-lines` rule will flag future god objects before they grow.~~ **Done** — added `complexity`, `max-lines`, `no-console` rules. Also added service-specific `no-restricted-imports` override to prevent Supabase imports in `/services`. (`import/order` rule skipped — requires additional ESLint plugin.)

### ~~6.2 Add missing npm scripts~~

```json
{
  "lint:fix": "next lint --fix",
  "lint:services": "next lint --dir services",
  "type-check": "tsc --noEmit",
  "db:push": "npx supabase db push",
  "db:reset": "npx supabase db reset"
}
```

**Done** — all scripts added to `package.json`, including bonus `lint:services` for targeted service linting.

### 6.3 Add per-route error boundaries

Currently only root-level `error.tsx` and `global-error.tsx` exist. Add `error.tsx` files to:
- `app/(dashboard)/dashboard/workout/error.tsx`
- `app/(dashboard)/dashboard/analytics/error.tsx`
- `app/(dashboard)/dashboard/nutrition/error.tsx`

These should provide route-specific recovery actions (e.g., "Retry loading workout" rather than a generic error page).

### 6.4 Convert large client-side pages to server-side data fetching

The main dashboard page (`dashboard/page.tsx`) correctly uses the server component pattern with `Promise.all` for parallel fetching and passes data as props. Most other pages use client-side `useEffect` fetching instead.

**Target pages for conversion:**
- `workout/page.tsx` — fetch recent workouts + templates on server
- `analytics/page.tsx` — fetch DEXA scans + body composition on server
- `nutrition/page.tsx` — fetch today's meals + macro targets on server
- `exercises/page.tsx` — fetch exercise library on server

This eliminates loading spinners on initial navigation and reduces client bundle size.

---

## File-Level Issue Index

Quick reference for every file mentioned in this plan, sorted by priority.

### CRITICAL

| File | Issue | Phase | Status |
|------|-------|-------|--------|
| ~~`supabase/migrations/20241218000001_supersets_dropsets.sql`~~ | ~~Duplicate timestamp~~ | ~~1.1~~ | ~~Done~~ (but new conflict at `000002` — see 1.1) |
| ~~`supabase/migrations/20241221000001_user_exercise_preferences.sql`~~ | ~~Duplicate timestamp~~ | ~~1.1~~ | ~~Done~~ |
| ~~`supabase/migrations/20260110000002_remove_crash_the_economy_share_type.sql`~~ | ~~Duplicate timestamp~~ | ~~1.1~~ | ~~Done~~ |
| ~~`supabase/migrations/20260113000001_add_session_duration_minutes.sql`~~ | ~~Duplicate timestamp~~ | ~~1.1~~ | ~~Done~~ |
| `services/coachingContextService.ts` | DB calls in service | 1.2 | Not started |
| `services/exerciseService.ts` | DB calls in service | 1.2 | Not started |
| `services/equipmentFilter.ts` | DB calls in service | 1.2 | Not started |
| `services/exercisePreferencesService.ts` | DB calls in service | 1.2 | Not started |
| `services/exerciseVarietyService.ts` | DB calls in service | 1.2 | Not started |

### HIGH

| File | Issue | Phase | Status |
|------|-------|-------|--------|
| `app/(dashboard)/dashboard/workout/[id]/page.tsx` | 5,646 lines, 73 useState | 2.1 | Not started |
| `app/(dashboard)/dashboard/workout/page.tsx` | 3,285 lines | 2.1 | Not started |
| `components/workout/ExerciseCard.tsx` | 2,908 lines, 38 useState | 2.3 | Not started |
| `app/(dashboard)/dashboard/analytics/page.tsx` | 2,593 lines | 2.1 | Not started |
| `app/(dashboard)/dashboard/workout/new/page.tsx` | 2,400 lines | 2.1 | Not started |
| `components/workout/DashboardClient.tsx` | 2,021 lines | 2.1 | Not started |
| `app/(dashboard)/dashboard/nutrition/page.tsx` | 1,722 lines | 2.1 | Not started |
| `app/(dashboard)/dashboard/exercises/page.tsx` | 1,680 lines | 2.1 | Not started |
| `services/mesocycleBuilder.ts` | 1,615 lines | 2.2 | Not started |
| `services/weightEstimationEngine.ts` | 1,554 lines | 2.2 | Not started |
| `services/progressionEngine.ts` | 1,494 lines | 2.2 | Not started |
| `components/workout/ExerciseDetailsModal.tsx` | 1,621 lines | 2.3 | Not started |
| `components/nutrition/AddFoodModal.tsx` | 1,348 lines | 2.3 | Not started |
| `services/sessionBuilderWithFatigue.ts` | 1,297 lines | 2.2 | Not started |
| `hooks/useSubscription.ts` | Custom global pattern (299 lines) | 3.2 | Not started |
| `hooks/useExercisePreferences.ts` | Custom global pattern (287 lines) | 3.2 | Not started |
| ~~`services/fatigueEngine.ts` + `fatigueBudgetEngine.ts`~~ | ~~Duplicated constants~~ | ~~4.3~~ | ~~Done~~ |

### MEDIUM

| File | Issue | Phase | Status |
|------|-------|-------|--------|
| ~~`stores/workoutStore.ts`~~ | ~~Map serialization, `as any`~~ | ~~1.4~~ | ~~Done~~ |
| ~~`hooks/useSharedWorkouts.ts`~~ | ~~Missing `'use client'`~~ | ~~1.3~~ | ~~Done~~ |
| ~~`hooks/useFollow.ts`~~ | ~~Missing `'use client'`~~ | ~~1.3~~ | ~~Done~~ |
| ~~`hooks/useComments.ts`~~ | ~~Missing `'use client'`~~ | ~~1.3~~ | ~~Done~~ |
| `types/training.ts` | Duplicate `Equipment` type | 5.1 | **Kept local** (re-export breaks TS) |
| `types/database.ts` | Missing table definitions (causes `as never`) | 5.2 | Not started |
| `lib/utils.ts` | God file (652 lines, 38 exports) | 4 | Not started |
| `services/coachingEngine.ts` | 1,105 lines, inline benchmark data | 2.2 | Not started |
| `lib/training/programEngine.ts` | Overlaps with `services/progressionEngine.ts` | 5 | Not started |

---

## Dependency Graph of Changes

Phases are ordered so that later phases build on earlier ones:

```
Phase 1 ─── Fix migrations (independent)
   │
   ├── Extract DB calls from services
   │     │
   │     └── Phase 4.5 ─── Consolidate caching (needs DB calls extracted first)
   │
   └── Fix workoutStore Maps
         │
         └── Phase 3 ─── State management consolidation (needs clean stores)

Phase 2 ─── Split god objects (independent, but easier after Phase 1)
   │
   └── Phase 4.1-4.4 ─── Eliminate duplication (easier after files are smaller)

Phase 5 ─── Type safety (independent, but smoother after Phase 1-2)

Phase 6 ─── Tooling (independent, can run in parallel with any phase)
```

**Phases that can run in parallel:**
- Phase 1.1 (migrations) + Phase 1.3 (use client) + Phase 6 (tooling)
- Phase 2.1 (pages) + Phase 2.2 (services) + Phase 2.3 (components) — different files
- Phase 5 can start once Phase 1.2 is done

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Renaming migration files | LOW | Only affects fresh DB deployments; existing DBs track applied migrations by content hash |
| Extracting DB calls from services | MEDIUM | May break callers that expect async service functions. Audit all import sites. Run full test suite after each file. |
| Splitting god object pages | HIGH | `workout/[id]/page.tsx` has 73 interlinked state variables. Extracting state into a hook requires careful dependency mapping. Test manually by completing a full workout session. |
| Zustand migration from custom globals | MEDIUM | Subscribers may behave differently with Zustand's shallow comparison vs custom listener pattern. Add integration tests for subscription tier checks. |
| Removing `as never` / fixing types | LOW | Adding proper types is additive; removing `as never` will surface real type errors that were being hidden. |
| Splitting `ExerciseCard.tsx` | HIGH | Most-used component in the app (renders during every workout). Regression risk is high. Needs thorough manual testing of set logging, RPE input, warmup display, and injury warnings. |

---

## Summary

The refactoring targets three root causes:

1. **Files grew without being split.** The codebase has 8 files over 1,000 lines and one at 5,646. These are difficult to review, test, and modify safely.

2. **Patterns diverged over time.** State management uses three different approaches. Error handling is inconsistent. Caching is reimplemented per-file. Auth loading is copy-pasted 13 times.

3. **Architectural boundaries eroded.** Services that should be pure functions now make database calls. Pages that should be server components do client-side fetching. Types that should be canonical are duplicated.

The six phases address these causes systematically while keeping each phase independently shippable and testable.
