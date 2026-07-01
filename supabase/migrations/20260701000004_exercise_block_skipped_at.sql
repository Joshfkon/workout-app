-- Phase 2.3: "Skip today" on upcoming exercises in the active workout.
-- A skipped block stays on the session (so the plan is preserved and the skip
-- is undoable) but is excluded from the header progress, summary aggregates,
-- and progression/feedback derivations. NULL = not skipped.
ALTER TABLE exercise_blocks
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;

COMMENT ON COLUMN exercise_blocks.skipped_at IS
  'When the user skipped this exercise for the session (NULL = not skipped). Skipped blocks are excluded from progress/summary/progression.';
