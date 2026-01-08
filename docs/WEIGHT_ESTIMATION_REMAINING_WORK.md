# Weight Estimation Engine - Refactor Complete ✅

This document tracks items from the weight estimation refactor. **All tasks are now complete.**

> **Summary:** The weight estimation engine has been fully refactored with improved accuracy,
> centralized code, and persistence support for hysteresis counters.

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

## Completed in January 2026 Iteration

- [x] **Standalone Canonicalization Module** - Created `services/exerciseCanonical.ts` with centralized exercise name matching
- [x] **Shared Strength Calculations** - Created `services/shared/strengthCalculations.ts` with single source of truth for E1RM and working weight calculations
- [x] **Additional Volatile Exercises** - Added volatile flag to Machine Chest Press, Hack Squat, Cable Fly, and Seated Cable Row
- [x] **Persist Lower Session Counts** - Added persistence support for hysteresis counters via `UserStrengthProfile.lowerSessionCounts` and `getLowerSessionCounts()` method

## Remaining Items (Lower Priority)

### 1. ~~Create Standalone Canonicalization Module~~ ✅ COMPLETED

**Status:** Completed in January 2026

Created `services/exerciseCanonical.ts` with:
- `CanonicalExercise` interface with key, displayName, and aliases
- `normalizeExerciseName()` - normalizes exercise names for matching
- `findExerciseMatch()` - finds canonical exercise name from input
- `getCanonicalKey()` - gets snake_case key for database lookups
- `getDisplayName()` - gets user-friendly display name
- `canonicalizeExercise()` - returns full canonical object
- `isSameExercise()` - compares two exercise names

---

### 2. ~~Extract Shared Strength Calculations~~ ✅ COMPLETED

**Status:** Completed in January 2026

Created `services/shared/strengthCalculations.ts` with:
- `rpeToRIR()` - converts RPE to RIR with bounds and rep-range awareness
- `rirToRPE()` - converts RIR back to RPE
- `estimate1RM()` - multi-formula E1RM calculation (Brzycki, Epley, Lombardi average)
- `estimateE1RMSimple()` - simple Epley-only E1RM calculation
- `calculateWorkingWeight()` - Brzycki-derived working weight with bounds
- `calculateWorkingWeightSimple()` - Epley inverse working weight
- `getPercentageOf1RM()` - get percentage for rep/RIR target
- `estimateRepsAtPercentage()` - inverse calculation

Both `weightEstimationEngine.ts` and `progressionEngine.ts` now import from this shared module.

---

### 3. ~~Add More Volatile Exercise Relationships~~ ✅ COMPLETED

**Status:** Completed in January 2026

Added `volatile: true` to:
- Machine Chest Press (machine lever arms, angles, and resistance curves vary)
- Hack Squat (machine angle, sled weight, and foot placement options vary)
- Cable Fly (cable stack weight increments and pulley ratios vary)
- Seated Cable Row (cable stack varies between machines)

---

### 4. ~~Persist Lower Session Counts~~ ✅ COMPLETED

**Status:** Completed in January 2026

Added persistence support for hysteresis counters:

1. **Extended `UserStrengthProfile` interface** with optional `lowerSessionCounts?: Record<string, number>` field
2. **Updated constructor** to initialize from profile if `lowerSessionCounts` is provided
3. **Added `getLowerSessionCounts()` method** to export current counts for persistence (returns plain object suitable for JSON serialization)
4. **Updated `createStrengthProfile()` helper** to accept optional `lowerSessionCounts` parameter

**Usage for persistence:**
```typescript
// After updating from workout
engine.updateFromWorkout(exerciseName, sets);

// Get counts for persistence (e.g., save to user profile in database)
const countsToSave = engine.getLowerSessionCounts();
// Save countsToSave to database/localStorage

// Later, when recreating the engine
const savedCounts = /* load from database/localStorage */;
const profile = createStrengthProfile(
  heightCm, weightKg, bodyFatPercent, experience, trainingAge,
  exerciseHistory, regionalData, savedCounts
);
const engine = new WeightEstimationEngine(profile, 'kg');
```

**Integration Note:** The actual persistence mechanism (database column, localStorage key, etc.) should be implemented where the engine is instantiated, typically in a hook or service that manages user workout data

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
| `services/progressionEngine.ts` | Workout progression calculations (now uses shared module) |
| `services/exerciseCanonical.ts` | **NEW** - Centralized exercise name matching and canonicalization |
| `services/shared/strengthCalculations.ts` | **NEW** - Single source of truth for E1RM and working weight calculations |
| `services/__tests__/weightEstimationEngine.test.ts` | Test file (needs updates for new interface) |
