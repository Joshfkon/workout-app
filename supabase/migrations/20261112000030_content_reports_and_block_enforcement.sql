-- Migration: user-generated-content moderation (App Store guideline 1.2)
--
-- 1. content_reports: users can report an activity, comment, profile or
--    shared workout. Reporters can insert and read ONLY their own reports;
--    moderators review with the service role (Supabase dashboard).
-- 2. blocked_users: make sure RLS + policies exist (production may have
--    drifted) and make the block-cleanup trigger able to remove the OTHER
--    user's follow row (it ran as the blocker, so RLS hid that row).
-- 3. A blocked pair cannot comment on / react to each other's activities.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. content_reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL
    CHECK (target_type IN ('activity', 'comment', 'profile', 'shared_workout')),
  -- Polymorphic: activities.id / activity_comments.id / user_profiles.user_id /
  -- shared_workouts.id. No FK so the report survives deletion of the content.
  target_id UUID NOT NULL,
  -- Author of the reported content (denormalized for the moderator).
  target_user_id UUID,
  reason TEXT NOT NULL
    CHECK (reason IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'impersonation', 'other')),
  note TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,

  CONSTRAINT content_reports_unique_per_reporter UNIQUE (reporter_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_target ON content_reports (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports (reporter_id);

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can create their own reports" ON content_reports;
CREATE POLICY "Users can create their own reports"
  ON content_reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id AND status = 'pending' AND reviewed_at IS NULL);

DROP POLICY IF EXISTS "Users can view their own reports" ON content_reports;
CREATE POLICY "Users can view their own reports"
  ON content_reports FOR SELECT
  USING (auth.uid() = reporter_id);

-- No UPDATE / DELETE policies: only the service role can change a report.

-- ---------------------------------------------------------------------------
-- 2. blocked_users policies (re-assert) + cleanup trigger
-- ---------------------------------------------------------------------------
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their blocks" ON blocked_users;
CREATE POLICY "Users can view their blocks"
  ON blocked_users FOR SELECT
  USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can block others" ON blocked_users;
CREATE POLICY "Users can block others"
  ON blocked_users FOR INSERT
  WITH CHECK (auth.uid() = blocker_id);

DROP POLICY IF EXISTS "Users can unblock others" ON blocked_users;
CREATE POLICY "Users can unblock others"
  ON blocked_users FOR DELETE
  USING (auth.uid() = blocker_id);

-- The original function ran with the blocker's privileges, so the follows
-- DELETE policy (auth.uid() = follower_id) silently kept the blocked user's
-- follow of the blocker. SECURITY DEFINER removes both directions.
CREATE OR REPLACE FUNCTION handle_block_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM follows WHERE
    (follower_id = NEW.blocker_id AND following_id = NEW.blocked_id) OR
    (follower_id = NEW.blocked_id AND following_id = NEW.blocker_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_cleanup ON blocked_users;
CREATE TRIGGER trigger_block_cleanup
  AFTER INSERT ON blocked_users
  FOR EACH ROW EXECUTE FUNCTION handle_block_cleanup();

-- ---------------------------------------------------------------------------
-- 3. Blocked pairs cannot interact on each other's activities
-- ---------------------------------------------------------------------------
-- blocked_users RLS only shows a row to the blocker, so the blocked user's
-- own policy check needs a definer helper to see that the block exists. It
-- returns a boolean only, and only for pairs that include the caller.
CREATE OR REPLACE FUNCTION social_block_exists(user_a UUID, user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() = user_a OR auth.uid() = user_b)
    AND EXISTS (
      SELECT 1 FROM blocked_users
      WHERE (blocker_id = user_a AND blocked_id = user_b)
         OR (blocker_id = user_b AND blocked_id = user_a)
    );
$$;

REVOKE ALL ON FUNCTION social_block_exists(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION social_block_exists(UUID, UUID) TO authenticated;

DROP POLICY IF EXISTS "No comments between blocked users" ON activity_comments;
CREATE POLICY "No comments between blocked users"
  ON activity_comments AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM activities a
      WHERE a.id = activity_comments.activity_id
        AND social_block_exists(activity_comments.user_id, a.user_id)
    )
  );

DROP POLICY IF EXISTS "No reactions between blocked users" ON activity_reactions;
CREATE POLICY "No reactions between blocked users"
  ON activity_reactions AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM activities a
      WHERE a.id = activity_reactions.activity_id
        AND social_block_exists(activity_reactions.user_id, a.user_id)
    )
  );
