-- Candidate sets for the "best lifts" calculation (hooks/useBestLifts.ts).
--
-- The hook used to read only the user's latest 500 sets of ANY exercise and
-- pick the best estimated 1RM among them, so a best lift older than the last
-- ~500 sets silently disappeared.
--
-- For each requested exercise this returns the HEAVIEST set at each rep count
-- (ties: most recent). Estimated 1RM rises with weight at a fixed rep count,
-- so the true best-e1RM set is always one of these rows whatever formula the
-- client applies — the client keeps computing e1RM itself (one formula, in
-- TypeScript), and the result is a few dozen rows instead of the whole log.
--
-- SECURITY INVOKER + auth.uid(): callers only ever see their own sets.
-- Filters mirror the hook's query: completed, non-deload sessions; non-warmup
-- sets with a weight and rep count. Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.get_my_best_lift_candidate_sets(p_exercise_names TEXT[])
RETURNS TABLE (
  exercise_name TEXT,
  weight_kg NUMERIC,
  reps INTEGER,
  logged_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT ON (LOWER(e.name), sl.reps)
    e.name::TEXT AS exercise_name,
    sl.weight_kg::NUMERIC AS weight_kg,
    sl.reps::INTEGER AS reps,
    sl.logged_at::TIMESTAMPTZ AS logged_at
  FROM set_logs sl
  JOIN exercise_blocks eb ON eb.id = sl.exercise_block_id
  JOIN workout_sessions ws ON ws.id = eb.workout_session_id
  JOIN exercises e ON e.id = eb.exercise_id
  WHERE ws.user_id = auth.uid()
    AND ws.state = 'completed'
    AND ws.is_deload = FALSE
    AND sl.is_warmup IS FALSE
    AND sl.weight_kg IS NOT NULL
    AND sl.reps IS NOT NULL
    AND LOWER(e.name) = ANY (p_exercise_names)
  ORDER BY LOWER(e.name), sl.reps, sl.weight_kg DESC, sl.logged_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_my_best_lift_candidate_sets(TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_best_lift_candidate_sets(TEXT[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_best_lift_candidate_sets(TEXT[]) TO authenticated;

COMMENT ON FUNCTION public.get_my_best_lift_candidate_sets(TEXT[]) IS
  'Heaviest set per (exercise, rep count) for auth.uid(); input names must be lower-case.';
