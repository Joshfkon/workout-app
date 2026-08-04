# Report A — Detailed 26-muscle report

Generated from the implementation. Landmarks are `referenceDirectMRV`
(direct-set, experience-specific). Rows marked `boundedComponent` are
**subtargets inside the parent group capacity** — their values drive local
status and progression but are non-additive and must never be summed with
the parent.

`Capacity MRV` is the denominator Bug 6 normalizes session dose against;
for bounded components it resolves through the PARENT.

Representative recovery uses the Advanced-enhanced fixed scenario
(8 effective sets, 3 hard, 2 sessions/wk, sleep 1.0, wearable 1.0, learned 1.0).

| Muscle | Anatomical | Credit | Authority | Parent | Landmarks N / I / A (before → after) | Capacity MRV | Base recovery (before → after) | Rep raw (before → after) | Pre-clamp | Final | Clamp | Δ% final |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `chest_upper` | independent | independent | independent | — | 4/8/12 · 6/10/16 · 8/14/20 | 20 (`chest_upper`) | 48h | 58.78h → 57.87h | 57.87h | 57.87h | none | -1.5% |
| `chest_lower` | independent | independent | independent | — | 3/6/10 · 4/8/12 · 5/10/14 | 14 (`chest_lower`) | 48h | 58.78h → 58.78h | 58.78h | 58.78h | none | 0.0% |
| `front_delts` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`front_delts`) | 48h | 58.78h → 58.78h | 58.78h | 58.78h | none | 0.0% |
| `lateral_delts` | independent | independent | independent | — | 4/10/16 · 6/14/20 · 8/18/26 | 26 (`lateral_delts`) | 48h | 58.78h → 51.00h | 51.00h | 51.00h | none | -13.2% |
| `rear_delts` | independent | independent | independent | — | 4/10/16 · 6/12/18 · 8/16/22 | 22 (`rear_delts`) | 48h | 58.78h → 55.87h | 55.87h | 55.87h | none | -4.9% |
| `lats` | independent | independent | independent | — | 6/10/16 · 8/14/20 · 10/18/26 | 26 (`lats`) | 60h | 68.57h → 60.79h | 60.79h | 60.79h | none | -11.3% |
| `upper_back` | independent | independent | independent | — | 4/8/14 · 6/10/16 · 8/14/20 | 20 (`upper_back`) | 60h | 68.57h → 67.66h | 67.66h | 67.66h | none | -1.3% |
| `traps` | partialRollup | disjoint | groupCapacity | — | 3/8/14 · 4/10/16 · 6/12/20 | 20 (`traps`) | 48h | 58.78h → 57.87h | 57.87h | 57.87h | none | -1.5% |
| `upper_traps` | partialRollup | disjoint | boundedComponent | `traps` | 2/6/10 · 3/8/12 · 4/10/14 | 20 (`traps`) | 48h | 58.78h → 57.87h | 57.87h | 57.87h | none | -1.5% |
| `mid_lower_traps` | partialRollup | disjoint | boundedComponent | `traps` | 0/4/8 · 0/6/10 · 0/8/12 | 20 (`traps`) | 48h | 58.78h → 57.87h | 57.87h | 57.87h | none | -1.5% |
| `biceps` | independent | independent | independent | — | 4/10/14 · 6/12/18 · 8/16/22 | 22 (`biceps`) | 36h | 48.98h → 46.08h | 46.08h | 46.08h | none | -5.9% |
| `triceps` | completePartition | disjoint | groupCapacity | — | 4/10/14 · 6/12/18 · 8/16/22 | 22 (`triceps`) | 36h | 48.98h → 46.08h | 46.08h | 46.08h | none | -5.9% |
| `triceps_long` | completePartition | disjoint | boundedComponent | `triceps` | 3/7/12 · 4/10/18 · 6/13/20 | 22 (`triceps`) | 36h | 48.98h → 46.08h | 46.08h | 46.08h | none | -5.9% |
| `triceps_lat_med` | completePartition | disjoint | boundedComponent | `triceps` | 4/9/14 · **6/12/20 → 6/12/18** · **8/15/24 → 8/15/22** | 22 (`triceps`) | 36h | 48.98h → 46.08h | 46.08h | 46.08h | none | -5.9% |
| `forearms` | independent | independent | independent | — | 2/6/12 · 3/8/14 · 4/10/16 | 16 (`forearms`) | 36h | 48.98h → 48.98h | 48.98h | 48.98h | none | 0.0% |
| `quads` | independent | independent | independent | — | 6/12/18 · 8/14/22 · 10/18/26 | 26 (`quads`) | 60h | 68.57h → 60.79h | 60.79h | 60.79h | none | -11.3% |
| `hamstrings` | independent | independent | independent | — | 4/10/14 · 6/12/18 · 8/14/22 | 22 (`hamstrings`) | 60h → **72h** | 68.57h → 75.47h | 75.47h | 75.47h | none | 10.1% |
| `glutes` | independent | independent | independent | — | 4/10/16 · 6/12/20 · 8/16/24 | 24 (`glutes`) | 60h | 68.57h → 63.25h | 63.25h | 63.25h | none | -7.8% |
| `glute_med` | independent | independent | independent | — | 0/4/8 · 0/6/10 · 0/8/12 | 12 (`glute_med`) | 48h | 58.78h → 58.78h | 58.78h | 58.78h | none | 0.0% |
| `adductors` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`adductors`) | 48h | 58.78h → 58.78h | 58.78h | 58.78h | none | 0.0% |
| `calves` | completePartition | disjoint | groupCapacity | — | 6/12/18 · 8/14/22 · 10/18/26 | 26 (`calves`) | 36h | 48.98h → 41.20h | 41.20h | 41.20h | none | -15.9% |
| `gastrocnemius` | completePartition | disjoint | boundedComponent | `calves` | 4/8/14 · 6/10/16 · 8/14/20 | 26 (`calves`) | 36h | 48.98h → 41.20h | 41.20h | 41.20h | none | -15.9% |
| `soleus` | completePartition | disjoint | boundedComponent | `calves` | 2/6/10 · 3/8/12 · 4/10/14 | 26 (`calves`) | 36h | 48.98h → 41.20h | 41.20h | 41.20h | none | -15.9% |
| `abs` | independent | independent | independent | — | 3/8/14 · 4/10/18 · 6/14/22 | 22 (`abs`) | 48h | 58.78h → 55.87h | 55.87h | 55.87h | none | -4.9% |
| `obliques` | independent | independent | independent | — | 0/4/8 · 0/6/10 · 0/8/12 | 12 (`obliques`) | 48h | 58.78h → 58.78h | 58.78h | 58.78h | none | 0.0% |
| `erectors` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`erectors`) | 60h | 68.57h → 68.57h | 68.57h | 68.57h | none | 0.0% |
