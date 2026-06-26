# Mesocycle Feature Refactoring Plan

> **Status**: Complete (All Phases Done)
> **Created**: 2026-01-26
> **Last Updated**: 2026-01-26

## Executive Summary

The mesocycle feature has several critical bugs causing exercises, days of the week, and set counts to not match user configurations. This document outlines a comprehensive refactoring plan to fix these issues and properly integrate all existing systems (weight estimation, fatigue tracking, time budgeting).

---

## Table of Contents

1. [Current Issues](#current-issues)
2. [Architecture Overview](#architecture-overview)
3. [Refactoring Tasks](#refactoring-tasks)
4. [Implementation Phases](#implementation-phases)
5. [Testing Strategy](#testing-strategy)
6. [Database Changes](#database-changes)
7. [Migration Guide](#migration-guide)

---

## Current Issues

### Issue #1: Hardcoded Set Counts (CRITICAL)

**Location**: `app/(dashboard)/dashboard/mesocycle/page.tsx:471`

**Problem**: When starting a workout from the mesocycle dashboard, set counts are hardcoded:
```typescript
blocks.push({
  // ...
  target_sets: isCompound ? 4 : 3,  // ❌ HARDCODED!
  // ...
});
```

**Impact**:
- User's session duration settings are ignored
- Fatigue budget calculations from program generation are discarded
- Users get incorrect volume that doesn't match their plan

**Expected Behavior**: Use the pre-calculated sets from `program_data.sessions` which accounts for:
- Session duration (45 min vs 60 min vs 90 min)
- Fatigue budget constraints
- Weekly volume targets per muscle
- Number of exercises per session

---

### Issue #2: program_data Not Used (CRITICAL)

**Location**: `app/(dashboard)/dashboard/mesocycle/page.tsx:353-491`

**Problem**: The `FullProgramRecommendation` (containing pre-calculated sessions with exercises, sets, reps, and fatigue profiles) is stored in `program_data` during mesocycle creation but **never retrieved or used** when starting a workout.

**Current Flow**:
1. User creates mesocycle → `generateFullMesocycleWithFatigue()` calculates detailed program
2. `program_data` saved to database with all session details
3. User starts workout → **Code ignores `program_data` entirely**
4. Code queries random exercises and uses hardcoded sets

**Expected Flow**:
1. User creates mesocycle → `generateFullMesocycleWithFatigue()` calculates detailed program
2. `program_data` saved to database
3. User starts workout → **Code retrieves and uses `program_data.sessions[dayIndex]`**
4. Exercise blocks created from pre-calculated program with proper sets, reps, weights

---

### Issue #3: Days of Week Assignment Bug (MAJOR)

**Location**: `app/(dashboard)/dashboard/mesocycle/new/page.tsx:89-96`

**Problem**: The auto-selection of workout days doesn't match the intended default patterns:

```typescript
useEffect(() => {
  const defaultDays = getDefaultWorkoutDays(daysPerWeek);  // Returns correct pattern

  if (daysPerWeek <= 5) {
    setPreferredWorkoutDays(WEEKDAYS.slice(0, daysPerWeek));  // ❌ Wrong!
  } else {
    setPreferredWorkoutDays(defaultDays);  // ✓ Correct for 6 days
  }
}, [daysPerWeek]);
```

**Examples of Mismatch**:

| Days | `getDefaultWorkoutDays()` | `WEEKDAYS.slice()` | Issue |
|------|---------------------------|---------------------|-------|
| 4 | Mon, Tue, Thu, Fri | Mon, Tue, Wed, Thu | Missing recovery day (Wed) |
| 5 | Mon-Fri | Mon-Fri | No issue |
| 6 | Mon, Tue, Wed, Fri, Sat, Sun | Mon-Fri (5 only!) | Missing weekend, loses a day |

**Impact**:
- Users training 4 days get consecutive days without intended Wednesday rest
- Users training 6 days only get 5 days in the auto-selection

---

### Issue #4: Weight Estimation Not Integrated (MAJOR)

**Location**: `app/(dashboard)/dashboard/mesocycle/page.tsx:474`

**Problem**: Target weight is always set to 0:
```typescript
blocks.push({
  // ...
  target_weight_kg: 0, // Will be filled from history or user input
  // ...
});
```

The `WeightEstimationEngine` exists and can provide intelligent weight recommendations, but it's never called during workout creation.

**Impact**:
- Users see "0 kg" as suggested weight for all exercises
- The sophisticated weight estimation system (using exercise history, related exercises, strength standards) is unused
- Users must manually enter every weight from scratch

---

### Issue #5: Session Time Budget Not Respected (MODERATE)

**Location**: `app/(dashboard)/dashboard/mesocycle/page.tsx:406-484`

**Problem**: When creating exercise blocks, there's no check against the session duration:
- No calculation of how many exercises fit in the time budget
- No time estimation per exercise
- Session could exceed user's available time

**Expected Behavior**: The `sessionBuilderWithFatigue.ts` already has `getMaxExercisesForTime()` and `estimateExerciseTime()` - these should be used.

---

### Issue #6: Exercise Selection Ignores Program Plan (MODERATE)

**Location**: `app/(dashboard)/dashboard/mesocycle/page.tsx:406-420`

**Problem**: Exercises are queried ad-hoc from the database instead of using the pre-selected exercises from `program_data`:

```typescript
// Current: Random exercise query
const { data: exercises } = await supabase
  .from('exercises')
  .select('*')
  .in('primary_muscle', todayWorkout.muscles);
```

**Expected**: Use the specific exercises from `program_data.sessions[dayIndex].exercises`

---

## Architecture Overview

### Current Data Flow (Broken)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MESOCYCLE CREATION                               │
├─────────────────────────────────────────────────────────────────────┤
│ 1. User inputs: daysPerWeek, sessionDuration, preferredDays        │
│ 2. generateFullMesocycleWithFatigue() creates full program         │
│ 3. Saves to DB: program_data, fatigue_budget_config, volume_per_muscle │
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKOUT START (BROKEN)                           │
├─────────────────────────────────────────────────────────────────────┤
│ 1. getWorkoutForDay() returns muscles for today ✓                  │
│ 2. Query random exercises from DB ❌ (ignores program_data)        │
│ 3. Create blocks with hardcoded sets ❌ (4/3 sets)                 │
│ 4. target_weight_kg = 0 ❌ (no weight estimation)                  │
│ 5. No time budget check ❌                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Target Data Flow (Fixed)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MESOCYCLE CREATION                               │
├─────────────────────────────────────────────────────────────────────┤
│ 1. User inputs: daysPerWeek, sessionDuration, preferredDays        │
│ 2. generateFullMesocycleWithFatigue() creates full program         │
│ 3. Saves to DB: program_data, fatigue_budget_config, volume_per_muscle │
│ 4. program_data includes: sessions[], exercises[], sets, reps, etc.│
└─────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKOUT START (FIXED)                            │
├─────────────────────────────────────────────────────────────────────┤
│ 1. getWorkoutForDay() returns day index ✓                          │
│ 2. Retrieve session = program_data.sessions[dayIndex] ✓            │
│ 3. For each exercise in session.exercises:                          │
│    a. Create block with exercise.sets ✓ (from program)             │
│    b. Use WeightEstimationEngine for target_weight_kg ✓            │
│    c. Use exercise.reps for rep range ✓                            │
│    d. Apply weekly progression modifiers ✓                         │
│ 4. Validate against time budget ✓                                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Refactoring Tasks

### Phase 1: Critical Bug Fixes

- [ ] **1.1 Fix day of week auto-selection**
  - File: `app/(dashboard)/dashboard/mesocycle/new/page.tsx`
  - Change `WEEKDAYS.slice(0, daysPerWeek)` to use `getDefaultWorkoutDays(daysPerWeek)` consistently
  - Ensure 6-day selection includes Saturday/Sunday

- [ ] **1.2 Create helper to extract session from program_data**
  - File: `services/mesocycleHelpers.ts` (new)
  - Function: `getSessionFromProgramData(programData, dayIndex, weekNumber)`
  - Returns: Session with exercises, sets, reps for the given day

- [ ] **1.3 Refactor handleStartWorkout to use program_data**
  - File: `app/(dashboard)/dashboard/mesocycle/page.tsx`
  - Retrieve `program_data` from active mesocycle
  - Map `todayWorkout.dayNumber` to session index
  - Use pre-calculated exercises and sets instead of ad-hoc query

- [ ] **1.4 Integrate WeightEstimationEngine**
  - File: `app/(dashboard)/dashboard/mesocycle/page.tsx`
  - Create user strength profile from exercise history
  - Call `getWorkingWeight()` for each exercise block
  - Store result in `target_weight_kg`

### Phase 2: Data Integrity

- [ ] **2.1 Add week number tracking**
  - Use `mesocycle.current_week` to apply weekly progression modifiers
  - Adjust sets/intensity based on `periodization.weeklyProgression[weekNum]`

- [ ] **2.2 Store exercise IDs in program_data**
  - Currently exercises are stored by name only
  - Add `exerciseId` field to enable direct DB lookups
  - Ensures consistent exercise matching even if names change

- [ ] **2.3 Add session tracking**
  - Track which sessions have been completed this week
  - Prevent double-counting workouts
  - Support workout reordering within the week

### Phase 3: Enhanced Features

- [ ] **3.1 Time budget validation**
  - Calculate estimated workout time before starting
  - Warn user if exercises exceed session duration
  - Offer to trim workout to fit time budget

- [ ] **3.2 Exercise swapping support**
  - When user swaps an exercise, update `program_data`
  - Preserve swap for future sessions
  - Maintain muscle group volume

- [ ] **3.3 Progressive overload tracking**
  - Apply `weeklyProgression.intensityModifier` to target weights
  - Track actual vs target progression
  - Adjust next session based on performance

### Phase 4: Testing & Validation

- [ ] **4.1 Unit tests for mesocycle helpers**
  - Test `getSessionFromProgramData()` with various inputs
  - Test weekly progression calculations
  - Test exercise ID matching

- [ ] **4.2 Integration tests for workout creation**
  - Create mesocycle → Start workout → Verify blocks match program
  - Test with different split types (PPL, Upper/Lower, Full Body)
  - Test with different session durations (30min, 60min, 90min)

- [ ] **4.3 E2E tests for user flow**
  - Full flow: Create mesocycle → Complete week → Verify progression

---

## Implementation Phases

### Phase 1: Critical Fixes (Priority: HIGH)

**Timeline**: Week 1

| Task | File | Description |
|------|------|-------------|
| 1.1 | `new/page.tsx` | Fix day selection bug |
| 1.2 | `mesocycleHelpers.ts` | Create session extraction helper |
| 1.3 | `page.tsx` | Use program_data for workout creation |
| 1.4 | `page.tsx` | Integrate weight estimation |

### Phase 2: Data Integrity (Priority: MEDIUM)

**Timeline**: Week 2

| Task | File | Description |
|------|------|-------------|
| 2.1 | `page.tsx` | Weekly progression modifiers |
| 2.2 | `sessionBuilderWithFatigue.ts` | Store exercise IDs |
| 2.3 | `page.tsx` | Session completion tracking |

### Phase 3: Enhancements (Priority: LOW)

**Timeline**: Week 3+

| Task | File | Description |
|------|------|-------------|
| 3.1 | `page.tsx` | Time budget validation UI |
| 3.2 | `page.tsx` | Exercise swap persistence |
| 3.3 | `progressionEngine.ts` | Progressive overload integration |

---

## Database Changes

### No Schema Changes Required

The current schema supports all required functionality:

- `mesocycles.program_data` - JSONB field already stores `FullProgramRecommendation`
- `mesocycles.current_week` - Already tracks week progression
- `exercise_blocks.target_weight_kg` - Already exists, just unused

### Potential Future Additions

```sql
-- Optional: Track exercise swaps for program customization
ALTER TABLE mesocycles
ADD COLUMN exercise_overrides JSONB DEFAULT '{}';

-- Optional: Track which days have been completed this week
ALTER TABLE mesocycles
ADD COLUMN completed_sessions_this_week INTEGER[] DEFAULT '{}';
```

---

## Code Changes Detail

### Task 1.1: Fix Day Selection

**File**: `app/(dashboard)/dashboard/mesocycle/new/page.tsx`

**Current Code** (lines 89-96):
```typescript
useEffect(() => {
  const defaultDays = getDefaultWorkoutDays(daysPerWeek);
  if (daysPerWeek <= 5) {
    setPreferredWorkoutDays(WEEKDAYS.slice(0, daysPerWeek));  // ❌ BUG
  } else {
    setPreferredWorkoutDays(defaultDays);
  }
}, [daysPerWeek]);
```

**Fixed Code**:
```typescript
useEffect(() => {
  const defaultDays = getDefaultWorkoutDays(daysPerWeek);
  setPreferredWorkoutDays(defaultDays);  // ✓ Use helper for all cases
}, [daysPerWeek]);
```

---

### Task 1.2: Create Session Extraction Helper

**New File**: `services/mesocycleHelpers.ts`

```typescript
import type { FullProgramRecommendation, DetailedSession, MuscleGroup } from '@/types/schema';

export interface SessionForDay {
  dayName: string;
  muscles: MuscleGroup[];
  exercises: Array<{
    exerciseId?: string;
    exerciseName: string;
    sets: number;
    repRange: { min: number; max: number };
    targetRir: number;
    restSeconds: number;
    notes?: string;
  }>;
  estimatedMinutes: number;
  warmup: string[];
}

/**
 * Extract the appropriate session from program_data based on day index and week.
 * Handles both legacy format (sessions array) and new format (mesocycleWeeks).
 */
export function getSessionFromProgramData(
  programData: FullProgramRecommendation | null,
  dayIndex: number,  // 0-based index of training day this week
  weekNumber: number = 1,
  totalWeeks: number = 6
): SessionForDay | null {
  if (!programData) return null;

  // Prefer mesocycleWeeks if available (has week-specific data)
  if (programData.mesocycleWeeks && programData.mesocycleWeeks.length > 0) {
    const weekIdx = Math.min(weekNumber - 1, programData.mesocycleWeeks.length - 1);
    const week = programData.mesocycleWeeks[weekIdx];
    const session = week.sessions[dayIndex % week.sessions.length];

    if (!session) return null;

    return {
      dayName: session.day,
      muscles: extractMusclesFromSession(session),
      exercises: session.exercises.map(e => ({
        exerciseId: e.exercise.id,
        exerciseName: e.exercise.name,
        sets: e.sets,
        repRange: { min: e.reps.min, max: e.reps.max },
        targetRir: e.reps.targetRIR,
        restSeconds: e.restSeconds,
        notes: e.notes,
      })),
      estimatedMinutes: session.estimatedMinutes,
      warmup: session.warmup,
    };
  }

  // Fallback to legacy sessions array
  if (programData.sessions && programData.sessions.length > 0) {
    const session = programData.sessions[dayIndex % programData.sessions.length];

    return {
      dayName: session.day,
      muscles: extractMusclesFromSession(session),
      exercises: session.exercises.map(e => ({
        exerciseName: e.exercise.name,
        sets: e.sets,
        repRange: parseRepRange(e.repRange),
        targetRir: 2,  // Default RIR for legacy format
        restSeconds: e.restSeconds,
        notes: e.notes,
      })),
      estimatedMinutes: session.estimatedMinutes,
      warmup: session.warmup,
    };
  }

  return null;
}

function extractMusclesFromSession(session: any): MuscleGroup[] {
  const muscles = new Set<MuscleGroup>();
  for (const ex of session.exercises) {
    muscles.add(ex.exercise.primaryMuscle);
    if (ex.exercise.secondaryMuscles) {
      ex.exercise.secondaryMuscles.forEach((m: MuscleGroup) => muscles.add(m));
    }
  }
  return Array.from(muscles);
}

function parseRepRange(range: string | { min: number; max: number }): { min: number; max: number } {
  if (typeof range === 'object') return range;
  const parts = range.split('-').map(Number);
  return { min: parts[0] || 8, max: parts[1] || 12 };
}
```

---

### Task 1.3: Refactor handleStartWorkout

**File**: `app/(dashboard)/dashboard/mesocycle/page.tsx`

**Key Changes**:

```typescript
import { getSessionFromProgramData } from '@/services/mesocycleHelpers';
import { quickWeightEstimate } from '@/services/weightEstimationEngine';

const handleStartWorkout = async () => {
  if (!activeMesocycle || !todayWorkout) return;

  setIsStartingWorkout(true);

  try {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) throw new Error('Not logged in');

    // Fetch user profile for weight estimation
    const { data: userProfile } = await supabase
      .from('users')
      .select('goal, experience, height_cm, weight_kg, body_fat_percent')
      .eq('id', user.id)
      .single();

    const userGoal = userProfile?.goal || 'maintenance';

    // Check for existing workout
    const today = getLocalDateString();
    const { data: existingWorkout } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('planned_date', today)
      .in('state', ['planned', 'in_progress'])
      .single();

    if (existingWorkout) {
      router.push(`/dashboard/workout/${existingWorkout.id}`);
      return;
    }

    // ✅ NEW: Extract session from program_data
    const programData = activeMesocycle.program_data as FullProgramRecommendation | null;
    const sessionFromProgram = getSessionFromProgramData(
      programData,
      todayWorkout.dayNumber - 1,  // Convert to 0-based
      activeMesocycle.current_week,
      activeMesocycle.total_weeks
    );

    // Create workout session
    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        user_id: user.id,
        mesocycle_id: activeMesocycle.id,
        planned_date: today,
        state: 'in_progress',
        started_at: new Date().toISOString(),
        completion_percent: 0,
      })
      .select()
      .single();

    if (sessionError || !session) throw sessionError || new Error('Failed to create session');

    // Create exercise blocks from program data
    if (sessionFromProgram && sessionFromProgram.exercises.length > 0) {
      const blocks = [];
      let order = 1;

      for (const exercise of sessionFromProgram.exercises) {
        // ✅ NEW: Get weight estimate
        const weightRec = userProfile?.height_cm && userProfile?.weight_kg
          ? quickWeightEstimate(
              exercise.exerciseName,
              exercise.repRange,
              exercise.targetRir,
              userProfile.weight_kg,
              userProfile.height_cm,
              userProfile.body_fat_percent || 20,
              userProfile.experience || 'intermediate'
            )
          : null;

        // Look up exercise in DB to get exercise_id
        const { data: dbExercise } = await supabase
          .from('exercises')
          .select('id, primary_muscle, mechanic, default_rep_range, default_rir')
          .eq('name', exercise.exerciseName)
          .single();

        const isCompound = dbExercise?.mechanic === 'compound';

        // Generate warmup for first exercise
        const warmupSets = order === 1
          ? generateWarmupProtocol({
              workingWeight: weightRec?.recommendedWeight || 60,
              exercise: {
                id: dbExercise?.id || '',
                name: exercise.exerciseName,
                primaryMuscle: dbExercise?.primary_muscle || 'chest',
                secondaryMuscles: [],
                mechanic: isCompound ? 'compound' : 'isolation',
                defaultRepRange: [exercise.repRange.min, exercise.repRange.max] as [number, number],
                defaultRir: exercise.targetRir,
                minWeightIncrementKg: 2.5,
                formCues: [],
                commonMistakes: [],
                equipmentRequired: [],
                setupNote: '',
                movementPattern: isCompound ? 'compound' : 'isolation',
              },
              isFirstExercise: true,
            })
          : [];

        blocks.push({
          workout_session_id: session.id,
          exercise_id: dbExercise?.id || exercise.exerciseId,
          order: order++,
          target_sets: exercise.sets,  // ✅ From program_data
          target_rep_range: [exercise.repRange.min, exercise.repRange.max],
          target_rir: exercise.targetRir,
          target_weight_kg: weightRec?.recommendedWeight || 0,  // ✅ From weight estimation
          target_rest_seconds: exercise.restSeconds,
          suggestion_reason: `${sessionFromProgram.dayName} - Week ${activeMesocycle.current_week}`,
          warmup_protocol: { sets: warmupSets },
        });
      }

      if (blocks.length > 0) {
        await supabase.from('exercise_blocks').insert(blocks);
      }
    } else {
      // Fallback to legacy behavior if no program_data
      // ... (existing code as fallback)
    }

    router.push(`/dashboard/workout/${session.id}`);
  } catch (error) {
    console.error('Failed to start workout:', error);
    setIsStartingWorkout(false);
  }
};
```

---

## Testing Strategy

### Unit Tests

```typescript
// __tests__/services/mesocycleHelpers.test.ts

describe('getSessionFromProgramData', () => {
  it('returns null for null programData', () => {
    expect(getSessionFromProgramData(null, 0, 1, 6)).toBeNull();
  });

  it('extracts correct session from mesocycleWeeks', () => {
    const mockProgram: FullProgramRecommendation = {
      // ... mock data
    };
    const result = getSessionFromProgramData(mockProgram, 0, 1, 6);
    expect(result?.exercises.length).toBeGreaterThan(0);
    expect(result?.exercises[0].sets).toBeDefined();
  });

  it('applies weekly progression modifiers', () => {
    // Week 1 vs Week 5 should have different intensity
  });

  it('handles day index overflow gracefully', () => {
    // dayIndex > sessions.length should wrap
  });
});
```

### Integration Tests

```typescript
// __tests__/integration/mesocycleWorkout.test.ts

describe('Mesocycle Workout Integration', () => {
  it('creates workout with correct sets from program_data', async () => {
    // 1. Create mesocycle with 45-min session duration
    // 2. Start workout
    // 3. Verify exercise blocks match program_data
    // 4. Verify sets are NOT hardcoded 4/3
  });

  it('includes weight estimates for all exercises', async () => {
    // 1. Create mesocycle with user having exercise history
    // 2. Start workout
    // 3. Verify target_weight_kg > 0 for exercises with history
  });
});
```

---

## Migration Guide

### For Existing Mesocycles

Existing mesocycles with `program_data` will automatically benefit from the refactored workout creation. No migration needed.

### For Mesocycles Without program_data

Older mesocycles created before `program_data` was added will continue using the fallback behavior (ad-hoc exercise query with legacy set counts).

To upgrade:
1. User can "regenerate program" from mesocycle settings
2. This calls `generateFullMesocycleWithFatigue()` and updates `program_data`

---

## Checklist Summary

### Phase 1: Critical (Must Fix) - COMPLETED
- [x] Fix day selection (`WEEKDAYS.slice` → `getDefaultWorkoutDays`) - **Done 2026-01-26**
- [x] Create `getSessionFromProgramData()` helper - **Done 2026-01-26** (services/mesocycleHelpers.ts)
- [x] Refactor `handleStartWorkout()` to use `program_data` - **Done 2026-01-26**
- [x] Integrate `WeightEstimationEngine` for `target_weight_kg` - **Done 2026-01-26**

### Phase 2: Important (Should Fix) - COMPLETED
- [x] Apply weekly progression modifiers - **Done 2026-01-26** (included in handleStartWorkout refactor)
- [x] Store exercise IDs in program_data - **Done 2026-01-26** (added `id` field to ExerciseEntry in types/schema.ts)
- [x] Track completed sessions per week - **Done 2026-01-26** (uses completedSessionsThisWeek for session index)

### Phase 3: Nice to Have - COMPLETED
- [x] Time budget validation UI - **Done 2026-01-26** (shows estimated time & warning if exceeds budget)
- [x] Exercise swap persistence - **Done 2026-01-26** (saves overrides to mesocycle, applies on next workout)
- [x] Progressive overload integration - **Done 2026-01-26** (applies intensityModifier to target weights)

---

## Related Files

| File | Purpose |
|------|---------|
| `app/(dashboard)/dashboard/mesocycle/page.tsx` | Main mesocycle dashboard, workout start |
| `app/(dashboard)/dashboard/mesocycle/new/page.tsx` | Mesocycle creation wizard |
| `services/mesocycleBuilder.ts` | Program generation framework |
| `services/sessionBuilderWithFatigue.ts` | Session-specific details with fatigue |
| `services/mesocycleHelpers.ts` | **NEW** - Session extraction & weekly progression helpers |
| `services/weightEstimationEngine.ts` | Weight prediction engine |
| `types/schema.ts` | Type definitions |
| `components/mesocycle/WorkoutDaySelector.tsx` | Day selection UI |

---

## Appendix: Type Definitions

### FullProgramRecommendation (from schema.ts)

```typescript
interface FullProgramRecommendation {
  split: Split;
  schedule: string[];
  periodization: PeriodizationPlan;
  recoveryProfile: RecoveryFactors;
  fatigueBudget?: FatigueBudgetConfig;
  volumePerMuscle: Record<MuscleGroup, { sets: number; frequency: number }>;
  sessions: DetailedSession[];
  mesocycleWeeks?: MesocycleWeek[];
  warnings: string[];
  programNotes: string[];
}

interface MesocycleWeek {
  weekNumber: number;
  focus: string;
  intensityModifier: number;
  volumeModifier: number;
  rpeTarget: { min: number; max: number };
  sessions: DetailedSessionWithFatigue[];
  isDeload: boolean;
}
```
