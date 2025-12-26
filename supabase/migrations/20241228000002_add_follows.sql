-- Migration: Add follows system for social features
-- Enables users to follow each other with support for private profile requests

-- Follows table
CREATE TABLE follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Status for follow requests (private profiles)
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('pending', 'accepted', 'rejected')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,

  -- Prevent self-follow and duplicates
  CONSTRAINT no_self_follow CHECK (follower_id != following_id),
  CONSTRAINT unique_follow UNIQUE (follower_id, following_id)
);

-- Indexes for efficient queries
CREATE INDEX idx_follows_follower ON follows (follower_id, status);
CREATE INDEX idx_follows_following ON follows (following_id, status);
CREATE INDEX idx_follows_pending ON follows (following_id) WHERE status = 'pending';

-- Trigger to update follower/following counts on user_profiles
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'accepted' THEN
    -- Direct follow (public profile)
    UPDATE user_profiles SET follower_count = follower_count + 1 WHERE user_id = NEW.following_id;
    UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    -- Follow request accepted
    UPDATE user_profiles SET follower_count = follower_count + 1 WHERE user_id = NEW.following_id;
    UPDATE user_profiles SET following_count = following_count + 1 WHERE user_id = NEW.follower_id;
    NEW.accepted_at = NOW();
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    -- Unfollow
    UPDATE user_profiles SET follower_count = GREATEST(0, follower_count - 1) WHERE user_id = OLD.following_id;
    UPDATE user_profiles SET following_count = GREATEST(0, following_count - 1) WHERE user_id = OLD.follower_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_follow_counts
  AFTER INSERT OR UPDATE OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION update_follow_counts();

-- RLS Policies
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Users can see their own follows (as follower or following)
CREATE POLICY "Users can view own follows"
  ON follows FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

-- Users can create follows (rate limit in application layer)
CREATE POLICY "Users can follow others"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

-- Users can delete their own follows (unfollow)
CREATE POLICY "Users can unfollow"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- Users can update follows they receive (accept/reject requests)
CREATE POLICY "Users can respond to follow requests"
  ON follows FOR UPDATE
  USING (auth.uid() = following_id AND status = 'pending');

-- Blocked users table
CREATE TABLE blocked_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT no_self_block CHECK (blocker_id != blocked_id),
  CONSTRAINT unique_block UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX idx_blocked_users_blocker ON blocked_users (blocker_id);
CREATE INDEX idx_blocked_users_blocked ON blocked_users (blocked_id);

-- RLS for blocked_users
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their blocks"
  ON blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

CREATE POLICY "Users can block others"
  ON blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can unblock others"
  ON blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- When a user blocks someone, remove any existing follow relationships
CREATE OR REPLACE FUNCTION handle_block_cleanup()
RETURNS TRIGGER AS $$
BEGIN
  -- Remove follows in both directions
  DELETE FROM follows WHERE
    (follower_id = NEW.blocker_id AND following_id = NEW.blocked_id) OR
    (follower_id = NEW.blocked_id AND following_id = NEW.blocker_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_block_cleanup
  AFTER INSERT ON blocked_users
  FOR EACH ROW EXECUTE FUNCTION handle_block_cleanup();

-- Update user_profiles RLS to add followers_only policy now that follows exists
-- (The policy was defined in the previous migration but couldn't work without follows table)
DROP POLICY IF EXISTS "Followers can view followers_only profiles" ON user_profiles;

CREATE POLICY "Followers can view followers_only profiles"
  ON user_profiles FOR SELECT
  USING (
    profile_visibility = 'followers_only'
    AND EXISTS (
      SELECT 1 FROM follows
      WHERE follower_id = auth.uid()
      AND following_id = user_profiles.user_id
      AND status = 'accepted'
    )
  );
