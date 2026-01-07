# HyperTrack Bug Review Report

**Date:** January 7, 2026
**Reviewed by:** Claude Code
**Branch:** claude/review-app-bugs-ZEuBu

This document contains a comprehensive analysis of potential bugs and edge cases found during a systematic review of the HyperTrack codebase.

---

## Fixes Applied (January 7, 2026)

The following Priority 1 bugs have been fixed in branch `claude/fix-bug-review-report-FEiGt`:

### Core Services - Division by Zero Guards

| File | Fix Applied |
|------|-------------|
| `services/progressionEngine.ts` | Added guards for `getPeriodizationPhase()` (line 152), `getPhaseAdjustedRIR()` (line 422), `calculateSuggestedWeight()` (lines 1232-1236), null checks for `weeklyModifiers.rpeTarget`, minimum sets guard, and `calculateLoadProgression()` zero weight fix |
| `services/volumeTracker.ts` | Added guards for `percentOfMrv` calculation (line 113) and `averagePercentMrv` in `getVolumeSummary()` (line 395) |
| `services/fatigueEngine.ts` | Added guards for `forecastWeeklyFatigue()` when `plannedSessions` is 0 (line 348) and `adjustTargetsForReadiness()` division by `minWeightIncrement` (lines 308, 320) |

### Utility Functions - Input Validation

| File | Fix Applied |
|------|-------------|
| `lib/utils.ts` | Added validation to `roundToIncrement()` to handle zero/invalid increment, `convertWeight()` to handle negative/NaN/Infinity values, `formatDuration()` to handle negative values |
| `lib/weightUtils.ts` | Fixed backwards constant naming (`LBS_TO_KG` and `KG_TO_LBS` were swapped) and updated all usages |

### Date Handling - Timezone Fixes

| File | Fix Applied |
|------|-------------|
| `hooks/useBestLifts.ts` | Replaced `toISOString().split('T')[0]` with `getLocalDateString()` |
| `hooks/useWeeklyVolume.ts` | Replaced `toISOString().split('T')[0]` with `getLocalDateString()`, fixed Date mutation bug |
| `hooks/useAdaptiveVolume.ts` | Replaced `toISOString().split('T')[0]` with `getLocalDateString()` |
| `lib/actions/exercise-completion.ts` | Replaced `toISOString().split('T')[0]` with `getLocalDateString()` |

### Remaining Date Fixes Needed

The following files still contain `.toISOString().split('T')[0]` and should be updated:
- `lib/integrations/fitbit.ts`
- `lib/integrations/google-fit.ts`
- `lib/integrations/activity-sync.ts`
- `lib/integrations/step-normalization.ts`
- `services/coachingContextService.ts`
- `lib/training/coachingService.ts`
- `lib/training/programEngine.ts`
- `lib/nutrition/enhanced-tdee.ts`
- `lib/nutrition/adaptive-tdee.ts`
- `lib/actions/wearable.ts`
- `lib/actions/tdee.ts`
- `components/nutrition/WeightLogModal.tsx`
- `components/dashboard/BodyMeasurements.tsx`
- `components/dashboard/ActivityCard.tsx`
- `components/wearables/EnhancedTDEEDashboard.tsx`
- `components/settings/ImportExportSettings.tsx`
- `app/(dashboard)/dashboard/workout/page.tsx`
- `app/(dashboard)/dashboard/workout/[id]/page.tsx`
- `app/(dashboard)/dashboard/mesocycle/page.tsx`
- `app/(dashboard)/dashboard/mesocycle/new/page.tsx`
- `app/(dashboard)/dashboard/analytics/page.tsx`
- `app/(dashboard)/dashboard/body-composition/add/page.tsx`

---

## Executive Summary

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Core Services | 6 | 6 | 8 | 4 |
| Validation/Utils | 2 | 2 | 5 | 1 |
| State Management | 0 | 2 | 4 | 4 |
| Date Handling | 2 | 3 | 3 | 0 |
| API Routes | 3 | 4 | 5 | 3 |
| **Total** | **13** | **17** | **25** | **12** |

---

## 1. Core Services Bugs

### 1.1 progressionEngine.ts

#### CRITICAL

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 1232-1236 | Division by zero | `calculateSuggestedWeight()` divides by array lengths without checking if arrays are empty |
| 152 | Division by zero | `getPeriodizationPhase()`: `weekInMeso / totalWeeks` where totalWeeks could be 0 |
| 422 | Division by zero | `getPhaseAdjustedRIR()`: Same issue as above |

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 349 | Null reference | `weeklyModifiers.rpeTarget.max` accessed without null checks - produces NaN |
| 348 | Invalid sets | `Math.round(targets.sets * volumeModifier)` can result in 0 sets |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 835-922 | No validation | `generateWarmupProtocol()` doesn't validate workingWeight > 0 |
| 1038-1043 | Unsafe assertions | Non-null assertions on `bodyweightData` without runtime checks |
| 570-571 | Zero weight | `calculateLoadProgression()` can return 0kg indefinitely |

---

### 1.2 volumeTracker.ts

#### CRITICAL

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 113 | Division by zero | `data.totalSets / data.landmarks.mrv` - mrv could be 0 |
| 395 | Division by zero | `totalPercentMrv / volumeData.size` - size could be 0 |

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 167-179 | Logic assumption | Status logic assumes `MEV ≤ MAV * 0.8` - fails if landmarks violate this |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 103 | Rounding bias | `Math.round(setCount * 0.5)` causes inconsistent secondary muscle credits |
| 286, 328 | Negative display | Messages could show negative set counts if data is mismatched |
| 292 | Negative range | `weekInMeso` could be negative creating invalid target ranges |

---

### 1.3 fatigueEngine.ts

#### CRITICAL

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 348 | Division by zero | `7 / plannedSessions` when plannedSessions is 0 |
| 308, 320 | Division by zero | Division by `minWeightIncrement` without validation |

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 311, 323 | Negative weights | No validation prevents weightKg from becoming negative |
| 169-170 | No RPE validation | No validation that sessionRpe is within 0-10 range |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 253-254 | Hardcoded divisor | `/3` instead of using `.length` - fragile if slicing logic changes |
| 98 | Intermediate overflow | Sleep score exceeds 100 before clamping |

---

### 1.4 deloadEngine.ts

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 85-92 | Logic override | Experience-based overrides suppress valid safety deloads (e.g., novice with joint pain and only 1 trigger gets told NOT to deload) |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 218-240 | Missing validation | `calculateFatigueScore()` doesn't validate perceivedFatigue, sleepQuality, etc. are valid numbers |
| 299-303 | Fragile division | Array slicing could create empty arrays if check is weakened |

#### LOW

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 154-162 | No default case | Switch statement has no default case |
| 290-292 | NaN cascade | `Math.max(...scores)` fails if calculateFatigueScore returns NaN |

---

## 2. Validation & Utility Bugs

### 2.1 lib/utils.ts

#### CRITICAL

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 168-170 | Division by zero | `roundToIncrement(value, 0)` returns NaN |
| 90-94 | No validation | `convertWeight()` accepts negative, NaN, Infinity values |

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 81-85 | Invalid input | `formatDuration(-30)` produces "-1:-30" |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 305-335 | Empty array | `calculatePlates()` with empty availablePlates causes `Math.min(...[])` = Infinity |
| 457-559 | No validation | Measurement functions accept negative values |
| 595-596 | Assumption | `calculateStreaks()` assumes YYYY-MM-DD format |

---

### 2.2 lib/weightUtils.ts

#### CRITICAL

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 13-14 | Misleading names | `LBS_TO_KG = 2.20462` is actually the kg-to-lbs conversion factor (backwards naming) |

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 45-128 | No validation | `validateWeightEntry()` doesn't reject NaN, Infinity, or negative weights at input |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 199-217 | Silent invalid | `prepareWeightForStorage()` returns invalid values without error |
| 230 | Redundant check | `!weight || weight <= 0` has redundant condition |

---

## 3. State Management Bugs (Zustand Stores)

### 3.1 workoutStore.ts

#### HIGH

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 190-213 | NaN on missing props | `getSessionStats()` produces NaN if SetLog objects missing reps/weightKg/rpe |
| 150-175 | Race condition | Rapid logSet calls can lose data between get() and set() |

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 226-234 | Type safety | Rehydration callback uses `as any` casts hiding type mismatches |
| 217-234 | Silent failure | Corrupted persisted data creates empty Maps silently |

#### LOW

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 100-108 | Silent failure | `pauseSession()` returns silently without feedback if no active session |

---

### 3.2 exerciseStore.ts

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 103-109 | isLoading lost | isLoading not persisted - state lost on page reload |

#### LOW

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 27 | Hardcoded cache | 1 hour cache with no manual invalidation mechanism |

---

### 3.3 userStore.ts

#### MEDIUM

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 85-95 | Fragile fallback | `getVolumeLandmarks()` silently falls to hardcoded defaults on invalid data |

#### LOW

| Line(s) | Issue | Description |
|---------|-------|-------------|
| 43-83 | Silent failure | Update functions return silently if user is null |

---

## 4. Date Handling Bugs

### 4.1 Timezone Issues (CRITICAL - 30+ files affected)

The codebase uses `.toISOString().split('T')[0]` extensively, which returns UTC dates instead of local dates as specified in CLAUDE.md.

**Affected files include:**
- `hooks/useBestLifts.ts:231`
- `hooks/useAdaptiveVolume.ts:98, 102`
- `hooks/useWeeklyVolume.ts:29`
- `services/coachingContextService.ts:118, 196`
- `lib/actions/exercise-completion.ts:33, 36`
- `lib/actions/tdee.ts:108`
- `components/dashboard/*.tsx` (multiple files)
- `app/(dashboard)/dashboard/**/*.tsx` (multiple pages)

**Impact:** A user at 11 PM in New York on Jan 15 gets "2024-01-16" instead of "2024-01-15".

**Fix:** Replace with `getLocalDateString()` from lib/utils.ts.

---

### 4.2 Other Date Issues

| File | Line(s) | Severity | Issue |
|------|---------|----------|-------|
| coachingContextService.ts | 86-88 | HIGH | Incomplete age calculation - only compares years, doesn't check if birthday occurred |
| useWeeklyVolume.ts | 23-30 | HIGH | Monday calculation mutates original Date object; month boundary overflow issues |
| analytics/page.tsx | 1035 | HIGH | Streak calculation uses `prevDate - currDate` (negative) instead of `currDate - prevDate` |
| useAdaptiveVolume.ts | 97-106 | MEDIUM | `setHours()` then `toISOString()` loses timezone info |
| lib/utils.ts | 58-59 | MEDIUM | Uses fixed 30-day months and 365-day years for relative time |

---

## 5. API Routes Bugs

### 5.1 Security Issues

#### CRITICAL

| Route | Issue | Description |
|-------|-------|-------------|
| `/api/integrations/fitbit/revoke` | Missing auth | No authentication - anyone can revoke any Fitbit token |
| `/api/integrations/fitbit/refresh` | Missing auth | No authentication - anyone can refresh any Fitbit token |
| `/api/stripe/webhook` | No idempotency | Webhook events can be processed multiple times if Stripe retries |

#### HIGH

| Route | Line(s) | Issue | Description |
|-------|---------|-------|-------------|
| `/api/stripe/webhook` | 24 | Array access | `subscription.items.data[0]` without bounds check |
| `/api/stripe/webhook` | 43-45 | Unsafe casting | Type assertions without runtime validation |
| `/api/stripe/checkout` | 108 | Fallback to input | Falls back to user-supplied priceId if validation fails |
| `/api/stripe/portal`, `/checkout` | 16, 26 | Unsafe parsing | `authHeader.replace('Bearer ', '')` doesn't validate format |

---

### 5.2 Logic & Validation Issues

#### MEDIUM

| Route | Line(s) | Issue | Description |
|-------|---------|-------|-------------|
| `/api/integrations/fitbit/token` | 83 | Type assumption | Assumes `tokens.scope` is string before `.split()` |
| `/api/stripe/webhook` | 136 | Missing check | Non-null assertion on `STRIPE_WEBHOOK_SECRET` without validation |
| `/api/stripe/webhook` | 28-88 | Race condition | SELECT then INSERT/UPDATE without atomic operation |
| All POST routes | - | No size limit | No Content-Length validation - DoS risk |

#### LOW

| Issue | Description |
|-------|-------------|
| All routes | No rate limiting implemented |
| `/api/integrations/fitbit/revoke` | Returns success even if revoke fails |

---

## 6. Recommended Priority Fixes

### Priority 1 - Fix Immediately (Security & Data Integrity)

1. **Add authentication to Fitbit revoke/refresh routes**
2. **Add idempotency checking to Stripe webhook**
3. **Replace all `.toISOString().split('T')[0]` with `getLocalDateString()`**
4. **Add division-by-zero guards in progressionEngine, volumeTracker, fatigueEngine**
5. **Fix the backwards constant naming in weightUtils.ts**

### Priority 2 - Fix Soon (Logic Errors)

1. **Fix deload trigger override logic** (novices with joint pain shouldn't be told to skip deload)
2. **Add input validation to core utility functions** (roundToIncrement, convertWeight, formatDuration)
3. **Fix age calculation in coachingContextService.ts**
4. **Fix streak calculation direction in analytics page**
5. **Add bounds checking for Stripe webhook array access**

### Priority 3 - Fix When Possible (Code Quality)

1. Add null checks to Zustand store getSessionStats
2. Implement rate limiting on API routes
3. Add request size validation
4. Fix rounding bias in volumeTracker secondary muscle credits
5. Add persistence tests for Zustand stores

---

## 7. Testing Recommendations

1. **Add unit tests for edge cases:**
   - Empty arrays passed to averaging functions
   - Zero/negative/NaN inputs to mathematical functions
   - Invalid date strings
   - Missing object properties

2. **Add integration tests for:**
   - Stripe webhook retry scenarios
   - Date operations across timezone boundaries
   - Race conditions in concurrent workout logging

3. **Add security tests for:**
   - Authentication bypass attempts
   - Invalid Bearer token formats
   - Malformed webhook signatures

---

## Appendix: Files Requiring Immediate Attention

| File | Priority | Issues Found |
|------|----------|--------------|
| `services/progressionEngine.ts` | P1 | 10 bugs |
| `services/fatigueEngine.ts` | P1 | 10 bugs |
| `services/deloadEngine.ts` | P1 | 7 bugs |
| `services/volumeTracker.ts` | P1 | 7 bugs |
| `lib/utils.ts` | P1 | 6 bugs |
| `lib/weightUtils.ts` | P1 | 5 bugs |
| `app/api/stripe/webhook/route.ts` | P1 | 6 bugs |
| `app/api/integrations/fitbit/*.ts` | P1 | 4 bugs |
| `stores/workoutStore.ts` | P2 | 5 bugs |
| 30+ files with `.toISOString().split('T')[0]` | P1 | Timezone bug |
