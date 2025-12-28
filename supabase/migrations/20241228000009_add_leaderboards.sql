-- Migration: Add leaderboards functionality
-- Enables competitive features with weekly/monthly rankings

-- Leaderboard types enum
DO $$ BEGIN
  CREATE TYPE leaderboard_type AS ENUM (
    'total_volume_week',
    'total_volume_month',
    'workout_streak',
    'exercise_1rm',
    'workouts_completed_week',
    'workouts_completed_month'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Leaderboard entries (updated periodically)
CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leaderboard_type leaderboard_type NOT NULL,

  -- For exercise-specific leaderboards
  exercise_id UUID REFERENCES exercises(id) ON DELETE CASCADE,

  -- Ranking
  score NUMERIC(14,2) NOT NULL,
  rank INTEGER,
  previous_rank INTEGER,

  -- Context
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_leaderboard_entry UNIQUE (user_id, leaderboard_type, exercise_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_type_rank
  ON leaderboard_entries (leaderboard_type, exercise_id, period_start, rank);
CREATE INDEX IF NOT EXISTS idx_leaderboard_user
  ON leaderboard_entries (user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_period
  ON leaderboard_entries (period_start, period_end);

-- Add leaderboard opt-in to user profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS show_on_leaderboards BOOLEAN NOT NULL DEFAULT true;

-- Friend groups for private leaderboards
CREATE TABLE IF NOT EXISTS friend_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friend_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES friend_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_group_member UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_groups_owner ON friend_groups (owner_id);
CREATE INDEX IF NOT EXISTS idx_friend_group_members_group ON friend_group_members (group_id);
CREATE INDEX IF NOT EXISTS idx_friend_group_members_user ON friend_group_members (user_id);

-- RLS Policies
ALTER TABLE leaderboard_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE friend_group_members ENABLE ROW LEVEL SECURITY;

-- Leaderboards are viewable for opted-in users
CREATE POLICY "View leaderboards for opted-in users"
  ON leaderboard_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = leaderboard_entries.user_id
      AND user_profiles.show_on_leaderboards = true
    )
  );

-- Users can view their own entries regardless of opt-in
CREATE POLICY "View own leaderboard entries"
  ON leaderboard_entries FOR SELECT
  USING (auth.uid() = user_id);

-- Friend groups policies
CREATE POLICY "View own groups"
  ON friend_groups FOR SELECT
  USING (owner_id = auth.uid() OR EXISTS (
    SELECT 1 FROM friend_group_members
    WHERE friend_group_members.group_id = friend_groups.id
    AND friend_group_members.user_id = auth.uid()
  ));

CREATE POLICY "Create groups"
  ON friend_groups FOR INSERT
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Update own groups"
  ON friend_groups FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Delete own groups"
  ON friend_groups FOR DELETE
  USING (owner_id = auth.uid());

-- Friend group members policies
CREATE POLICY "View group members"
  ON friend_group_members FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM friend_group_members fgm
      WHERE fgm.group_id = friend_group_members.group_id
      AND fgm.user_id = auth.uid()
    )
  );

CREATE POLICY "Join groups"
  ON friend_group_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Leave groups"
  ON friend_group_members FOR DELETE
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM friend_groups
    WHERE friend_groups.id = friend_group_members.group_id
    AND friend_groups.owner_id = auth.uid()
  ));

-- Function to calculate weekly volume leaderboard
CREATE OR REPLACE FUNCTION calculate_weekly_volume_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  -- Calculate for current week (Monday to Sunday)
  v_period_start := date_trunc('week', CURRENT_DATE)::DATE;
  v_period_end := v_period_start + INTERVAL '6 days';

  -- Delete existing entries for this period
  DELETE FROM leaderboard_entries
  WHERE leaderboard_type = 'total_volume_week'
  AND period_start = v_period_start;

  -- Insert new rankings
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
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND sl.is_warmup = false
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'total_volume_week'
    AND le.period_start = v_period_start - INTERVAL '7 days'
  ) prev ON true
  HAVING SUM(sl.weight_kg * sl.reps) > 0
  ORDER BY total_volume DESC;
END;
$$;

-- Function to calculate workouts completed leaderboard
CREATE OR REPLACE FUNCTION calculate_weekly_workouts_leaderboard()
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
  WHERE leaderboard_type = 'workouts_completed_week'
  AND period_start = v_period_start;

  INSERT INTO leaderboard_entries (
    user_id, leaderboard_type, score, rank, previous_rank, period_start, period_end
  )
  SELECT
    ws.user_id,
    'workouts_completed_week'::leaderboard_type,
    COUNT(*)::NUMERIC as workout_count,
    ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) as rank,
    prev.rank as previous_rank,
    v_period_start,
    v_period_end
  FROM workout_sessions ws
  WHERE ws.completed_at >= v_period_start
    AND ws.completed_at < v_period_end + INTERVAL '1 day'
    AND ws.state = 'completed'
    AND EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.user_id = ws.user_id
      AND up.show_on_leaderboards = true
    )
  GROUP BY ws.user_id
  LEFT JOIN LATERAL (
    SELECT rank FROM leaderboard_entries le
    WHERE le.user_id = ws.user_id
    AND le.leaderboard_type = 'workouts_completed_week'
    AND le.period_start = v_period_start - INTERVAL '7 days'
  ) prev ON true
  HAVING COUNT(*) > 0
  ORDER BY workout_count DESC;
END;
$$;

-- Function to get leaderboard with profiles
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
  -- Get current period start
  IF p_type IN ('total_volume_week', 'workouts_completed_week') THEN
    v_period_start := date_trunc('week', CURRENT_DATE)::DATE;
  ELSE
    v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
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

-- Function to get user's rank on a leaderboard
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
  ELSE
    v_period_start := date_trunc('month', CURRENT_DATE)::DATE;
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION calculate_weekly_volume_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_weekly_workouts_leaderboard() TO authenticated;
GRANT EXECUTE ON FUNCTION get_leaderboard(leaderboard_type, UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_rank(UUID, leaderboard_type, UUID) TO authenticated;
