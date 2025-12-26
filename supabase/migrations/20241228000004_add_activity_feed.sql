-- Migration: Add activity feed for social features
-- Enables users to see workout completions, PRs, and other activities from people they follow

-- Activity types enum
CREATE TYPE activity_type AS ENUM (
  'workout_completed',
  'personal_record',
  'streak_milestone',
  'badge_earned',
  'mesocycle_completed',
  'followed_user',
  'shared_workout'
);

-- Activity feed items
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type activity_type NOT NULL,

  -- Polymorphic reference to related entity
  reference_type TEXT, -- 'workout_session', 'exercise', 'user', etc.
  reference_id UUID,

  -- Denormalized data for fast feed rendering
  activity_data JSONB NOT NULL DEFAULT '{}',

  -- Privacy (inherits from user or can be overridden)
  visibility TEXT NOT NULL DEFAULT 'followers'
    CHECK (visibility IN ('public', 'followers', 'private')),

  -- Engagement counts (denormalized for performance)
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft delete for hiding without removing
  hidden_at TIMESTAMPTZ
);

CREATE INDEX idx_activities_user_id ON activities (user_id, created_at DESC);
CREATE INDEX idx_activities_created_at ON activities (created_at DESC) WHERE hidden_at IS NULL;
CREATE INDEX idx_activities_type ON activities (activity_type);
CREATE INDEX idx_activities_reference ON activities (reference_type, reference_id);

-- Reactions/likes on activities
CREATE TABLE activity_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL DEFAULT 'like'
    CHECK (reaction_type IN ('like', 'fire', 'muscle', 'clap')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_reaction UNIQUE (activity_id, user_id)
);

CREATE INDEX idx_activity_reactions_activity ON activity_reactions (activity_id);
CREATE INDEX idx_activity_reactions_user ON activity_reactions (user_id);

-- Comments on activities
CREATE TABLE activity_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK (char_length(content) <= 1000),

  -- Reply threading
  parent_comment_id UUID REFERENCES activity_comments(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ -- Soft delete
);

CREATE INDEX idx_activity_comments_activity ON activity_comments (activity_id, created_at);
CREATE INDEX idx_activity_comments_user ON activity_comments (user_id);
CREATE INDEX idx_activity_comments_parent ON activity_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Trigger to update reaction count on activities
CREATE OR REPLACE FUNCTION update_activity_reaction_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE activities SET reaction_count = reaction_count + 1 WHERE id = NEW.activity_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE activities SET reaction_count = GREATEST(0, reaction_count - 1) WHERE id = OLD.activity_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_activity_reaction_count
  AFTER INSERT OR DELETE ON activity_reactions
  FOR EACH ROW EXECUTE FUNCTION update_activity_reaction_count();

-- Trigger to update comment count on activities
CREATE OR REPLACE FUNCTION update_activity_comment_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.deleted_at IS NULL THEN
    UPDATE activities SET comment_count = comment_count + 1 WHERE id = NEW.activity_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    UPDATE activities SET comment_count = GREATEST(0, comment_count - 1) WHERE id = NEW.activity_id;
  ELSIF TG_OP = 'DELETE' AND OLD.deleted_at IS NULL THEN
    UPDATE activities SET comment_count = GREATEST(0, comment_count - 1) WHERE id = OLD.activity_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_activity_comment_count
  AFTER INSERT OR UPDATE OR DELETE ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION update_activity_comment_count();

-- Trigger to update comment updated_at
CREATE OR REPLACE FUNCTION update_activity_comment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_activity_comment_updated_at
  BEFORE UPDATE ON activity_comments
  FOR EACH ROW EXECUTE FUNCTION update_activity_comment_updated_at();

-- RLS Policies for activities
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- View public activities
CREATE POLICY "View public activities"
  ON activities FOR SELECT
  USING (
    hidden_at IS NULL
    AND (
      visibility = 'public'
      OR user_id = auth.uid()
      OR (
        visibility = 'followers'
        AND EXISTS (
          SELECT 1 FROM follows
          WHERE follower_id = auth.uid()
          AND following_id = activities.user_id
          AND status = 'accepted'
        )
      )
    )
  );

-- Users can insert their own activities
CREATE POLICY "Users can create activities"
  ON activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update (hide) their own activities
CREATE POLICY "Users can update own activities"
  ON activities FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own activities
CREATE POLICY "Users can delete own activities"
  ON activities FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for reactions
ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone can view reactions on visible activities
CREATE POLICY "View reactions"
  ON activity_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM activities
      WHERE activities.id = activity_reactions.activity_id
    )
  );

-- Users can add their own reactions
CREATE POLICY "Users can react"
  ON activity_reactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can remove their own reactions
CREATE POLICY "Users can unreact"
  ON activity_reactions FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for comments
ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;

-- Anyone can view comments on visible activities
CREATE POLICY "View comments"
  ON activity_comments FOR SELECT
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM activities
      WHERE activities.id = activity_comments.activity_id
    )
  );

-- Users can add comments
CREATE POLICY "Users can comment"
  ON activity_comments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can edit their own comments
CREATE POLICY "Users can edit own comments"
  ON activity_comments FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete (soft) their own comments
CREATE POLICY "Users can delete own comments"
  ON activity_comments FOR DELETE
  USING (auth.uid() = user_id);

-- Function to create activity on workout completion
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

CREATE TRIGGER trigger_create_workout_activity
  AFTER UPDATE ON workout_sessions
  FOR EACH ROW EXECUTE FUNCTION create_workout_activity();
