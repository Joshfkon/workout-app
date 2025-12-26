-- Migration: Add Workout Sharing
-- Phase 4: Allows users to share workouts publicly and save others' workouts

-- ============================================================================
-- SHARED WORKOUTS TABLE
-- ============================================================================

CREATE TABLE shared_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source workout (optional - for tracking origin)
  source_workout_id UUID,
  source_mesocycle_id UUID,

  -- Shared content
  title TEXT NOT NULL CHECK (char_length(title) >= 3 AND char_length(title) <= 100),
  description TEXT CHECK (char_length(description) <= 2000),
  workout_data JSONB NOT NULL,

  -- Metadata
  share_type TEXT NOT NULL CHECK (share_type IN ('single_workout', 'program', 'template')),
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  duration_weeks INTEGER CHECK (duration_weeks IS NULL OR duration_weeks > 0),
  target_muscle_groups TEXT[] NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',

  -- Stats (denormalized for performance)
  save_count INTEGER NOT NULL DEFAULT 0,
  copy_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,

  -- Visibility
  is_public BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_shared_workouts_user ON shared_workouts (user_id);
CREATE INDEX idx_shared_workouts_public ON shared_workouts (is_public, created_at DESC) WHERE is_public = true;
CREATE INDEX idx_shared_workouts_type ON shared_workouts (share_type, created_at DESC);
CREATE INDEX idx_shared_workouts_difficulty ON shared_workouts (difficulty) WHERE difficulty IS NOT NULL;
CREATE INDEX idx_shared_workouts_muscle_groups ON shared_workouts USING gin (target_muscle_groups);
CREATE INDEX idx_shared_workouts_tags ON shared_workouts USING gin (tags);
CREATE INDEX idx_shared_workouts_popular ON shared_workouts (save_count DESC, copy_count DESC) WHERE is_public = true;

-- Full-text search on title and description
CREATE INDEX idx_shared_workouts_search ON shared_workouts
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, '')));

-- ============================================================================
-- SAVED WORKOUTS TABLE (Bookmarks)
-- ============================================================================

CREATE TABLE saved_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_workout_id UUID NOT NULL REFERENCES shared_workouts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_saved_workout UNIQUE (user_id, shared_workout_id)
);

CREATE INDEX idx_saved_workouts_user ON saved_workouts (user_id, created_at DESC);
CREATE INDEX idx_saved_workouts_workout ON saved_workouts (shared_workout_id);

-- ============================================================================
-- WORKOUT COPIES TABLE (Track imports)
-- ============================================================================

CREATE TABLE workout_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_workout_id UUID NOT NULL REFERENCES shared_workouts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workout_copies_user ON workout_copies (user_id, created_at DESC);
CREATE INDEX idx_workout_copies_workout ON workout_copies (shared_workout_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE shared_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_copies ENABLE ROW LEVEL SECURITY;

-- Shared workouts policies
CREATE POLICY "Public workouts viewable by all"
  ON shared_workouts FOR SELECT
  USING (is_public = true);

CREATE POLICY "Users can view own shared workouts"
  ON shared_workouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can share workouts"
  ON shared_workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own shares"
  ON shared_workouts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own shares"
  ON shared_workouts FOR DELETE
  USING (auth.uid() = user_id);

-- Saved workouts policies
CREATE POLICY "Users can view own saved workouts"
  ON saved_workouts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can save workouts"
  ON saved_workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unsave workouts"
  ON saved_workouts FOR DELETE
  USING (auth.uid() = user_id);

-- Workout copies policies
CREATE POLICY "Users can view own copies"
  ON workout_copies FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can copy workouts"
  ON workout_copies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TRIGGERS FOR COUNT UPDATES
-- ============================================================================

-- Update save_count on shared_workouts
CREATE OR REPLACE FUNCTION update_shared_workout_save_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE shared_workouts
    SET save_count = save_count + 1
    WHERE id = NEW.shared_workout_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE shared_workouts
    SET save_count = GREATEST(0, save_count - 1)
    WHERE id = OLD.shared_workout_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_save_workout
  AFTER INSERT OR DELETE ON saved_workouts
  FOR EACH ROW EXECUTE FUNCTION update_shared_workout_save_count();

-- Update copy_count on shared_workouts
CREATE OR REPLACE FUNCTION update_shared_workout_copy_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE shared_workouts
  SET copy_count = copy_count + 1
  WHERE id = NEW.shared_workout_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_copy_workout
  AFTER INSERT ON workout_copies
  FOR EACH ROW EXECUTE FUNCTION update_shared_workout_copy_count();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_shared_workouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_shared_workouts_updated_at
  BEFORE UPDATE ON shared_workouts
  FOR EACH ROW EXECUTE FUNCTION update_shared_workouts_updated_at();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Increment view count (called from app)
CREATE OR REPLACE FUNCTION increment_workout_view(workout_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE shared_workouts
  SET view_count = view_count + 1
  WHERE id = workout_id AND is_public = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Search shared workouts
CREATE OR REPLACE FUNCTION search_shared_workouts(
  search_query TEXT DEFAULT NULL,
  filter_type TEXT DEFAULT NULL,
  filter_difficulty TEXT DEFAULT NULL,
  filter_muscle_groups TEXT[] DEFAULT NULL,
  page_limit INTEGER DEFAULT 20,
  page_cursor TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  title TEXT,
  description TEXT,
  workout_data JSONB,
  share_type TEXT,
  difficulty TEXT,
  duration_weeks INTEGER,
  target_muscle_groups TEXT[],
  tags TEXT[],
  save_count INTEGER,
  copy_count INTEGER,
  view_count INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sw.id,
    sw.user_id,
    sw.title,
    sw.description,
    sw.workout_data,
    sw.share_type,
    sw.difficulty,
    sw.duration_weeks,
    sw.target_muscle_groups,
    sw.tags,
    sw.save_count,
    sw.copy_count,
    sw.view_count,
    sw.created_at,
    sw.updated_at
  FROM shared_workouts sw
  WHERE sw.is_public = true
    AND (search_query IS NULL OR to_tsvector('english', coalesce(sw.title, '') || ' ' || coalesce(sw.description, '')) @@ plainto_tsquery('english', search_query))
    AND (filter_type IS NULL OR sw.share_type = filter_type)
    AND (filter_difficulty IS NULL OR sw.difficulty = filter_difficulty)
    AND (filter_muscle_groups IS NULL OR sw.target_muscle_groups && filter_muscle_groups)
    AND (page_cursor IS NULL OR sw.created_at < page_cursor)
  ORDER BY sw.created_at DESC
  LIMIT page_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
