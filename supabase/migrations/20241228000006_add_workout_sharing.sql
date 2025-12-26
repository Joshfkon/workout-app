-- Migration: Add workout sharing functionality
-- Enables users to share workouts as templates/programs that others can discover and copy

-- Shared workouts (templates/programs shared publicly)
CREATE TABLE shared_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source workout
  source_workout_id UUID REFERENCES workout_sessions(id) ON DELETE SET NULL,
  source_mesocycle_id UUID REFERENCES mesocycles(id) ON DELETE SET NULL,

  -- Shared content
  title TEXT NOT NULL,
  description TEXT,
  workout_data JSONB NOT NULL, -- Denormalized workout structure

  -- Metadata
  share_type TEXT NOT NULL CHECK (share_type IN ('single_workout', 'program', 'template')),
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  duration_weeks INTEGER, -- For programs
  target_muscle_groups TEXT[], -- Primary focus

  -- Stats
  save_count INTEGER NOT NULL DEFAULT 0,
  copy_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,

  -- Visibility
  is_public BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shared_workouts_user ON shared_workouts (user_id);
CREATE INDEX idx_shared_workouts_public ON shared_workouts (is_public, created_at DESC);
CREATE INDEX idx_shared_workouts_type ON shared_workouts (share_type);
CREATE INDEX idx_shared_workouts_difficulty ON shared_workouts (difficulty) WHERE difficulty IS NOT NULL;

-- Saved/bookmarked workouts
CREATE TABLE saved_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_workout_id UUID NOT NULL REFERENCES shared_workouts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_save UNIQUE (user_id, shared_workout_id)
);

CREATE INDEX idx_saved_workouts_user ON saved_workouts (user_id, created_at DESC);
CREATE INDEX idx_saved_workouts_shared ON saved_workouts (shared_workout_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_shared_workout_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shared_workout_updated_at
  BEFORE UPDATE ON shared_workouts
  FOR EACH ROW EXECUTE FUNCTION update_shared_workout_updated_at();

-- Trigger to update save_count
CREATE OR REPLACE FUNCTION update_shared_workout_save_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE shared_workouts SET save_count = save_count + 1 WHERE id = NEW.shared_workout_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE shared_workouts SET save_count = GREATEST(0, save_count - 1) WHERE id = OLD.shared_workout_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shared_workout_save_count
  AFTER INSERT OR DELETE ON saved_workouts
  FOR EACH ROW EXECUTE FUNCTION update_shared_workout_save_count();

-- RLS Policies
ALTER TABLE shared_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_workouts ENABLE ROW LEVEL SECURITY;

-- Public workouts are viewable by all
CREATE POLICY "Public workouts are viewable"
  ON shared_workouts FOR SELECT
  USING (is_public = true OR user_id = auth.uid());

-- Users can share workouts
CREATE POLICY "Users can share workouts"
  ON shared_workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update own shares
CREATE POLICY "Users can update own shares"
  ON shared_workouts FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete own shares
CREATE POLICY "Users can delete own shares"
  ON shared_workouts FOR DELETE
  USING (auth.uid() = user_id);

-- Users can view their saved workouts
CREATE POLICY "Users can view own saved workouts"
  ON saved_workouts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can save workouts
CREATE POLICY "Users can save workouts"
  ON saved_workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can unsave workouts
CREATE POLICY "Users can unsave workouts"
  ON saved_workouts FOR DELETE
  USING (auth.uid() = user_id);

-- Function to create activity when workout is shared
CREATE OR REPLACE FUNCTION create_shared_workout_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_data JSONB;
BEGIN
  -- Only create activity for public shares
  IF NEW.is_public THEN
    activity_data := jsonb_build_object(
      'type', 'shared_workout',
      'shared_workout_id', NEW.id,
      'title', NEW.title,
      'share_type', NEW.share_type,
      'difficulty', NEW.difficulty,
      'target_muscle_groups', NEW.target_muscle_groups
    );

    INSERT INTO activities (user_id, activity_type, reference_type, reference_id, activity_data, visibility)
    VALUES (NEW.user_id, 'shared_workout', 'shared_workout', NEW.id, activity_data, 'public');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_shared_workout_activity
  AFTER INSERT ON shared_workouts
  FOR EACH ROW EXECUTE FUNCTION create_shared_workout_activity();

