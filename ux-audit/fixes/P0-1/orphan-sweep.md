# Orphan sweep — verification artifacts in the account

Queried via service role, 2026-07-02 end of session.

## Result: clean (after removing 2 detached amrap rows)

| Table | Finding | Action |
|---|---|---|
| `workout_sessions` (started in my 8h work window) | **0** | none needed |
| `workout_sessions` (ad-hoc, planned today) | **0** — only session today is `6e1b0ac7`, the user's real completed workout (started 10:14, 22 sets), which predates this work | none |
| `set_logs` (today) | 22, all belong to `6e1b0ac7` | none — user's real data |
| `food_log` (today) | 6, all pre-existing (the audit-day breakfast/lunch) — my nutrition test cancelled without saving | none |
| `amrap_calibrations` (today) | 6: 4 linked to `6e1b0ac7` (real); **2 orphaned** (`workout_session_id` null, `set_log_id` null), both "Arnold Press" created 21:45 & 21:51 UTC — my profiling runs | **deleted** (see below) |
| `exercise_performance_snapshots` (today) | 0 (writer is dead code) | none |

## The 2 orphaned amrap rows

`e3b50378…` and `af31852d…` — both fully detached (session + set FKs null),
created in my verification window by the card-profiling runs. There is **no
in-app path** to delete a detached calibration row (the app only ever
cascade/SET-NULLs them), so — as my own artifacts attached to nothing — I
removed them directly via service role with a guard that only matches rows
where BOTH FKs are null:

```
DELETE amrap_calibrations WHERE id = <id> AND workout_session_id IS NULL AND set_log_id IS NULL
-> 204, 204
```

Re-check: orphaned amrap = `[]`; sessions started last 8h = `[]`; remaining
amrap today = 4, all on the real workout. **Account is clean.**

Root cause (pre-existing app behavior, flagged in archive-proposal.md): the
amrap FK is `ON DELETE SET NULL`, so cancelling any AMRAP workout orphans its
calibration rows. This is why my cancelled profiling sessions left these two.
