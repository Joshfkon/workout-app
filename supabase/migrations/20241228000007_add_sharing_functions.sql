-- Migration: Add RPC functions for workout sharing
-- Includes view/copy increment functions and copy workout functionality

-- Function to increment view count
CREATE OR REPLACE FUNCTION increment_shared_workout_views(workout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE shared_workouts
  SET view_count = view_count + 1
  WHERE id = workout_id;
END;
$$;

-- Function to increment copy count
CREATE OR REPLACE FUNCTION increment_shared_workout_copies(workout_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE shared_workouts
  SET copy_count = copy_count + 1
  WHERE id = workout_id;
END;
$$;

-- Function to copy a shared workout to user's templates
CREATE OR REPLACE FUNCTION copy_shared_workout(
  p_shared_workout_id UUID,
  p_target_mesocycle_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION increment_shared_workout_views(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_shared_workout_copies(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION copy_shared_workout(UUID, UUID) TO authenticated;
