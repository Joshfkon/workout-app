# Report E — Recovery diagnostics

## Anchor scenarios (advanced triceps, MRV 22, 2 sessions/wk, capacity 11)

| Effective sets | Hard sets | Dose adjustment |
|---|---|---|
| 0 | 0 | -12.00h |
| 2 | 0 | -11.87h |
| 5 | 2 | 4.33h |
| 8 | 3 | 20.45h |
| 11 | 6 | 24.00h |
| 14 | 9 | 24.00h |

## Planned-frequency sensitivity (ACTUAL sets fixed at 8 / 3 hard, advanced)

Ratios are deliberately NOT held fixed — frequency would cancel.

| Muscle | 1×/wk | 2×/wk | 3×/wk | 4×/wk | 5×/wk |
|---|---|---|---|---|---|
| `chest_upper` | -0.03h | 22.89h | 24.00h | 24.00h | 24.00h |
| `chest_lower` | 11.64h | 24.00h | 24.00h | 24.00h | 24.00h |
| `front_delts` | 11.64h | 24.00h | 24.00h | 24.00h | 24.00h |
| `lateral_delts` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `rear_delts` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `lats` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `upper_back` | -0.03h | 22.89h | 24.00h | 24.00h | 24.00h |
| `traps` | -0.03h | 22.89h | 24.00h | 24.00h | 24.00h |
| `upper_traps` | -0.03h | 22.89h | 24.00h | 24.00h | 24.00h |
| `mid_lower_traps` | -0.03h | 22.89h | 24.00h | 24.00h | 24.00h |
| `biceps` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `triceps` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `triceps_long` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `triceps_lat_med` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `forearms` | 6.77h | 24.00h | 24.00h | 24.00h | 24.00h |
| `quads` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `hamstrings` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `glutes` | -4.13h | 17.48h | 24.00h | 24.00h | 24.00h |
| `glute_med` | 17.48h | 24.00h | 24.00h | 24.00h | 24.00h |
| `adductors` | 11.64h | 24.00h | 24.00h | 24.00h | 24.00h |
| `calves` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `gastrocnemius` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `soleus` | -5.54h | 14.47h | 23.99h | 24.00h | 24.00h |
| `abs` | -2.34h | 20.45h | 24.00h | 24.00h | 24.00h |
| `obliques` | 17.48h | 24.00h | 24.00h | 24.00h | 24.00h |
| `erectors` | 11.64h | 24.00h | 24.00h | 24.00h | 24.00h |

## Steepest change from +0.5 ACTUAL sets

Reported, not failed: for a small-capacity muscle 0.5 sets is a large
normalized change, so a steep value here is expected rather than a defect.

| Muscle | Experience | Planned freq | Max Δ per +0.5 sets |
|---|---|---|---|
| `glute_med` | novice | 5×/wk | 13.39h |
| `obliques` | novice | 5×/wk | 13.39h |
| `chest_lower` | novice | 5×/wk | 9.60h |
| `front_delts` | novice | 5×/wk | 9.60h |
| `glute_med` | novice | 4×/wk | 9.60h |
| `adductors` | novice | 5×/wk | 9.60h |
| `obliques` | novice | 4×/wk | 9.60h |
| `erectors` | novice | 5×/wk | 9.60h |
| `glute_med` | intermediate | 5×/wk | 9.60h |
| `obliques` | intermediate | 5×/wk | 9.60h |
| `chest_upper` | novice | 5×/wk | 9.32h |
| `forearms` | novice | 5×/wk | 9.32h |

Gentlest case: `soleus` @ advanced, 1×/wk → 0.89h

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
