-- Lifetime working-set totals for the signed-in user (profile / feed header).
--
-- The profile and feed pages used to SELECT every set the user had ever
-- logged on each visit just to count them and sum weight x reps. PostgREST
-- caps a select at max-rows (1000) without an error, so both totals silently
-- froze once a lifter passed ~1000 sets — and the request got slower forever.
-- This returns the two numbers as one aggregate row instead.
--
-- SECURITY INVOKER + auth.uid(): the caller can only ever aggregate their own
-- rows (RLS on set_logs / exercise_blocks / workout_sessions still applies).
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.get_my_lifetime_set_stats()
RETURNS TABLE (total_sets BIGINT, total_volume_kg NUMERIC)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::BIGINT AS total_sets,
    COALESCE(SUM(COALESCE(sl.weight_kg, 0) * COALESCE(sl.reps, 0)), 0)::NUMERIC AS total_volume_kg
  FROM set_logs sl
  JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
  JOIN workout_sessions ws ON ws.id = eb.workout_session_id
  WHERE ws.user_id = auth.uid()
    AND sl.is_warmup = FALSE;
$$;

REVOKE ALL ON FUNCTION public.get_my_lifetime_set_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_lifetime_set_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_lifetime_set_stats() TO authenticated;

COMMENT ON FUNCTION public.get_my_lifetime_set_stats() IS
  'Lifetime non-warmup set count and total volume (kg x reps) for auth.uid().';
