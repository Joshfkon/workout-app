-- ============================================
-- DURATION-AWARE LEADERBOARDS + ACTIVITY FEED
-- ============================================
-- Duration-based exercises (exercises.exercise_type = 'duration_based')
-- store SECONDS in set_logs.reps. Every SUM(weight_kg * reps) below treated
-- those seconds as reps, which either inflated tonnage (a 20 kg × 60 s
-- weighted plank injected 1,200 "kg" of volume into leaderboards and the
-- feed) or was semantically meaningless. This migration recreates the volume
-- leaderboard functions and the workout-activity trigger so duration sets:
--   * contribute ZERO tonnage (weight × seconds is not volume),
--   * still count toward total_sets on the feed card,
--   * carry an is_duration flag in the feed's exercise summary so clients
--     render "60s @ 20kg" instead of "20kg × 60".
-- Workouts-completed leaderboards count sessions and are unaffected.

-- ---------- Weekly volume leaderboard ----------
CREATE OR REPLACE FUNCTION calculate_weekly_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  v_period_start := date_trunc('week', CURRENT_DATE)::DATE;
  v_period_end := v_period_start + INTERVAL '6 days';

  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_week'
  AND period_start = v_period_start;

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'total_volume_week'::leaderboard_type,
    COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(sl.weight_kg * sl.reps), 0) DESC) as rank,
    prev.rank as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  JOIN exercise_blocks eb ON eb.workout_session_id = ws.id
  JOIN set_logs sl ON sl.exercise_block_id = eb.id
  JOIN exercises e ON e.id = eb.exercise_id
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'total_volume_week'
    AND le.period_start = v_period_start - INTERVAL '7 days'
  ) prev ON true
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND sl.is_warmup = false
    AND e.exercise_type <> 'duration_based'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id, prev.rank
  HAVING SUM(sl.weight_kg * sl.reps) > 0
  ORDER BY total_volume DESC;
END;
$$;

-- ---------- Monthly volume leaderboard ----------
CREATE OR REPLACE FUNCTION calculate_monthly_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_period_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_month'
  AND period_start = v_period_start;

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'total_volume_month'::leaderboard_type,
    COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(sl.weight_kg * sl.reps), 0) DESC) as rank,
    prev.rank as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  JOIN exercise_blocks eb ON eb.workout_session_id = ws.id
  JOIN set_logs sl ON sl.exercise_block_id = eb.id
  JOIN exercises e ON e.id = eb.exercise_id
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'total_volume_month'
    AND le.period_start = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE
  ) prev ON true
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND sl.is_warmup = false
    AND e.exercise_type <> 'duration_based'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id, prev.rank
  HAVING SUM(sl.weight_kg * sl.reps) > 0
  ORDER BY total_volume DESC;
END;
$$;

-- ---------- All-time volume leaderboard ----------
CREATE OR REPLACE FUNCTION calculate_alltime_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE := '2000-01-01'::DATE;
  v_period_end DATE := '2099-12-31'::DATE;
BEGIN
  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_alltime';

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'total_volume_alltime'::leaderboard_type,
    COALESCE(SUM(sl.weight_kg * sl.reps), 0) as total_volume,
    ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(sl.weight_kg * sl.reps), 0) DESC) as rank,
    NULL as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  JOIN exercise_blocks eb ON eb.workout_session_id = ws.id
  JOIN set_logs sl ON sl.exercise_block_id = eb.id
  JOIN exercises e ON e.id = eb.exercise_id
  WHERE sl.is_warmup = false
    AND ws.state = 'completed'
    AND e.exercise_type <> 'duration_based'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id
  HAVING SUM(sl.weight_kg * sl.reps) > 0
  ORDER BY total_volume DESC;
END;
$$;

-- ---------- Activity-feed workout card ----------
-- total_sets still counts duration sets (they are real work); total_volume_kg
-- excludes them; the per-exercise summary flags is_duration so clients render
-- the top set as time ("60s @ 20kg") instead of "20kg × 60".
CREATE OR REPLACE FUNCTION create_workout_activity()
RETURNS TRIGGER AS $$
DECLARE
  workout_data JSONB;
  exercise_data JSONB;
  total_sets INTEGER;
  total_volume NUMERIC;
  user_visibility TEXT;
BEGIN
  IF NEW.state = 'completed' AND (OLD.state IS NULL OR OLD.state != 'completed') THEN
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

    -- Workout stats: every working set counts; only rep-based sets carry tonnage
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(
        CASE WHEN e.exercise_type = 'duration_based' THEN 0
             ELSE sl.weight_kg * sl.reps END
      ), 0)
    INTO total_sets, total_volume
    FROM set_logs sl
    JOIN exercise_blocks eb ON sl.exercise_block_id = eb.id
    JOIN exercises e ON e.id = eb.exercise_id
    WHERE eb.workout_session_id = NEW.id
    AND sl.is_warmup = false;

    -- Exercise summary (top 3 exercises)
    SELECT COALESCE(jsonb_agg(exercise_summary), '[]'::jsonb)
    INTO exercise_data
    FROM (
      SELECT jsonb_build_object(
        'name', e.name,
        'sets', COUNT(sl.id),
        'is_duration', e.exercise_type = 'duration_based',
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
      GROUP BY e.id, e.name, e.exercise_type
      ORDER BY COUNT(sl.id) DESC
      LIMIT 3
    ) subq;

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

    INSERT INTO activities (user_id, activity_type, reference_type, reference_id, activity_data, visibility)
    VALUES (NEW.user_id, 'workout_completed', 'workout_session', NEW.id, workout_data, COALESCE(user_visibility, 'followers'));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
