# Report D — Fiber behaviour

| Live consumer | Accepted key type | Uses shared resolver? | Fine keys reachable? |
|---|---|---|---|
| `repRangeEngine.calculateRepRange` | `MuscleGroup \| StandardMuscleGroup` (widened) | yes | yes |
| `repRangeEngine.getDUPRepRange` | `MuscleGroup \| StandardMuscleGroup` (widened) | yes | yes |
| `fatigueBudgetEngine.calculateExerciseFatigue` | any token (exercise.primaryMuscle) | yes (delegates) | yes |
| `fatigueBudgetEngine.calculateRecoveryRate` | any token | yes (delegates) | via primary muscle |
| `programEngine.calculateRepRange` | `MuscleGroup` | yes (rerouted) | only if caller passes one |
| `lib/training/constants.MUSCLE_FIBER_PROFILE` | `MuscleGroup` | **no — deprecated, no live readers** | no |

## Resolved fiber type per standard muscle

| Muscle | Fiber type |
|---|---|
| `chest_upper` | mixed |
| `chest_lower` | mixed |
| `front_delts` | mixed |
| `lateral_delts` | mixed |
| `rear_delts` | mixed |
| `lats` | mixed |
| `upper_back` | mixed |
| `traps` | mixed |
| `upper_traps` | mixed |
| `mid_lower_traps` | mixed |
| `biceps` | mixed |
| `triceps` | fast |
| `triceps_long` | fast |
| `triceps_lat_med` | fast |
| `forearms` | slow |
| `quads` | mixed |
| `hamstrings` | fast |
| `glutes` | mixed |
| `glute_med` | mixed |
| `adductors` | mixed |
| `calves` | slow |
| `gastrocnemius` | mixed |
| `soleus` | slow |
| `abs` | slow |
| `obliques` | slow |
| `erectors` | mixed |
