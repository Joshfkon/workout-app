# Report E — Recovery diagnostics

## Anchor scenarios (advanced triceps, MRV 22, 2 sessions/wk, capacity 11)

| Effective sets | Hard sets | Dose scale (x base window) |
|---|---|---|
| 0 | 0 | x0.20 |
| 2 | 0 | x0.52 |
| 5 | 2 | x1.01 |
| 8 | 3 | x1.37 |
| 11 | 6 | x1.45 |
| 14 | 9 | x1.45 |

## Planned-frequency sensitivity (ACTUAL sets fixed at 8 / 3 hard, advanced)

Ratios are deliberately NOT held fixed — frequency would cancel.

| Muscle | 1×/wk | 2×/wk | 3×/wk | 4×/wk | 5×/wk |
|---|---|---|---|---|---|
| `chest_upper` | x0.93 | x1.45 | x1.45 | x1.45 | x1.45 |
| `chest_lower` | x1.17 | x1.45 | x1.45 | x1.45 | x1.45 |
| `front_delts` | x1.17 | x1.45 | x1.45 | x1.45 | x1.45 |
| `lateral_delts` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `rear_delts` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `lats` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `upper_back` | x0.93 | x1.45 | x1.45 | x1.45 | x1.45 |
| `traps` | x0.93 | x1.45 | x1.45 | x1.45 | x1.45 |
| `upper_traps` | x0.93 | x1.45 | x1.45 | x1.45 | x1.45 |
| `mid_lower_traps` | x0.93 | x1.45 | x1.45 | x1.45 | x1.45 |
| `biceps` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `triceps` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `triceps_long` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `triceps_lat_med` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `forearms` | x1.07 | x1.45 | x1.45 | x1.45 | x1.45 |
| `quads` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `hamstrings` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `glutes` | x0.82 | x1.29 | x1.45 | x1.45 | x1.45 |
| `glute_med` | x1.29 | x1.45 | x1.45 | x1.45 | x1.45 |
| `adductors` | x1.17 | x1.45 | x1.45 | x1.45 | x1.45 |
| `calves` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `gastrocnemius` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `soleus` | x0.78 | x1.23 | x1.45 | x1.45 | x1.45 |
| `abs` | x0.87 | x1.37 | x1.45 | x1.45 | x1.45 |
| `obliques` | x1.29 | x1.45 | x1.45 | x1.45 | x1.45 |
| `erectors` | x1.17 | x1.45 | x1.45 | x1.45 | x1.45 |

## Steepest change from +0.5 ACTUAL sets

Reported, not failed: for a small-capacity muscle 0.5 sets is a large
normalized change, so a steep value here is expected rather than a defect.

| Muscle | Experience | Planned freq | Max Δ per +0.5 sets |
|---|---|---|---|
| `glute_med` | novice | 5×/wk | 0.54h |
| `obliques` | novice | 5×/wk | 0.54h |
| `chest_lower` | novice | 5×/wk | 0.44h |
| `front_delts` | novice | 5×/wk | 0.44h |
| `glute_med` | novice | 4×/wk | 0.44h |
| `adductors` | novice | 5×/wk | 0.44h |
| `obliques` | novice | 4×/wk | 0.44h |
| `erectors` | novice | 5×/wk | 0.44h |
| `glute_med` | intermediate | 5×/wk | 0.44h |
| `obliques` | intermediate | 5×/wk | 0.44h |
| `chest_upper` | novice | 5×/wk | 0.37h |
| `forearms` | novice | 5×/wk | 0.37h |

Gentlest case: `soleus` @ advanced, 1×/wk → 0.05h

## Planned-frequency source (live)

Planned per-muscle frequency is read from the ACTIVE MESOCYCLE:
`mesocycles.program_data` -> `getWeekSessionsFromProgramData(currentWeek)` ->
`plannedSessionsPerWeekByMuscle`, which counts how many PLANNED sessions in
the current week touch each muscle (once per session, primary or secondary).

Resolution order and what it means:

| Source | When | Meaning |
|---|---|---|
| `perMuscle` | active mesocycle covers this muscle | plan-derived, best |
| `program` | a program-wide frequency was supplied | plan-derived, no per-muscle detail |
| `fallback` | no active plan, or the muscle is not in it | DEFAULT_PLANNED_SESSIONS_PER_WEEK = 2 |

Fallback is expected and legitimate for freestyle/template-only users, who
have no plan to read. `getFrequencySourceMetrics()` reports the live split so
the fallback share is observable rather than assumed.

Frequency is deliberately NEVER derived from trailing observed sessions:
observed frequency rises as the week fills, which would re-interpret an
already-completed session as a lighter dose and retroactively shrink its
recovery window.

## Clamp saturation

Measured by `services/__tests__/recoveryWindowBounds.test.ts` from the
implementation (never hard-coded). Ordinary grid: 11,960 valid cases
(5,980 unique recovery-input states × 2 planned frequencies).
Build fails above 5% on either bound.
