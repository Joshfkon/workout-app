-- Security review "smaller items": workout-sharing SECURITY DEFINER functions.
--
-- * increment_shared_workout_views / _copies had no search_path and were
--   executable by PUBLIC (so by anon). Views stays callable by signed-in users
--   (the Discover page calls it) but only counts public workouts. Copies is
--   not called by the app — copy_shared_workout increments the counter itself
--   — so it becomes service-role only.
-- * copy_shared_workout inserted a workout_sessions row under any
--   p_target_mesocycle_id without checking the caller owns that mesocycle.

CREATE OR REPLACE FUNCTION increment_shared_workout_views(workout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  UPDATE shared_workouts
  SET view_count = view_count + 1
  WHERE id = workout_id AND is_public = true;
END;
$$;

CREATE OR REPLACE FUNCTION increment_shared_workout_copies(workout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE shared_workouts
  SET copy_count = copy_count + 1
  WHERE id = workout_id;
END;
$$;

CREATE OR REPLACE FUNCTION copy_shared_workout(
  p_shared_workout_id UUID,
  p_target_mesocycle_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_shared_workout RECORD;
  v_new_workout_id UUID;
  v_exercise JSONB;
  v_exercise_order INTEGER := 0;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to copy workouts';
  END IF;

  -- The target mesocycle, when given, must belong to the caller.
  IF p_target_mesocycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM mesocycles
    WHERE id = p_target_mesocycle_id AND user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Target mesocycle not found';
  END IF;

  -- Get the shared workout
  SELECT * INTO v_shared_workout
  FROM shared_workouts
  WHERE id = p_shared_workout_id AND is_public = true;

  IF v_shared_workout IS NULL THEN
    RAISE EXCEPTION 'Shared workout not found or not public';
  END IF;

  -- Create a new workout session as a template
  INSERT INTO workout_sessions (
    user_id,
    mesocycle_id,
    status,
    started_at,
    notes
  ) VALUES (
    v_user_id,
    p_target_mesocycle_id,
    'template',
    NOW(),
    'Copied from: ' || v_shared_workout.title
  )
  RETURNING id INTO v_new_workout_id;

  -- Create exercise blocks from the shared workout data
  FOR v_exercise IN SELECT * FROM jsonb_array_elements(v_shared_workout.workout_data -> 'exercises')
  LOOP
    INSERT INTO exercise_blocks (
      workout_session_id,
      exercise_id,
      target_sets,
      target_rep_range,
      target_rir,
      note,
      "order"
    ) VALUES (
      v_new_workout_id,
      (v_exercise ->> 'exercise_id')::UUID,
      (v_exercise ->> 'sets')::INTEGER,
      ARRAY[(v_exercise -> 'rep_range' ->> 0)::INTEGER, (v_exercise -> 'rep_range' ->> 1)::INTEGER],
      (v_exercise ->> 'target_rir')::INTEGER,
      v_exercise ->> 'notes',
      v_exercise_order
    );
    v_exercise_order := v_exercise_order + 1;
  END LOOP;

  -- Increment the copy count
  UPDATE shared_workouts
  SET copy_count = copy_count + 1
  WHERE id = p_shared_workout_id;

  RETURN v_new_workout_id;
END;
$$;

REVOKE ALL ON FUNCTION increment_shared_workout_views(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION increment_shared_workout_copies(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION copy_shared_workout(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION increment_shared_workout_views(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION increment_shared_workout_copies(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION copy_shared_workout(UUID, UUID) TO authenticated, service_role;
