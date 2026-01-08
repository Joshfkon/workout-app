# Weight Estimation Engine - Remaining Work

This document tracks remaining items from the weight estimation refactor that were deferred for a future iteration.

## Completed in This Refactor

All critical correctness and estimation quality issues have been addressed:

- [x] Canonicalization wired up in `getEstimated1RM()`
- [x] Unit handling fixed (returns values in requested unit with `weightUnit` field)
- [x] Asymmetry function improved (`getAsymmetryMultiplier()` returns clear multiplier)
- [x] Volatile flag added to exercise relationships
- [x] Estimate selection improved (median-of-top-3 with recency weighting)
- [x] RPE math fixed (RIR capped, compressed for high-rep sets)
- [x] Working weight curve bounded for high reps
- [x] Extrapolated confidence distinguished from low confidence
- [x] Hysteresis added to update logic (3 consecutive sessions required)
- [x] Week-to-week smoothing added (7.5% max change)
- [x] Variance fields used in range calculations
- [x] Relationship graph validation added

## Remaining Items (Lower Priority)

### 1. Create Standalone Canonicalization Module

**Current State:** Canonicalization functions (`normalizeExerciseName`, `findExerciseMatch`) are inline in `weightEstimationEngine.ts`.

**Proposed Change:** Create a dedicated module at `services/exerciseCanonical.ts`:

```typescript
// services/exerciseCanonical.ts

export interface CanonicalExercise {
  key: string;           // Lowercase, normalized key for lookups
  displayName: string;   // User-friendly name
  aliases: string[];     // Alternative names that map to this
}

const CANONICAL_EXERCISES: CanonicalExercise[] = [
  {
    key: 'barbell_bench_press',
    displayName: 'Barbell Bench Press',
    aliases: ['bench press', 'flat bench', 'bb bench', 'barbell bench']
  },
  // ... etc
];

export function canonicalizeExercise(name: string): CanonicalExercise | null;
export function getCanonicalKey(name: string): string;
export function getDisplayName(name: string): string;
```

**Benefits:**
- Centralized exercise name matching logic
- Easier to add new aliases
- Can be reused across the codebase (e.g., in exercise search, history matching)

**Effort:** Medium - requires updating imports in weightEstimationEngine.ts and testing

---

### 2. Extract Shared Strength Calculations

**Current State:** `estimate1RM()` is duplicated in:
- `services/weightEstimationEngine.ts`
- `services/progressionEngine.ts` (per comment in code)

**Proposed Change:** Create shared module at `services/shared/strengthCalculations.ts`:

```typescript
// services/shared/strengthCalculations.ts

export function estimate1RM(weight: number, reps: number, rpe?: number): number;
export function calculateWorkingWeight(estimated1RM: number, targetReps: number, targetRIR: number): number;
export function rpeToRIR(rpe: number | undefined, reps: number): number;
```

**Benefits:**
- Single source of truth for strength math
- Easier to update formulas consistently
- Reduces code duplication

**Effort:** Low - extract functions and update imports

---

### 3. Add More Volatile Exercise Relationships

**Current State:** The following exercises are marked as volatile:
- Leg Press
- Lat Pulldown
- Leg Extension
- Lying Leg Curl

**Consider Adding:**
- Machine Chest Press (machine varies)
- Hack Squat (machine varies)
- Cable Fly (cable stack varies)
- Any "Machine" prefixed exercises

**Effort:** Low - just add `volatile: true` to relevant relationships

---

### 4. Persist Lower Session Counts

**Current State:** `lowerSessionCounts` Map is in-memory only, reset when engine is recreated.

**Issue:** If the user closes the app between workouts, the hysteresis counter resets.

**Proposed Change:** Store counts in the user's profile or local storage.

**Effort:** Medium - requires coordination with data persistence layer

---

## Testing Checklist

After implementing any of the above, verify:

- [ ] Exercise names like "Incline Bench", "DB Row", "Smith Bench Press" resolve correctly
- [ ] Unit display matches actual values (kg shows kg, lb shows lb)
- [ ] Leg Press and Lat Pulldown show appropriately wide ranges and lower confidence
- [ ] Multiple bad sessions required to lower an estimated max
- [ ] Recommendations don't jump more than ~7.5% between weeks without new PR data
- [ ] Strength standards estimates show as 'extrapolated' confidence
- [ ] Asymmetry adjustments apply correctly (weaker side gets lower weight)
- [ ] High-rep (>12) working weight calculations are conservative

---

## File References

| File | Purpose |
|------|---------|
| `services/weightEstimationEngine.ts` | Main weight estimation logic |
| `services/progressionEngine.ts` | Contains duplicate `estimate1RM` |
| `services/__tests__/weightEstimationEngine.test.ts` | Test file (needs updates for new interface) |
