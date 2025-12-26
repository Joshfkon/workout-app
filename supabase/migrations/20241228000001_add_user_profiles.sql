-- Migration: Add user profiles for social features
-- This creates the foundation for social features in HyperTrack

-- Extended user profile for social features
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Display info
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT CHECK (char_length(bio) <= 500),

  -- Privacy settings
  profile_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (profile_visibility IN ('public', 'followers_only', 'private')),
  show_workouts BOOLEAN NOT NULL DEFAULT true,
  show_stats BOOLEAN NOT NULL DEFAULT true,
  show_progress_photos BOOLEAN NOT NULL DEFAULT false,

  -- Social stats (denormalized for performance)
  follower_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  workout_count INTEGER NOT NULL DEFAULT 0,
  total_volume_kg NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Achievements & badges
  badges JSONB NOT NULL DEFAULT '[]',
  featured_achievement TEXT,

  -- Fitness info (optional public display)
  training_experience TEXT CHECK (training_experience IN ('beginner', 'intermediate', 'advanced', 'elite')),
  primary_goal TEXT,
  gym_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_user_profiles_user UNIQUE (user_id)
);

-- Indexes for performance
CREATE INDEX idx_user_profiles_username_lower ON user_profiles (LOWER(username));
CREATE INDEX idx_user_profiles_user_id ON user_profiles (user_id);
CREATE INDEX idx_user_profiles_visibility ON user_profiles (profile_visibility) WHERE profile_visibility = 'public';

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can view public profiles
CREATE POLICY "Public profiles are viewable by all"
  ON user_profiles FOR SELECT
  USING (profile_visibility = 'public');

-- Users can view their own profile regardless of visibility
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own profile
CREATE POLICY "Users can delete own profile"
  ON user_profiles FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_user_profile_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_user_profile_updated_at();

-- Trigger to update workout_count when workouts are completed
CREATE OR REPLACE FUNCTION update_profile_workout_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state = 'completed' AND OLD.state != 'completed' THEN
    UPDATE user_profiles
    SET workout_count = workout_count + 1
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_profile_workout_count
  AFTER UPDATE ON workout_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_profile_workout_count();

-- Reserved usernames that cannot be used
CREATE TABLE reserved_usernames (
  username TEXT PRIMARY KEY,
  reason TEXT
);

INSERT INTO reserved_usernames (username, reason) VALUES
  ('admin', 'system'),
  ('hypertrack', 'brand'),
  ('support', 'system'),
  ('help', 'system'),
  ('api', 'system'),
  ('www', 'system'),
  ('app', 'system'),
  ('dashboard', 'route'),
  ('profile', 'route'),
  ('settings', 'route'),
  ('workout', 'route'),
  ('workouts', 'route'),
  ('exercise', 'route'),
  ('exercises', 'route'),
  ('feed', 'route'),
  ('leaderboard', 'route'),
  ('leaderboards', 'route'),
  ('notifications', 'route'),
  ('messages', 'route'),
  ('search', 'route'),
  ('explore', 'route'),
  ('null', 'reserved'),
  ('undefined', 'reserved'),
  ('anonymous', 'reserved');
