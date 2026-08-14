# Fixed representative recovery scenarios

Sleep 1.0, wearable 1.0, learned multiplier 1.0, 2 sessions/muscle/week.

"Old" columns use the retired step function and the pre-Bug-4 hamstrings
base; the old model had no final clamp.

## How to read the >25% rows

Every >25% row below is in the **novice** scenario, and every one of them is
the intended effect of Bug 6 rather than a side effect.

The retired step function keyed on ABSOLUTE set counts (>= 8 sets, or >= 2
hard sets) with no notion of capacity. A novice doing 4 sets with 1 hard set
landed in its dead zone — below both thresholds, above the light-session
threshold — and got a flat 0h adjustment, identically for every muscle.

The new model normalizes by capacity (direct MRV / planned frequency). For a
novice, 4 sets of a small muscle such as `glute_med` (MRV 8, 2x/wk ->
capacity 4) is a FULL session at capacity, so it earns a long window. The
same 4 sets on `quads` (MRV 18 -> capacity 9) does not. The old model could
not express that difference at all.

These are RECOVERY-window changes only. No prescribed-volume category moved —
see prescribed-volume.md, where landmark MAV, coarse presets and generator
allocation targets are all unchanged.

## Advanced enhanced — advanced, 8 effective sets, 3 hard

| Muscle | Old dose adj | New dose scale | Old raw | New raw | Old final | New final | Clamp | Δ% | Capacity muscle / MRV |
|---|---|---|---|---|---|---|---|---|---|
| `chest_upper` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `chest_upper` / 20 |
| `chest_lower` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `chest_lower` / 14 |
| `front_delts` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `front_delts` / 14 |
| `lateral_delts` | 24.00h | x1.23 | 58.78h | 48.06h | 58.78h | 48.06h | none | -18.2% | `lateral_delts` / 26 |
| `rear_delts` | 24.00h | x1.37 | 58.78h | 53.58h | 58.78h | 53.58h | none | -8.8% | `rear_delts` / 22 |
| `lats` | 24.00h | x1.23 | 68.57h | 60.08h | 68.57h | 60.08h | none | -12.4% | `lats` / 26 |
| `upper_back` | 24.00h | x1.45 | 68.57h | 71.02h | 68.57h | 71.02h | none | 3.6% | `upper_back` / 20 |
| `traps` | 24.00h | x1.45 | 68.57h | 71.02h | 68.57h | 71.02h | none | 3.6% | `traps` / 20 |
| `upper_traps` | 24.00h | x1.45 | 68.57h | 71.02h | 68.57h | 71.02h | none | 3.6% | `traps` / 20 |
| `mid_lower_traps` | 24.00h | x1.45 | 68.57h | 71.02h | 68.57h | 71.02h | none | 3.6% | `traps` / 20 |
| `biceps` | 24.00h | x1.37 | 48.98h | 40.18h | 48.98h | 40.18h | none | -18.0% | `biceps` / 22 |
| `triceps` | 24.00h | x1.37 | 48.98h | 40.18h | 48.98h | 40.18h | none | -18.0% | `triceps` / 22 |
| `triceps_long` | 24.00h | x1.37 | 48.98h | 40.18h | 48.98h | 40.18h | none | -18.0% | `triceps` / 22 |
| `triceps_lat_med` | 24.00h | x1.37 | 48.98h | 40.18h | 48.98h | 40.18h | none | -18.0% | `triceps` / 22 |
| `forearms` | 24.00h | x1.45 | 48.98h | 42.61h | 48.98h | 42.61h | none | -13.0% | `forearms` / 16 |
| `quads` | 24.00h | x1.23 | 68.57h | 60.08h | 68.57h | 60.08h | none | -12.4% | `quads` / 26 |
| `hamstrings` | 24.00h | x1.37 | 68.57h | 80.36h | 68.57h | 80.36h | none | 17.2% | `hamstrings` / 22 |
| `glutes` | 24.00h | x1.29 | 68.57h | 63.29h | 68.57h | 63.29h | none | -7.7% | `glutes` / 24 |
| `glute_med` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `glute_med` / 12 |
| `adductors` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `adductors` / 14 |
| `calves` | 24.00h | x1.23 | 48.98h | 36.05h | 48.98h | 36.05h | none | -26.4% **>25%** | `calves` / 26 |
| `gastrocnemius` | 24.00h | x1.23 | 48.98h | 36.05h | 48.98h | 36.05h | none | -26.4% **>25%** | `calves` / 26 |
| `soleus` | 24.00h | x1.23 | 48.98h | 36.05h | 48.98h | 36.05h | none | -26.4% **>25%** | `calves` / 26 |
| `abs` | 24.00h | x1.37 | 58.78h | 53.58h | 58.78h | 53.58h | none | -8.8% | `abs` / 22 |
| `obliques` | 24.00h | x1.45 | 58.78h | 56.82h | 58.78h | 56.82h | none | -3.3% | `obliques` / 12 |
| `erectors` | 24.00h | x1.45 | 68.57h | 71.02h | 68.57h | 71.02h | none | 3.6% | `erectors` / 14 |

Summary: 3/26 muscles moved more than 25%; 0/26 hit a guardrail.

## Novice natural — novice, 4 effective sets, 1 hard

| Muscle | Old dose adj | New dose scale | Old raw | New raw | Old final | New final | Clamp | Δ% | Capacity muscle / MRV |
|---|---|---|---|---|---|---|---|---|---|
| `chest_upper` | 0.00h | x1.26 | 48.00h | 60.66h | 48.00h | 60.66h | none | 26.4% **>25%** | `chest_upper` / 12 |
| `chest_lower` | 0.00h | x1.42 | 48.00h | 68.29h | 48.00h | 68.29h | none | 42.3% **>25%** | `chest_lower` / 10 |
| `front_delts` | 0.00h | x1.42 | 48.00h | 68.29h | 48.00h | 68.29h | none | 42.3% **>25%** | `front_delts` / 10 |
| `lateral_delts` | 0.00h | x1.05 | 48.00h | 50.31h | 48.00h | 50.31h | none | 4.8% | `lateral_delts` / 16 |
| `rear_delts` | 0.00h | x1.05 | 48.00h | 50.31h | 48.00h | 50.31h | none | 4.8% | `rear_delts` / 16 |
| `lats` | 0.00h | x1.05 | 60.00h | 62.89h | 60.00h | 62.89h | none | 4.8% | `lats` / 16 |
| `upper_back` | 0.00h | x1.14 | 60.00h | 68.59h | 60.00h | 68.59h | none | 14.3% | `upper_back` / 14 |
| `traps` | 0.00h | x1.14 | 60.00h | 68.59h | 60.00h | 68.59h | none | 14.3% | `traps` / 14 |
| `upper_traps` | 0.00h | x1.14 | 60.00h | 68.59h | 60.00h | 68.59h | none | 14.3% | `traps` / 14 |
| `mid_lower_traps` | 0.00h | x1.14 | 60.00h | 68.59h | 60.00h | 68.59h | none | 14.3% | `traps` / 14 |
| `biceps` | 0.00h | x1.14 | 36.00h | 41.15h | 36.00h | 41.15h | none | 14.3% | `biceps` / 14 |
| `triceps` | 0.00h | x1.14 | 36.00h | 41.15h | 36.00h | 41.15h | none | 14.3% | `triceps` / 14 |
| `triceps_long` | 0.00h | x1.14 | 36.00h | 41.15h | 36.00h | 41.15h | none | 14.3% | `triceps` / 14 |
| `triceps_lat_med` | 0.00h | x1.14 | 36.00h | 41.15h | 36.00h | 41.15h | none | 14.3% | `triceps` / 14 |
| `forearms` | 0.00h | x1.26 | 36.00h | 45.49h | 36.00h | 45.49h | none | 26.4% **>25%** | `forearms` / 12 |
| `quads` | 0.00h | x0.97 | 60.00h | 58.25h | 60.00h | 58.25h | none | -2.9% | `quads` / 18 |
| `hamstrings` | 0.00h | x1.14 | 60.00h | 82.31h | 60.00h | 82.31h | none | 37.2% **>25%** | `hamstrings` / 14 |
| `glutes` | 0.00h | x1.05 | 60.00h | 62.89h | 60.00h | 62.89h | none | 4.8% | `glutes` / 16 |
| `glute_med` | 0.00h | x1.45 | 48.00h | 69.60h | 48.00h | 69.60h | none | 45.0% **>25%** | `glute_med` / 8 |
| `adductors` | 0.00h | x1.42 | 48.00h | 68.29h | 48.00h | 68.29h | none | 42.3% **>25%** | `adductors` / 10 |
| `calves` | 0.00h | x0.97 | 36.00h | 34.95h | 36.00h | 34.95h | none | -2.9% | `calves` / 18 |
| `gastrocnemius` | 0.00h | x0.97 | 36.00h | 34.95h | 36.00h | 34.95h | none | -2.9% | `calves` / 18 |
| `soleus` | 0.00h | x0.97 | 36.00h | 34.95h | 36.00h | 34.95h | none | -2.9% | `calves` / 18 |
| `abs` | 0.00h | x1.14 | 48.00h | 54.87h | 48.00h | 54.87h | none | 14.3% | `abs` / 14 |
| `obliques` | 0.00h | x1.45 | 48.00h | 69.60h | 48.00h | 69.60h | none | 45.0% **>25%** | `obliques` / 8 |
| `erectors` | 0.00h | x1.42 | 60.00h | 85.36h | 60.00h | 85.36h | none | 42.3% **>25%** | `erectors` / 10 |

Summary: 9/26 muscles moved more than 25%; 0/26 hit a guardrail.
