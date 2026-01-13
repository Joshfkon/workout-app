-- Migration: Add monthly and all-time leaderboard calculation functions
-- Extends leaderboards with monthly and all-time rankings

-- Add new leaderboard types to the enum
ALTER TYPE leaderboard_type ADD VALUE IF NOT EXISTS 'total_volume_alltime';
ALTER TYPE leaderboard_type ADD VALUE IF NOT EXISTS 'workouts_completed_alltime';

-- Function to calculate monthly volume leaderboard
CREATE OR REPLACE FUNCTION calculate_monthly_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  -- Calculate for current month
  v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  v_period_end := (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  -- Delete existing entries for this period
  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_month'
  AND period_start = v_period_start;

  -- Insert new rankings
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
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'total_volume_month'
    AND le.period_start = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE
  ) prev ON true
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND sl.is_warmup = false
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

-- Function to calculate monthly workouts completed leaderboard
CREATE OR REPLACE FUNCTION calculate_monthly_workouts_leaderboard()
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
  WHERE leaderboard_type = 'workouts_completed_month'
  AND period_start = v_period_start;

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'workouts_completed_month'::leaderboard_type,
    COUNT(*)::NUMERIC as workout_count,
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as rank,
    prev.rank as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'workouts_completed_month'
    AND le.period_start = (date_trunc('month', CURRENT_DATE) - INTERVAL '1 month')::DATE
  ) prev ON true
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND ws.state = 'completed'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id, prev.rank
  HAVING COUNT(*) > 0
  ORDER BY workout_count DESC;
END;
$$;

-- Function to calculate all-time volume leaderboard
CREATE OR REPLACE FUNCTION calculate_alltime_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE := '2000-01-01'::DATE;
  v_period_end DATE := '2099-12-31'::DATE;
BEGIN
  -- Delete existing all-time entries
  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_alltime';

  -- Insert new rankings (all-time cumulative)
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
  WHERE sl.is_warmup = false
    AND ws.state = 'completed'
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

-- Function to calculate all-time workouts completed leaderboard
CREATE OR REPLACE FUNCTION calculate_alltime_workouts_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE := '2000-01-01'::DATE;
  v_period_end DATE := '2099-12-31'::DATE;
BEGIN
  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'workouts_completed_alltime';

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'workouts_completed_alltime'::leaderboard_type,
    COUNT(*)::NUMERIC as workout_count,
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as rank,
    NULL as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  WHERE ws.state = 'completed'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id
  HAVING COUNT(*) > 0
  ORDER BY workout_count DESC;
END;
$$;

-- Update get_leaderboard function to handle all-time type
CREATE OR REPLACE FUNCTION get_leaderboard(
  p_type leaderboard_type,
  p_exercise_id UUID DEFAULT NULL,
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  score NUMERIC,
  rank INTEGER,
  previous_rank INTEGER,
  rank_change INTEGER,
  period_start DATE,
  period_end DATE,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
BEGIN
  -- Get current period start based on type
  IF p_type IN ('total_volume_week', 'workouts_completed_week') THEN
    v_period_start := date_trunc('week', CURRENT_DATE)::DATE;
  ELSIF p_type IN ('total_volume_month', 'workouts_completed_month') THEN
    v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  ELSE
    -- All-time uses fixed start date
    v_period_start := '2000-01-01'::DATE;
  END IF;

  RETURN QUERY
  SELECT
    le.id,
    le.user_id,
    le.score,
    le.rank,
    le.previous_rank,
    CASE
      WHEN le.previous_rank IS NULL THEN 0
      ELSE le.previous_rank - le.rank
    END as rank_change,
    le.period_start,
    le.period_end,
    up.username,
    up.display_name,
    up.avatar_url
  FROM leaderboard_entries le
  JOIN user_profiles up ON up.user_id = le.user_id
  WHERE le.leaderboard_type = p_type
    AND le.period_start = v_period_start
    AND (p_exercise_id IS NULL OR le.exercise_id = p_exercise_id)
    AND up.show_on_leaderboards = true
  ORDER BY le.rank ASC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Update get_user_rank function to handle all-time type
CREATE OR REPLACE FUNCTION get_user_rank(
  p_user_id UUID,
  p_type leaderboard_type,
  p_exercise_id UUID DEFAULT NULL
)
RETURNS TABLE (
  rank INTEGER,
  score NUMERIC,
  previous_rank INTEGER,
  rank_change INTEGER,
  total_participants INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
BEGIN
  IF p_type IN ('total_volume_week', 'workouts_completed_week') THEN
    v_period_start := date_trunc('week', CURRENT_DATE)::DATE;
  ELSIF p_type IN ('total_volume_month', 'workouts_completed_month') THEN
    v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
  ELSE
    v_period_start := '2000-01-01'::DATE;
  END IF;

  RETURN QUERY
  SELECT
    le.rank,
    le.score,
    le.previous_rank,
    CASE
      WHEN le.previous_rank IS NULL THEN 0
      ELSE le.previous_rank - le.rank
    END as rank_change,
    (SELECT COUNT(*)::INTEGER FROM leaderboard_entries
     WHERE leaderboard_type = p_type AND period_start = v_period_start) as total_participants
  FROM leaderboard_entries le
  WHERE le.user_id = p_user_id
    AND le.leaderboard_type = p_type
    AND le.period_start = v_period_start
    AND (p_exercise_id IS NULL OR le.exercise_id = p_exercise_id);
END;
$$;

-- Grant execute permissions for new functions
GRANT EXECUTE ON FUNCTION calculate_monthly_volume_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_monthly_workouts_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_alltime_volume_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_alltime_workouts_leaderboard() TO authenticated;
