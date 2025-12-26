# Test Coverage Analysis

**Last Updated:** 2025-12-26

## Summary

| Metric | Value |
|--------|-------|
| Test Suites | 34 passing |
| Total Tests | 1,203 |
| Snapshots | 16 |
| Test Files | 35 |
| Lines of Test Code | ~21,500 |

**Status: All coverage thresholds passing**

---

## Coverage by Domain

### Services (14 test files) - **Core Business Logic**

| Service | Statements | Branches | Functions | Lines | Status |
|---------|------------|----------|-----------|-------|--------|
| `mesocycleBuilder.ts` | 88.5% | 84.3% | 96.2% | 88.2% | **PASS** |
| `progressionEngine.ts` | 73% | 65% | 80% | 73% | **PASS** |
| `volumeTracker.ts` | 82% | 75% | 90% | 82% | **PASS** |
| `fatigueEngine.ts` | 78% | 70% | 85% | 78% | **PASS** |
| `plateauDetector.ts` | 85% | 80% | 90% | 85% | **PASS** |
| `deloadEngine.ts` | 96.5% | 95.3% | 100% | 96.3% | **PASS** |
| `exerciseSwapper.ts` | 96.3% | 88.7% | 100% | 96.8% | **PASS** |
| `bodyCompEngine.ts` | 97.9% | 95.3% | 100% | 97.8% | **PASS** |
| `discomfortTracker.ts` | 100% | 90.9% | 100% | 100% | **PASS** |
| `weightEstimationEngine.ts` | 82% | 75% | 85% | 82% | **PASS** |
| `fatigueBudgetEngine.ts` | 74.4% | 69.7% | 71.4% | 77% | **PASS** |
| `repRangeEngine.ts` | ~70% | ~60% | ~75% | ~70% | **PASS** |
| `sessionBuilderWithFatigue.ts` | ~65% | ~55% | ~70% | ~65% | **PASS** |
| `equipmentFilter.ts` | 69.7% | 88.9% | 50% | 66.7% | **PASS** |

### Library Utilities (9 test files)

| Module | Statements | Branches | Functions | Lines | Status |
|--------|------------|----------|-----------|-------|--------|
| `lib/utils.ts` | 91.1% | 93.9% | 85% | 93.2% | **PASS** |
| `lib/nutrition/macroCalculator.ts` | 78.5% | 76.4% | 95.8% | 78.4% | **PASS** |
| `lib/validation.ts` | 90%+ | 85%+ | 90%+ | 90%+ | **PASS** |
| `lib/errors.ts` | 85%+ | 80%+ | 85%+ | 85%+ | **PASS** |

### Hooks (3 test files)

| Hook | Status | Notes |
|------|--------|-------|
| `useRestTimer.ts` | **TESTED** | Timer functionality, start/stop/reset |
| `useWorkoutTimer.ts` | **TESTED** | Session duration tracking |
| `useActiveWorkout.ts` | **TESTED** | Active workout state management |

### Stores (2 test files)

| Store | Status | Notes |
|-------|--------|-------|
| `userStore.ts` | **TESTED** | User profile, preferences, auth state |
| `workoutStore.ts` | **TESTED** | Active session, exercise blocks |

### Components (6 test files)

| Component | Status | Notes |
|-----------|--------|-------|
| `Button.tsx` | **100%** | Full coverage |
| `Input.tsx` | **100%** | Full coverage |
| `Modal.tsx` | **96%** | Near-complete coverage |
| `ExerciseCard.tsx` | **33%** | Basic rendering, interactions |
| `RestTimer.tsx` | **34%** | Timer display, controls |
| Unit preference integration | **TESTED** | Cross-component unit handling |

---

## Configured Thresholds

From `jest.config.js`:

```javascript
coverageThreshold: {
  'lib/utils.ts': { lines: 55, functions: 40, branches: 75, statements: 55 },
  'services/progressionEngine.ts': { lines: 70, functions: 60, branches: 50 },
  'services/volumeTracker.ts': { lines: 70, functions: 60, branches: 50 },
  'services/fatigueEngine.ts': { lines: 70, functions: 60, branches: 50 },
  'services/plateauDetector.ts': { lines: 70, functions: 60, branches: 50 },
  'services/deloadEngine.ts': { lines: 70, functions: 60, branches: 50 },
  'services/exerciseSwapper.ts': { lines: 70, functions: 60, branches: 50 },
  'services/mesocycleBuilder.ts': { lines: 70, functions: 60, branches: 50 },
  'services/bodyCompEngine.ts': { lines: 70, functions: 70, branches: 50 },
}
```

**All configured thresholds are currently passing.**

---

## Areas Without Tests

### Services (0% coverage)

| Service | Priority | Notes |
|---------|----------|-------|
| `coachingEngine.ts` | Medium | AI coaching logic |
| `coachingContextService.ts` | Medium | Coaching context builder |
| `bodyweightService.ts` | Medium | Bodyweight exercise calculations |
| `exerciseService.ts` | Low | Exercise database access |
| `fatSecretService.ts` | Low | External nutrition API |
| `exercisePreferencesService.ts` | Low | User exercise preferences |

### Hooks (untested)

| Hook | Priority | Notes |
|------|----------|-------|
| `useProgressionTargets.ts` | High | Progression engine integration |
| `useWeeklyVolume.ts` | High | Volume tracking per muscle |
| `useUserPreferences.ts` | Medium | User preferences with unit conversion |
| `useExerciseHistory.ts` | Medium | Historical exercise data |
| `useMuscleRecovery.ts` | Low | Recovery state tracking |
| `useSubscription.ts` | Low | Stripe subscription status |
| `useAdaptiveVolume.ts` | Low | Adaptive volume recommendations |
| `useExercisePreferences.ts` | Low | Exercise favoriting/hiding |
| `usePWA.ts` | Low | PWA install prompt |

### Stores (untested)

| Store | Priority | Notes |
|-------|----------|-------|
| `exerciseStore.ts` | Medium | Exercise library cache |

### Components (75+ untested)

**High Priority:**
- `SetInputRow.tsx` - Primary data entry (86% partial coverage)
- `SessionSummary.tsx` - Workout completion
- `VolumeChart.tsx` / `E1RMGraph.tsx` - Analytics visualizations
- `MacroCalculatorModal.tsx` - Nutrition setup
- `DiscomfortLogger.tsx` - Injury tracking

**Medium Priority:**
- Dashboard cards (ActivityCard, CardioTracker)
- Workout components (WarmupProtocol, ExerciseDetailsModal)
- Nutrition components (BarcodeScanner, QuickFoodLogger)

### External Integrations (0% coverage)

- `lib/integrations/fitbit/*`
- `lib/integrations/healthkit/*`
- `lib/integrations/googleFit/*`
- `lib/training/coachingService.ts`
- `lib/nutrition/openFoodFactsService.ts`
- `lib/nutrition/usdaService.ts`

### API Routes (0% coverage)

- `app/api/stripe/*` - Payment webhooks
- `app/api/fitbit/*` - Fitbit OAuth
- `app/api/coaching/*` - AI coaching endpoints

---

## Test Patterns in Use

### Service Testing (Pure Functions)
```typescript
describe('calculateRecoveryFactors', () => {
  it('returns neutral multipliers for average profile', () => {
    const profile = createProfile({ age: 30, sleepQuality: 3 });
    const factors = calculateRecoveryFactors(profile);
    expect(factors.volumeMultiplier).toBeCloseTo(1.0, 1);
  });
});
```

### Hook Testing (renderHook + act)
```typescript
describe('useRestTimer', () => {
  beforeEach(() => jest.useFakeTimers());

  it('counts down every second', () => {
    const { result } = renderHook(() => useRestTimer({ defaultSeconds: 5 }));
    act(() => {
      result.current.start();
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.seconds).toBe(4);
  });
});
```

### Store Testing (Direct State)
```typescript
describe('userStore', () => {
  beforeEach(() => {
    useUserStore.setState({ user: null, isLoading: true });
  });

  it('updates preferences', () => {
    useUserStore.getState().setUser(mockUser);
    useUserStore.getState().updatePreferences({ units: 'lb' });
    expect(useUserStore.getState().user?.preferences.units).toBe('lb');
  });
});
```

### Component Testing (RTL + user-event)
```typescript
describe('ExerciseCard', () => {
  it('renders exercise name', () => {
    render(<ExerciseCard {...props} />);
    expect(screen.getByTestId('exercise-card')).toBeInTheDocument();
  });
});
```

---

## Test Utilities

**Location:** `test-utils/index.tsx`

Available helpers:
- `createMockUseUserPreferences()` - Mock user preference factory
- `renderWithPreferences()` - Custom render with preference context
- Re-exports from `@testing-library/react` and `@testing-library/user-event`

---

## Recommended Next Steps

### Phase 1: Expand Hook Coverage
1. Add tests for `useProgressionTargets.ts`
2. Add tests for `useWeeklyVolume.ts`
3. Add tests for `useUserPreferences.ts`

### Phase 2: Component Testing
1. Expand `ExerciseCard.tsx` coverage (currently 33%)
2. Add tests for `SessionSummary.tsx`
3. Add tests for analytics components

### Phase 3: Integration Testing
1. Add mocked tests for external APIs (Fitbit, USDA)
2. Add API route tests with mocked Supabase
3. Add E2E tests for critical user flows

---

## Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific file
npm test -- mesocycleBuilder.test

# Watch mode
npm run test:watch
```

---

## Progress Log

| Date | Change |
|------|--------|
| 2025-12-26 | Initial comprehensive analysis. All 34 test suites passing with 1,203 tests. All configured coverage thresholds met. |
