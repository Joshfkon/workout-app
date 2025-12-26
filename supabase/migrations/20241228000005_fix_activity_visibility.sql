-- Migration: Fix activity visibility for public profiles
-- Activities from users with public profiles should be visible in discover feed

CREATE OR REPLACE FUNCTION create_workout_activity()
RETURNS TRIGGER AS $$
DECLARE
  workout_data JSONB;
  exercise_data JSONB;
  total_sets INTEGER;
  total_volume NUMERIC;
  user_visibility TEXT;
BEGIN
  -- Only create activity when workout is completed
  IF NEW.state = 'completed' AND (OLD.state IS NULL OR OLD.state != 'completed') THEN
    -- Get user's profile visibility preference
    SELECT COALESCE(
      CASE
        WHEN show_workouts = false THEN 'private'
        WHEN profile_visibility = 'private' THEN 'private'
        WHEN profile_visibility = 'followers_only' THEN 'followers'
        WHEN profile_visibility = 'public' THEN 'public'
        ELSE 'followers'
      END,
      'followers'
    ) INTO user_visibility
    FROM user_profiles WHERE user_id = NEW.user_id;

    -- Calculate workout stats
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(weight_kg * reps), 0)
    INTO total_sets, total_volume
    FROM set_logs sl
    JOIN exercise_blocks eb ON sl.exercise_block_id = eb.id
    WHERE eb.workout_session_id = NEW.id
    AND sl.is_warmup = false;

    -- Get exercise summary (top 3 exercises)
    SELECT COALESCE(jsonb_agg(exercise_summary), '[]'::jsonb)
    INTO exercise_data
    FROM (
      SELECT jsonb_build_object(
        'name', e.name,
        'sets', COUNT(sl.id),
        'top_set', jsonb_build_object(
          'weight_kg', MAX(sl.weight_kg),
          'reps', MAX(sl.reps)
        )
      ) as exercise_summary
      FROM exercise_blocks eb
      JOIN exercises e ON eb.exercise_id = e.id
      JOIN set_logs sl ON sl.exercise_block_id = eb.id
      WHERE eb.workout_session_id = NEW.id
      AND sl.is_warmup = false
      GROUP BY e.id, e.name
      ORDER BY COUNT(sl.id) DESC
      LIMIT 3
    ) subq;

    -- Build workout data
    workout_data := jsonb_build_object(
      'type', 'workout_completed',
      'workout_name', COALESCE(
        (SELECT name FROM mesocycles WHERE id = NEW.mesocycle_id),
        'Workout'
      ),
      'duration_minutes', EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) / 60,
      'total_sets', total_sets,
      'total_volume_kg', total_volume,
      'exercises', exercise_data,
      'session_rpe', NEW.session_rpe
    );

    -- Insert activity
    INSERT INTO activities (user_id, activity_type, reference_type, reference_id, activity_data, visibility)
    VALUES (NEW.user_id, 'workout_completed', 'workout_session', NEW.id, workout_data, COALESCE(user_visibility, 'followers'));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

