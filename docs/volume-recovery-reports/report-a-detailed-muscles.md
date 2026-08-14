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
| `chest_upper` | independent | independent | independent | — | 4/8/12 · 6/10/16 · 8/14/20 | 20 (`chest_upper`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `chest_lower` | independent | independent | independent | — | 3/6/10 · 4/8/12 · 5/10/14 | 14 (`chest_lower`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `front_delts` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`front_delts`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `lateral_delts` | independent | independent | independent | — | 4/10/16 · 6/14/20 · 8/18/26 | 26 (`lateral_delts`) | 48h | 58.78h → 48.06h | 48.06h | 48.06h | none | -18.2% |
| `rear_delts` | independent | independent | independent | — | 4/10/16 · 6/12/18 · 8/16/22 | 22 (`rear_delts`) | 48h | 58.78h → 53.58h | 53.58h | 53.58h | none | -8.8% |
| `lats` | independent | independent | independent | — | 6/10/16 · 8/14/20 · 10/18/26 | 26 (`lats`) | 60h | 68.57h → 60.08h | 60.08h | 60.08h | none | -12.4% |
| `upper_back` | independent | independent | independent | — | 4/8/14 · 6/10/16 · 8/14/20 | 20 (`upper_back`) | 60h | 68.57h → 71.02h | 71.02h | 71.02h | none | 3.6% |
| `traps` | partialRollup | disjoint | groupCapacity | — | 3/8/14 · 4/10/16 · 6/12/20 | 20 (`traps`) | 60h | 68.57h → 71.02h | 71.02h | 71.02h | none | 3.6% |
| `upper_traps` | partialRollup | disjoint | boundedComponent | `traps` | 2/6/10 · 3/8/12 · 4/10/14 | 20 (`traps`) | 60h | 68.57h → 71.02h | 71.02h | 71.02h | none | 3.6% |
| `mid_lower_traps` | partialRollup | disjoint | boundedComponent | `traps` | 0/4/8 · 0/6/10 · 0/8/12 | 20 (`traps`) | 60h | 68.57h → 71.02h | 71.02h | 71.02h | none | 3.6% |
| `biceps` | independent | independent | independent | — | 4/10/14 · 6/12/18 · 8/16/22 | 22 (`biceps`) | 36h | 48.98h → 40.18h | 40.18h | 40.18h | none | -18.0% |
| `triceps` | completePartition | disjoint | groupCapacity | — | 4/10/14 · 6/12/18 · 8/16/22 | 22 (`triceps`) | 36h | 48.98h → 40.18h | 40.18h | 40.18h | none | -18.0% |
| `triceps_long` | completePartition | disjoint | boundedComponent | `triceps` | 3/7/12 · 4/10/18 · 6/13/20 | 22 (`triceps`) | 36h | 48.98h → 40.18h | 40.18h | 40.18h | none | -18.0% |
| `triceps_lat_med` | completePartition | disjoint | boundedComponent | `triceps` | 4/9/14 · **6/12/20 → 6/12/18** · **8/15/24 → 8/15/22** | 22 (`triceps`) | 36h | 48.98h → 40.18h | 40.18h | 40.18h | none | -18.0% |
| `forearms` | independent | independent | independent | — | 2/6/12 · 3/8/14 · 4/10/16 | 16 (`forearms`) | 36h | 48.98h → 42.61h | 42.61h | 42.61h | none | -13.0% |
| `quads` | independent | independent | independent | — | 6/12/18 · 8/14/22 · 10/18/26 | 26 (`quads`) | 60h | 68.57h → 60.08h | 60.08h | 60.08h | none | -12.4% |
| `hamstrings` | independent | independent | independent | — | 4/10/14 · 6/12/18 · 8/14/22 | 22 (`hamstrings`) | 60h → **72h** | 68.57h → 80.36h | 80.36h | 80.36h | none | 17.2% |
| `glutes` | independent | independent | independent | — | 4/10/16 · 6/12/20 · 8/16/24 | 24 (`glutes`) | 60h | 68.57h → 63.29h | 63.29h | 63.29h | none | -7.7% |
| `glute_med` | independent | independent | independent | — | 0/4/8 · 0/6/10 · 0/8/12 | 12 (`glute_med`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `adductors` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`adductors`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `calves` | completePartition | disjoint | groupCapacity | — | 6/12/18 · 8/14/22 · 10/18/26 | 26 (`calves`) | 36h | 48.98h → 36.05h | 36.05h | 36.05h | none | -26.4% **>25%** |
| `gastrocnemius` | completePartition | disjoint | boundedComponent | `calves` | 4/8/14 · 6/10/16 · 8/14/20 | 26 (`calves`) | 36h | 48.98h → 36.05h | 36.05h | 36.05h | none | -26.4% **>25%** |
| `soleus` | completePartition | disjoint | boundedComponent | `calves` | 2/6/10 · 3/8/12 · 4/10/14 | 26 (`calves`) | 36h | 48.98h → 36.05h | 36.05h | 36.05h | none | -26.4% **>25%** |
| `abs` | independent | independent | independent | — | 3/8/14 · 4/10/18 · 6/14/22 | 22 (`abs`) | 48h | 58.78h → 53.58h | 53.58h | 53.58h | none | -8.8% |
| `obliques` | independent | independent | independent | — | 0/4/8 · 0/6/10 · 0/8/12 | 12 (`obliques`) | 48h | 58.78h → 56.82h | 56.82h | 56.82h | none | -3.3% |
| `erectors` | independent | independent | independent | — | 2/6/10 · 3/8/12 · 4/10/14 | 14 (`erectors`) | 60h | 68.57h → 71.02h | 71.02h | 71.02h | none | 3.6% |
