# Test Coverage Analysis

Generated: 2025-12-26

## Summary

- **30 test suites** with **993 tests** passing
- One file failing coverage thresholds: `mesocycleBuilder.ts`
- Significant coverage gaps in hooks, stores, and components

---

## Critical Priority (CI Blocking)

### mesocycleBuilder.ts - FAILING THRESHOLDS ❌

| Metric | Current | Required |
|--------|---------|----------|
| Statements | 28.11% | 70% |
| Branches | 24.39% | 50% |
| Lines | 28.79% | 70% |
| Functions | 11.32% | 60% |

**Functions needing tests:**
- `buildPeriodizationPlan()`
- `calculateVolumeDistribution()`
- `generateWarmup()`
- `recommendMesocycle()` (main entry point)
- Split recommendation logic
- Volume landmark calculations

---

## High Priority Areas

### Services with < 10% Coverage

| Service | Coverage | Notes |
|---------|----------|-------|
| `sessionBuilderWithFatigue.ts` | 1.57% | Core session building |
| `repRangeEngine.ts` | 2.45% | Rep range calculations |
| `regionalAnalysis.ts` | 2.04% | Muscle balance analysis |
| `openFoodFactsService.ts` | 0% | External API |
| `usdaService.ts` | 0% | External API |

### Hooks (2/12 tested)

**Untested:**
- `useActiveWorkout.ts` - Core workout session management
- `useProgressionTargets.ts` - Progression engine integration
- `useWeeklyVolume.ts` - Volume tracking per muscle
- `useUserPreferences.ts` - User preferences with unit conversion
- `useExerciseHistory.ts` - Historical exercise data
- `useMuscleRecovery.ts` - Recovery state tracking
- `useSubscription.ts` - Stripe subscription status
- `useAdaptiveVolume.ts` - Adaptive volume recommendations
- `useExercisePreferences.ts` - Exercise favoriting/hiding
- `usePWA.ts` - PWA install prompt

### Stores (1/3 tested)

**Untested:**
- `userStore.ts` - User state and preferences
- `exerciseStore.ts` - Exercise library cache

### Components (5/80+ tested)

**Tested:** Button, Input, Modal, ExerciseCard, RestTimer

**Priority untested components:**
- `SetInputRow.tsx` - Primary data entry
- `SessionSummary.tsx` - Workout completion
- `VolumeChart.tsx` / `E1RMGraph.tsx` - Analytics
- `MacroCalculatorModal.tsx` - Nutrition setup
- `DiscomfortLogger.tsx` - Injury tracking

---

## Medium Priority

### Services with Moderate Coverage

| Service | Coverage |
|---------|----------|
| `coachingEngine.ts` | 61% |
| `fatigueBudgetEngine.ts` | 69% |
| `progressionEngine.ts` | 73% |
| `volumeTracker.ts` | 82% |
| `weightEstimationEngine.ts` | 82% |

### Lib Modules (Untested)

- `lib/training/coachingService.ts`
- `lib/training/exercise-safety.ts`
- `lib/training/programEngine.ts`
- `lib/nutrition/adaptive-tdee.ts`
- `lib/nutrition/enhanced-tdee.ts`
- `lib/body-composition/p-ratio.ts`
- `lib/integrations/*` (Fitbit, HealthKit, Google Fit)

---

## Recommended Action Plan

### Phase 1: Unblock CI
1. Add comprehensive tests for `mesocycleBuilder.ts`
   - Focus on `buildPeriodizationPlan`, `calculateVolumeDistribution`, `generateWarmup`
   - Test edge cases for different experience levels and goals

### Phase 2: Core Functionality
2. Test `sessionBuilderWithFatigue.ts` - session generation
3. Test `useActiveWorkout.ts` hook - workout flow
4. Test `userStore.ts` - user state management
5. Test `repRangeEngine.ts` - rep range calculations

### Phase 3: User-Facing Features
6. Add component tests for `SetInputRow`, `SessionSummary`
7. Test progression hooks (`useProgressionTargets`, `useWeeklyVolume`)
8. Add nutrition service tests with mocked APIs

### Phase 4: Integration Coverage
9. Test wearable integrations with mocked responses
10. Add E2E tests for critical user flows

---

## Testing Patterns

### Services
```typescript
// Example: Pure function testing
describe('buildPeriodizationPlan', () => {
  it('should create 4-week plan for beginner', () => {
    const result = buildPeriodizationPlan({
      experience: 'beginner',
      goal: 'bulk',
      // ...
    });
    expect(result.weeks).toHaveLength(4);
  });
});
```

### Hooks
```typescript
// Example: Hook testing with renderHook
import { renderHook, act } from '@testing-library/react';

describe('useActiveWorkout', () => {
  it('should start a new session', async () => {
    const { result } = renderHook(() => useActiveWorkout());
    await act(async () => {
      await result.current.startNewSession('push-day');
    });
    expect(result.current.activeSession).not.toBeNull();
  });
});
```

### Stores
```typescript
// Example: Zustand store testing
describe('userStore', () => {
  beforeEach(() => {
    useUserStore.setState({ user: null, isLoading: true });
  });

  it('should update preferences', () => {
    useUserStore.getState().setUser(mockUser);
    useUserStore.getState().updatePreferences({ units: 'lb' });
    expect(useUserStore.getState().user?.preferences.units).toBe('lb');
  });
});
```

### Components
```typescript
// Example: Component testing with user-event
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('SetInputRow', () => {
  it('should log a set when submitted', async () => {
    const onSave = jest.fn();
    render(<SetInputRow onSave={onSave} />);

    await userEvent.type(screen.getByLabelText('Weight'), '100');
    await userEvent.type(screen.getByLabelText('Reps'), '10');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledWith({ weightKg: 100, reps: 10 });
  });
});
```
