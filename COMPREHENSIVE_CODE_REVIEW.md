# HyperTrack Comprehensive Code Review

**Review Date:** 2026-01-31
**Reviewed By:** Claude (Software Engineer, QA Engineer, Science-Based Hypertrophy Specialist)
**Codebase Stats:** 414 TypeScript/TSX files, ~68,000 lines of code

---

## Executive Summary

HyperTrack is a well-architected hypertrophy training app with **solid foundational science** and **clean separation of concerns**. The codebase demonstrates excellent understanding of evidence-based training principles, with proper implementation of concepts from Renaissance Periodization, Jeff Nippard's hypertrophy methodology, and Chris Beardsley's Stimulus-to-Fatigue Ratio framework.

However, the codebase has significant **technical debt** in component organization (notably the 2,908-line ExerciseCard), **critical test coverage gaps** (47% of services untested), and **type system inconsistencies** that could lead to runtime errors.

### Overall Scores

| Perspective | Score | Summary |
|------------|-------|---------|
| **Software Engineering** | 7.5/10 | Clean architecture, solid patterns, but over-sized components and some tech debt |
| **Quality Assurance** | 6/10 | Good service tests, but massive UI coverage gaps and missing integration tests |
| **Hypertrophy Science** | 8.5/10 | Excellent fundamentals, minor gaps in autoregulation and frequency optimization |

---

## Table of Contents

1. [Architecture Analysis](#1-architecture-analysis)
2. [Core Service Issues](#2-core-service-issues)
3. [Type System Problems](#3-type-system-problems)
4. [Testing Gaps](#4-testing-gaps)
5. [UI Component Issues](#5-ui-component-issues)
6. [Training Science Assessment](#6-training-science-assessment)
7. [Critical Bugs](#7-critical-bugs)
8. [Recommendations](#8-recommendations)

---

## 1. Architecture Analysis

### Strengths

**Clean Layered Architecture:**
```
Presentation (components, pages)
         ↓
State Management (Zustand stores)
         ↓
Business Logic (pure services)
         ↓
Data Access (Supabase, server actions)
```

- **37 pure service modules** with no database calls
- **3 focused Zustand stores** with proper persistence
- **25 custom hooks** bridging stores and services
- **Server actions** for mutations, keeping concerns separated

**Well-Structured Directories:**
- `/services` - Pure business logic (deterministic, testable)
- `/hooks` - React-specific logic combining stores and services
- `/stores` - Minimal global state with selectors
- `/types` - Comprehensive TypeScript interfaces

### Issues

**1. Giant Components (Critical)**

| Component | Lines | Issue |
|-----------|-------|-------|
| `ExerciseCard.tsx` | 2,908 | 29 useState, 9 useEffect, 54 props |
| `ExerciseDetailsModal.tsx` | 1,621 | Should be split into sub-modals |
| `AddFoodModal.tsx` | 1,348 | Mixing search, scan, and entry logic |
| `ImportExportSettings.tsx` | 1,122 | Multiple concerns |

**2. Service Size Variation**

Some services are appropriately sized (150-400 lines), while others are over-grown:
- `exerciseService.ts` - 2,767 lines (should split)
- `mesocycleBuilder.ts` - 1,955 lines (acceptable for domain complexity)
- `progressionEngine.ts` - 1,555 lines (acceptable)

**3. Dual Database Client Pattern**

Two Supabase clients exist:
- `createClient()` - typed (incomplete)
- `createUntypedClient()` - fully functional

Most code uses the untyped client, losing type safety benefits.

---

## 2. Core Service Issues

### progressionEngine.ts

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| Weight increment contradiction | Lines 603-608 | Medium | 2.5% cap conflicts with 0.5x baseIncrement minimum for light weights |
| No calibration returns 0kg | Lines 243-251 | High | New exercises return 0kg target instead of suggesting starting weight |
| Conservative E1RM too aggressive | Line 268 | Low | 10% markdown may be too harsh for related exercises |
| Deload weight hardcoded | Line 669 | Medium | 40% reduction uniform across all exercise types |
| Inconsistent E1RM methods | Lines 989-991 | High | Uses Epley only here, but 3-formula average elsewhere |

### fatigueEngine.ts

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| Oversleeping not flagged | Lines 85-95 | Medium | 10+ hours sleep shows as "good" (warning sign) |
| Fatigue ignores exercise type | Lines 30-37 | High | Squats and cable flies accumulate same fatigue per RPE |
| No mesocycle context | Lines 162-177 | Medium | Same fatigue score at week 2 vs week 5 triggers same recommendation |

### volumeTracker.ts

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| Secondary muscle credit rounding | Line 177 | Medium | 0.167 credit per set rounds to 0, losing volume tracking |
| No MRV excess warning | Line 189 | High | 150% of MRV shows as number, no critical warning |
| Boundary logic fragile | Lines 240-256 | Low | Edge case when MEV = 80% MAV has ambiguous status |

### mesocycleBuilder.ts

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| Recovery multipliers too harsh | Lines 160-239 | Medium | 55yo + poor sleep = 52.5% volume (may cause detraining) |
| Session time estimation poor | Lines 1191-1196 | Low | Assumes 45s per set, ignores equipment transitions |
| No exercise history | Lines 914-1006 | Medium | Can recommend same exercise 3 mesocycles in row |

### deloadEngine.ts

| Issue | Location | Severity | Description |
|-------|----------|----------|-------------|
| **Novice logic backwards** | Lines 85-92 | **Critical** | Says novices recover faster (opposite is true per sports science) |
| Deload uniform across exercises | Lines 122-138 | Medium | All exercises get same reduction regardless of fatigue source |

---

## 3. Type System Problems

### Critical Inconsistencies

**1. Goal Type Conflict**
```typescript
// types/schema.ts:4
type Goal = 'bulk' | 'cut' | 'maintenance'

// types/training.ts:12
type Goal = 'bulk' | 'cut' | 'recomp' | 'maintain'
```
These are **incompatible**. `maintenance` vs `maintain`, and `recomp` missing from schema.

**2. MuscleGroup Triple System**
- Legacy `MuscleGroup` (deprecated but still used)
- `StandardMuscleGroup` (20 muscles, user-facing)
- `DetailedMuscleGroup` (33 muscles, internal)

Mixed usage causes conversion errors and cognitive load.

**3. PeriodizationPlan Duplication**
Defined separately in both `schema.ts` and `training.ts` with different structures.

### Missing Database Types

| Schema Type | Database Row | Issue |
|-------------|--------------|-------|
| `HypertrophyScore` | Not in database.ts | Type safety lost on load |
| `demoGifUrl`, `youtubeVideoId` | Not in ExerciseRow | Fields won't persist correctly |
| `BodyweightData` | `Record<string, unknown>` | No type safety |

### RIR Value Gap

```typescript
// types/schema.ts:22
type RepsInTank = 0 | 1 | 2 | 4  // Missing RIR 3!
```

Code uses RIR 3 in some places, but type doesn't allow it.

---

## 4. Testing Gaps

### Coverage Statistics

| Category | Tested | Total | Coverage |
|----------|--------|-------|----------|
| Services | 17 | 36 | 47% |
| Hooks | 5 | 20+ | 25% |
| Components | 6 | 145 | 4% |
| Stores | 3 | 3 | 100% |

### Critical Untested Code

**High Priority (>800 lines, business-critical):**
- `measurementImbalanceEngine.ts` (1,247 lines) - Body asymmetry detection
- `coachingEngine.ts` (1,105 lines) - AI coaching logic
- `exerciseService.ts` (882 lines) - Exercise library core
- `bodyProportionsAnalytics.ts` (837 lines) - Body composition analysis

**Untested Hook Categories:**
- All social hooks (`useFollow`, `useReactions`, `useComments`, etc.)
- Volume tracking hooks (`useAdaptiveVolume`, `useWeeklyVolume`)
- Recovery hooks (`useMuscleRecovery`)

**Zero Component Test Coverage:**
- All 11 analytics components
- All 5 coaching UI components
- All 15+ social components
- All nutrition components
- All onboarding components

### Coverage Threshold Issues

Only **8 of 36 services** have coverage requirements in `jest.config.js`. No components have thresholds.

### Missing Test Types

- **Integration tests:** No cross-service tests
- **API route tests:** None
- **Server action tests:** None
- **E2E tests:** None visible

---

## 5. UI Component Issues

### ExerciseCard.tsx - Critical Technical Debt

**Metrics:**
- 2,908 lines
- 29 useState hooks
- 9 useEffect hooks
- 54 props
- Custom memo comparison checking 17 conditions

**Problems:**
- Violates Single Responsibility Principle
- High re-render risk (any of 29 states changes = re-render)
- Impossible to unit test effectively
- Difficult to maintain or debug

**Recommended Split:**
1. `ExerciseCardHeader`
2. `WarmupSetSection`
3. `SetLoggingSection`
4. `ExerciseSwapModal`
5. `SetEditingUI`
6. `ExerciseSummary`

### Accessibility Issues

| Component | Issue | Location |
|-----------|-------|----------|
| ExerciseCard | No ARIA structure on major sections | Throughout |
| ExerciseCard | Modal lacks focus management | Line 2764 |
| ActivityCard | Emoji without aria-hidden | Line 156 |
| Swap Modal | Missing aria-modal attribute | Line 2552 |

### Error Handling Gaps

**ExerciseCard (lines 1011-1018):**
```tsx
console.warn('Invalid edit values:', { editWeight, editReps, editRpe });
// User receives NO feedback - silently fails
```

**SetInputRow (lines 64-66):**
```tsx
if (isNaN(weightNum) || isNaN(repsNum)) {
  return; // Silent failure - no user feedback
}
```

No error boundaries wrap major feature areas.

### Performance Concerns

| Component | Issue | Impact |
|-----------|-------|--------|
| ExerciseCard | `similarExercises` computed every render (15 exercises) | High |
| ExerciseCard | `getExerciseInjuryRiskFromService` called per exercise per render | High |
| ActivityCard | Multiple unnecessary `useCallback` wrappers | Low |

---

## 6. Training Science Assessment

### Excellent Implementations (8.5/10)

**1. MEV/MAV/MRV Volume Landmarks**
- Properly calibrated per experience level
- Aligned with Renaissance Periodization research
- 20-muscle granular tracking
- Accounts for indirect work (0.5 credit for secondary muscles)

**2. RPE/RIR System**
```typescript
SET_QUALITY_THRESHOLDS:
  junk: RPE ≤ 5       // Correct - not stimulative
  effective: RPE 6-7  // Correct - contributes to volume
  stimulative: RPE 7.5-9.5 // EXCELLENT - hypertrophy sweet spot
  excessive: RPE ≥ 10 // Correct - fatigue risk
```

**3. Hypertrophy Scoring (Nippard Methodology)**
- Stretch Under Load (1-5)
- Resistance Profile (1-5)
- Progression Ease (1-5)
- Properly used in exercise selection

**4. Stimulus-to-Fatigue Ratio (Beardsley's SFR)**
- Systemic fatigue by movement pattern
- Equipment modifiers (barbell 1.3x, machine 0.6x)
- Position penalty for later exercises
- Prevents junk volume

**5. Warmup Protocol**
- Empty bar for barbells
- Progressive intensity (30% → 50% → 70% → 85%)
- Proper rep counts and rest periods
- Purpose-driven sets

### Issues Found

**1. Novice Deload Logic Backwards (Critical)**
```typescript
// deloadEngine.ts lines 85-92
// Says novices recover faster - OPPOSITE is true
if (profile.experience === 'novice' && reasons.length < 2) {
  shouldDeload = false;  // WRONG: novices need MORE frequent deloads
}
```

**2. Incomplete Autoregulation**
- Readiness score calculated but rarely triggers adjustments
- Only one adjustment level (very low readiness)
- Missing: HRV, grip strength, soreness as inputs

**3. Missing Frequency Optimization**
- No 48-72hr recovery window enforcement
- Could recommend 3x/week heavy squats for novice
- Doesn't adjust frequency based on approaching MRV

**4. Incomplete Periodization Models**
- DUP referenced but not fully implemented
- Weekly Undulating just toggles high/low
- Block phase ratios hardcoded (always 50/35/15)

**5. Rep Ranges**
- Phase-adjusted ranges can exceed research optima (15+ reps for isolation)
- No cap at evidence-based maximums

---

## 7. Critical Bugs

### Bug 1: Novice Deload Logic Inverted

**File:** `services/deloadEngine.ts:85-92`

**Current Behavior:** Novices require more deload triggers before deloading.

**Science:** Novices recover **slower** due to CNS inefficiency. They need **more frequent** deloads.

**Impact:** Novice users pushed into overtraining.

**Fix:**
```typescript
// Remove or invert this condition
if (profile.experience === 'novice') {
  // Novices should deload MORE easily, not less
  if (reasons.length >= 1) shouldDeload = true;
}
```

### Bug 2: Secondary Muscle Volume Rounding Error

**File:** `services/volumeTracker.ts:177`

**Current Behavior:**
```
3 secondary muscles: each gets 0.5/3 = 0.167 credit per set
Math.round(1 × 0.167) = 0
```

**Impact:** Secondary muscle volume systematically undercounted.

**Fix:** Use cumulative addition before rounding, or increase precision.

### Bug 3: New Exercise Returns 0kg Target

**File:** `services/progressionEngine.ts:243-251`

**Current Behavior:** Exercise with no calibration data returns `weightKg: 0`.

**Impact:** Users don't know where to start.

**Fix:** Return suggested starting weight (empty bar or bodyweight).

### Bug 4: Goal Type Mismatch Causes Type Errors

**Files:** `types/schema.ts` vs `types/training.ts`

**Current Behavior:** Two incompatible Goal definitions.

**Impact:** Runtime errors when passing Goal between modules.

**Fix:** Consolidate to single Goal type with all values.

### Bug 5: E1RM Calculation Inconsistency

**Files:** `progressionEngine.ts` (Epley only) vs `plateauDetector.ts` (3-formula average)

**Impact:** Same lift shows different estimated maxes in different screens.

**Fix:** Use single E1RM calculation method everywhere.

---

## 8. Recommendations

### High Priority (Address Immediately)

1. **Fix Novice Deload Logic**
   - File: `deloadEngine.ts:85-92`
   - Impact: Users being overtrained

2. **Split ExerciseCard.tsx**
   - Extract 6-8 focused subcomponents
   - Create shared hook for timer state bundle

3. **Consolidate Type Definitions**
   - Single Goal type
   - Remove legacy MuscleGroup
   - Complete database row types

4. **Add Error Boundaries**
   - Wrap major feature areas
   - Replace console.error with user feedback

5. **Fix E1RM Calculation Consistency**
   - Choose one method, use everywhere

### Medium Priority (Next Sprint)

6. **Increase Test Coverage**
   - Add tests for `coachingEngine.ts`, `measurementImbalanceEngine.ts`
   - Add component test thresholds (50% for critical components)
   - Create integration tests for cross-service flows

7. **Complete Database Types**
   - Add HypertrophyScore, video fields to database.ts
   - Replace `Record<string, unknown>` with proper types

8. **Improve Secondary Muscle Volume Tracking**
   - Fix rounding error in volumeTracker.ts

9. **Add MRV Excess Warning**
   - Flag when volume > 120% MRV

10. **Enhance Accessibility**
    - Add ARIA labels to ExerciseCard sections
    - Implement focus management in modals

### Low Priority (Backlog)

11. **Complete Periodization Models**
    - Full DUP implementation
    - Flexible block phase ratios

12. **Add Frequency Optimization**
    - Enforce 48-72hr recovery windows
    - Adjust frequency based on MRV approach

13. **Enhance Autoregulation**
    - Continuous intensity/volume adjustment based on readiness
    - Add HRV input if available from wearables

14. **Split Large Services**
    - Break up `exerciseService.ts` (2,767 lines)

15. **Standardize Server Actions**
    - Create consistent granularity
    - Organize into feature subdirectories

---

## Appendix: Key Files Reference

### Most Critical Files (Understand First)

| File | Lines | Purpose |
|------|-------|---------|
| `types/schema.ts` | 2,140 | Central domain types |
| `services/progressionEngine.ts` | 1,555 | Core progression logic |
| `services/mesocycleBuilder.ts` | 1,955 | Program generation |
| `stores/workoutStore.ts` | 640 | Active session state |
| `hooks/useActiveWorkout.ts` | 255 | Workout orchestration |
| `components/workout/ExerciseCard.tsx` | 2,908 | Main workout UI (needs refactor) |

### Files Needing Most Attention

| File | Issue |
|------|-------|
| `services/deloadEngine.ts` | Novice logic bug |
| `types/training.ts` | Goal type conflict |
| `services/volumeTracker.ts` | Rounding bug |
| `components/workout/ExerciseCard.tsx` | Needs split |
| `services/fatigueEngine.ts` | Incomplete fatigue modeling |

---

*This review represents a point-in-time analysis. The codebase shows strong fundamentals and with focused attention on the identified issues, can become an excellent, maintainable application.*
