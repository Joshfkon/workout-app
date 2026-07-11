-- ============================================================================
-- Helper: count set logs attached to a set of exercises (via exercise_blocks).
-- Used by scripts/mergeExercises.ts dry-run so the reported number lines up
-- with the audit's "Set logs" column (the merge function itself reports
-- exercise_blocks = workout instances, which is a smaller number).
-- Read-only; safe to run anytime.
-- ============================================================================
CREATE OR REPLACE FUNCTION count_setlogs_for_exercises(p_ids UUID[])
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM set_logs sl
  JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
  WHERE eb.exercise_id = ANY (p_ids);
$$;

REVOKE ALL ON FUNCTION count_setlogs_for_exercises(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION count_setlogs_for_exercises(UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION count_setlogs_for_exercises(UUID[]) TO service_role;
