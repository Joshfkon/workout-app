-- ============================================
-- LEGACY LOCATION BACKFILL
-- ============================================
-- Location stamping (20260711000004) is only as good as the history behind
-- it: sets logged before a user started using locations carry
-- location_id = NULL, and rule 6 (services/progressionScope) shows those
-- legacy sets at EVERY gym when no stamped location dominates. For a user
-- whose entire history predates stamping, a brand-new gym therefore looks
-- like it already has full history — no softened starting point, no
-- separated records — and once stamped sets accumulate at the NEW gym, the
-- old history gets attributed there permanently (most-used-stamped wins).
--
-- This function lets the user say "all my unassigned history was at gym X"
-- once, from Settings. One transaction, so sessions and sets can never be
-- left half-stamped (there is no cross-request transaction over PostgREST,
-- which is why this is an RPC rather than two client updates).
--
-- SECURITY INVOKER on purpose: every UPDATE runs under the caller's RLS
-- policies, and the WHERE clauses scope to auth.uid() explicitly as well.
-- Only COMPLETED sessions are touched — an in-progress session's location
-- is live UI state (the workout page re-stamps its sets itself), and
-- planned/skipped shells have nothing meaningful to file.

-- --------------------------------------------
-- Narrow the completion trigger to completion-relevant columns
-- --------------------------------------------
-- update_session_completion counts non-warmup set ROWS against target_sets;
-- no set VALUE feeds it. The original trigger fired on every UPDATE, so a
-- location-only bulk re-stamp (this backfill, or the mid-workout re-stamp in
-- lib/training/sessionLocation.ts) would run its two aggregate queries and a
-- session rewrite once per set — thousands of redundant scans for the exact
-- cohort this backfill serves, enough to threaten the statement timeout.
-- Completion can only change when a row appears/disappears, moves to another
-- block, or flips is_warmup — so fire UPDATE only on those columns.
DROP TRIGGER IF EXISTS update_completion_on_set_log ON set_logs;
CREATE TRIGGER update_completion_on_set_log
  AFTER INSERT OR DELETE OR UPDATE OF exercise_block_id, is_warmup ON set_logs
  FOR EACH ROW EXECUTE FUNCTION update_session_completion();

CREATE OR REPLACE FUNCTION backfill_legacy_location(p_location_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_sessions_stamped INTEGER := 0;
  v_sets_stamped INTEGER := 0;
BEGIN
  -- The target must be one of the caller's own gyms; a bad id must fail
  -- loudly rather than stamp history onto nothing.
  IF NOT EXISTS (
    SELECT 1 FROM gym_locations
    WHERE id = p_location_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'location % does not belong to the current user', p_location_id;
  END IF;

  -- Sessions first, so the set pass below can inherit from them.
  UPDATE workout_sessions
  SET location_id = p_location_id
  WHERE user_id = auth.uid()
    AND state = 'completed'
    AND location_id IS NULL;
  GET DIAGNOSTICS v_sessions_stamped = ROW_COUNT;

  -- Null sets inherit their block's effective location — the same
  -- override-then-session order as resolveEffectiveLocation
  -- (services/progressionScope), so a per-exercise machine pin is honored
  -- even on a session whose own location was just stamped above.
  UPDATE set_logs sl
  SET location_id = COALESCE(eb.location_id, ws.location_id)
  FROM exercise_blocks eb
  JOIN workout_sessions ws ON ws.id = eb.workout_session_id
  WHERE eb.id = sl.exercise_block_id
    AND sl.location_id IS NULL
    AND ws.user_id = auth.uid()
    AND ws.state = 'completed'
    AND COALESCE(eb.location_id, ws.location_id) IS NOT NULL;
  GET DIAGNOSTICS v_sets_stamped = ROW_COUNT;

  RETURN jsonb_build_object(
    'sessions_stamped', v_sessions_stamped,
    'sets_stamped', v_sets_stamped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION backfill_legacy_location(UUID) TO authenticated;

COMMENT ON FUNCTION backfill_legacy_location(UUID) IS
  'Assign all of the caller''s pre-location (NULL location_id) completed history to one gym: stamps completed sessions, then their null sets via the block-override-then-session rule. Returns {sessions_stamped, sets_stamped}.';
