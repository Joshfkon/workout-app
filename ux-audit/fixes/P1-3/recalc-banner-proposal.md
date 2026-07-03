# P1-3 recalc banner — approach + STOP

Accepted as designed: read-time stats self-heal, planned targets stay frozen.
You asked to add a banner on planned sessions whose targets derive from
since-edited data, with an explicit recalc action, and to **stop before
implementing if it touches the progression engine's stored suggestions.**

**It touches them on both sides. Stopping. Proposal below.**

## Why both halves are gated

### Recalc action — touches stored suggestions (engine)
A planned session's per-block targets are **stored** on
`exercise_blocks.target_weight_kg` / `target_rir` / `target_rep_range`,
computed at session-build time from historical E1RM
(`weightEstimationEngine.quickWeightEstimate` + `sessionBuilderWithFatigue`).
"Recalculate" means re-running that estimator against the now-corrected
history and **overwriting those stored rows**. That is exactly the progression
engine's stored output — the thing the stop rule protects.

### Detection — needs a schema change
"Targets derive from **since-edited** data" requires knowing an edit happened
*after* the target was computed. We have `exercise_blocks.created_at` (when the
target was written) but `set_logs` has only `logged_at` (creation) — **no
`updated_at`/`edited_at`** (confirmed in the initial migration). So a P1-3 edit
today leaves no timestamp to compare against. Reliable detection needs one of:

| Option | Change | Precision |
|---|---|---|
| A. `set_logs.edited_at timestamptz` | schema (add column; P1-3 sets it) | exact per-set; banner can name which exercises are stale |
| B. `users.last_history_edit_at timestamptz` | schema (add column; P1-3 sets it) | coarse — "you edited history after this was planned," can't say which exercise |
| C. client-only flag (no persistence) | no schema | only within the same app session as the edit; lost on reload — too weak to be trustworthy |

## Recommended approach (for your sign-off)

1. **Detection: Option A** (`set_logs.edited_at`). P1-3's `saveSetEdit` already
   runs an `update` — add `edited_at: new Date().toISOString()` to it. Then a
   planned block is "stale" iff any `set_log` for the same exercise, in an
   earlier completed session, has `edited_at > thisBlock.created_at`. Exact,
   lets the banner name the affected lifts, one extra column.
2. **Banner (shippable once detection exists):** small warning card on the
   planned session — "Targets for Bench Press use data you've since edited —
   recalculate?" — with a **Recalculate** button. Purely presentational until
   the button is wired; safe to build first.
3. **Recalc action (the gated part):** on tap, re-run
   `quickWeightEstimate` for the stale blocks and `update` their
   `target_weight_kg` (+ optionally `target_rir`/`target_rep_range`).
   **Risk to weigh:** this overwrites any *manual* target the user set on the
   planned session. Mitigation options — (a) only recalc blocks whose target
   still equals the last engine output (never manually touched); (b) confirm
   dialog listing what will change; (c) recalc all, unconditionally. I'd pick
   (a)+(b).

## What I'd build vs. what needs your word

- **No sign-off needed:** the banner shell + Option-A detection column are
  low-risk and don't rewrite engine output. But the column is still a schema
  change, so per your rules I'm not adding it unprompted.
- **Needs sign-off:** the recalc write itself (overwrites stored targets) and
  the manual-target mitigation choice above.

Reply with the detection option (A/B/C) and the mitigation (a/b/c) and I'll
implement to it in one commit.
