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

| Muscle | Old dose | New dose | Old raw | New raw | Old final | New final | Clamp | Δ% | Capacity muscle / MRV |
|---|---|---|---|---|---|---|---|---|---|
| `chest_upper` | 24.00h | 22.89h | 58.78h | 57.87h | 58.78h | 57.87h | none | -1.5% | `chest_upper` / 20 |
| `chest_lower` | 24.00h | 24.00h | 58.78h | 58.78h | 58.78h | 58.78h | none | 0.0% | `chest_lower` / 14 |
| `front_delts` | 24.00h | 24.00h | 58.78h | 58.78h | 58.78h | 58.78h | none | 0.0% | `front_delts` / 14 |
| `lateral_delts` | 24.00h | 14.47h | 58.78h | 51.00h | 58.78h | 51.00h | none | -13.2% | `lateral_delts` / 26 |
| `rear_delts` | 24.00h | 20.45h | 58.78h | 55.87h | 58.78h | 55.87h | none | -4.9% | `rear_delts` / 22 |
| `lats` | 24.00h | 14.47h | 68.57h | 60.79h | 68.57h | 60.79h | none | -11.3% | `lats` / 26 |
| `upper_back` | 24.00h | 22.89h | 68.57h | 67.66h | 68.57h | 67.66h | none | -1.3% | `upper_back` / 20 |
| `traps` | 24.00h | 22.89h | 58.78h | 57.87h | 58.78h | 57.87h | none | -1.5% | `traps` / 20 |
| `upper_traps` | 24.00h | 22.89h | 58.78h | 57.87h | 58.78h | 57.87h | none | -1.5% | `traps` / 20 |
| `mid_lower_traps` | 24.00h | 22.89h | 58.78h | 57.87h | 58.78h | 57.87h | none | -1.5% | `traps` / 20 |
| `biceps` | 24.00h | 20.45h | 48.98h | 46.08h | 48.98h | 46.08h | none | -5.9% | `biceps` / 22 |
| `triceps` | 24.00h | 20.45h | 48.98h | 46.08h | 48.98h | 46.08h | none | -5.9% | `triceps` / 22 |
| `triceps_long` | 24.00h | 20.45h | 48.98h | 46.08h | 48.98h | 46.08h | none | -5.9% | `triceps` / 22 |
| `triceps_lat_med` | 24.00h | 20.45h | 48.98h | 46.08h | 48.98h | 46.08h | none | -5.9% | `triceps` / 22 |
| `forearms` | 24.00h | 24.00h | 48.98h | 48.98h | 48.98h | 48.98h | none | 0.0% | `forearms` / 16 |
| `quads` | 24.00h | 14.47h | 68.57h | 60.79h | 68.57h | 60.79h | none | -11.3% | `quads` / 26 |
| `hamstrings` | 24.00h | 20.45h | 68.57h | 75.47h | 68.57h | 75.47h | none | 10.1% | `hamstrings` / 22 |
| `glutes` | 24.00h | 17.48h | 68.57h | 63.25h | 68.57h | 63.25h | none | -7.8% | `glutes` / 24 |
| `glute_med` | 24.00h | 24.00h | 58.78h | 58.78h | 58.78h | 58.78h | none | 0.0% | `glute_med` / 12 |
| `adductors` | 24.00h | 24.00h | 58.78h | 58.78h | 58.78h | 58.78h | none | 0.0% | `adductors` / 14 |
| `calves` | 24.00h | 14.47h | 48.98h | 41.20h | 48.98h | 41.20h | none | -15.9% | `calves` / 26 |
| `gastrocnemius` | 24.00h | 14.47h | 48.98h | 41.20h | 48.98h | 41.20h | none | -15.9% | `calves` / 26 |
| `soleus` | 24.00h | 14.47h | 48.98h | 41.20h | 48.98h | 41.20h | none | -15.9% | `calves` / 26 |
| `abs` | 24.00h | 20.45h | 58.78h | 55.87h | 58.78h | 55.87h | none | -4.9% | `abs` / 22 |
| `obliques` | 24.00h | 24.00h | 58.78h | 58.78h | 58.78h | 58.78h | none | 0.0% | `obliques` / 12 |
| `erectors` | 24.00h | 24.00h | 68.57h | 68.57h | 68.57h | 68.57h | none | 0.0% | `erectors` / 14 |

Summary: 0/26 muscles moved more than 25%; 0/26 hit a guardrail.

## Novice natural — novice, 4 effective sets, 1 hard

| Muscle | Old dose | New dose | Old raw | New raw | Old final | New final | Clamp | Δ% | Capacity muscle / MRV |
|---|---|---|---|---|---|---|---|---|---|
| `chest_upper` | 0.00h | 12.62h | 48.00h | 60.62h | 48.00h | 60.62h | none | 26.3% **>25%** | `chest_upper` / 12 |
| `chest_lower` | 0.00h | 18.02h | 48.00h | 66.02h | 48.00h | 66.02h | none | 37.5% **>25%** | `chest_lower` / 10 |
| `front_delts` | 0.00h | 18.02h | 48.00h | 66.02h | 48.00h | 66.02h | none | 37.5% **>25%** | `front_delts` / 10 |
| `lateral_delts` | 0.00h | 3.00h | 48.00h | 51.00h | 48.00h | 51.00h | none | 6.2% | `lateral_delts` / 16 |
| `rear_delts` | 0.00h | 3.00h | 48.00h | 51.00h | 48.00h | 51.00h | none | 6.2% | `rear_delts` / 16 |
| `lats` | 0.00h | 3.00h | 60.00h | 63.00h | 60.00h | 63.00h | none | 5.0% | `lats` / 16 |
| `upper_back` | 0.00h | 7.30h | 60.00h | 67.30h | 60.00h | 67.30h | none | 12.2% | `upper_back` / 14 |
| `traps` | 0.00h | 7.30h | 48.00h | 55.30h | 48.00h | 55.30h | none | 15.2% | `traps` / 14 |
| `upper_traps` | 0.00h | 7.30h | 48.00h | 55.30h | 48.00h | 55.30h | none | 15.2% | `traps` / 14 |
| `mid_lower_traps` | 0.00h | 7.30h | 48.00h | 55.30h | 48.00h | 55.30h | none | 15.2% | `traps` / 14 |
| `biceps` | 0.00h | 7.30h | 36.00h | 43.30h | 36.00h | 43.30h | none | 20.3% | `biceps` / 14 |
| `triceps` | 0.00h | 7.30h | 36.00h | 43.30h | 36.00h | 43.30h | none | 20.3% | `triceps` / 14 |
| `triceps_long` | 0.00h | 7.30h | 36.00h | 43.30h | 36.00h | 43.30h | none | 20.3% | `triceps` / 14 |
| `triceps_lat_med` | 0.00h | 7.30h | 36.00h | 43.30h | 36.00h | 43.30h | none | 20.3% | `triceps` / 14 |
| `forearms` | 0.00h | 12.62h | 36.00h | 48.62h | 36.00h | 48.62h | none | 35.0% **>25%** | `forearms` / 12 |
| `quads` | 0.00h | -0.32h | 60.00h | 59.68h | 60.00h | 59.68h | none | -0.5% | `quads` / 18 |
| `hamstrings` | 0.00h | 7.30h | 60.00h | 79.30h | 60.00h | 79.30h | none | 32.2% **>25%** | `hamstrings` / 14 |
| `glutes` | 0.00h | 3.00h | 60.00h | 63.00h | 60.00h | 63.00h | none | 5.0% | `glutes` / 16 |
| `glute_med` | 0.00h | 21.15h | 48.00h | 69.15h | 48.00h | 69.15h | none | 44.1% **>25%** | `glute_med` / 8 |
| `adductors` | 0.00h | 18.02h | 48.00h | 66.02h | 48.00h | 66.02h | none | 37.5% **>25%** | `adductors` / 10 |
| `calves` | 0.00h | -0.32h | 36.00h | 35.68h | 36.00h | 35.68h | none | -0.9% | `calves` / 18 |
| `gastrocnemius` | 0.00h | -0.32h | 36.00h | 35.68h | 36.00h | 35.68h | none | -0.9% | `calves` / 18 |
| `soleus` | 0.00h | -0.32h | 36.00h | 35.68h | 36.00h | 35.68h | none | -0.9% | `calves` / 18 |
| `abs` | 0.00h | 7.30h | 48.00h | 55.30h | 48.00h | 55.30h | none | 15.2% | `abs` / 14 |
| `obliques` | 0.00h | 21.15h | 48.00h | 69.15h | 48.00h | 69.15h | none | 44.1% **>25%** | `obliques` / 8 |
| `erectors` | 0.00h | 18.02h | 60.00h | 78.02h | 60.00h | 78.02h | none | 30.0% **>25%** | `erectors` / 10 |

Summary: 9/26 muscles moved more than 25%; 0/26 hit a guardrail.
