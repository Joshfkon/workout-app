-- Security review finding 7: follow approval and blocks were client-enforced.
--
-- The follows INSERT policy only checks follower_id, and the client chose
-- `status` (default 'accepted'). A user could insert an accepted follow of a
-- private profile, or follow someone who had blocked them, and read their
-- followers-only content.
--
-- enforce_follow_rules():
--   INSERT (by a signed-in user)
--     * rejected when either side has blocked the other
--     * status is decided here from the target's profile_visibility, using the
--       rule the app already applied client-side: 'private' -> 'pending',
--       anything else -> 'accepted'. Whatever the client sent is ignored.
--   UPDATE (by a signed-in user)
--     * follower_id / following_id are immutable
--     * the only transition is pending -> accepted | rejected
-- The service role (auth.uid() IS NULL) is not restricted.
--
-- SECURITY DEFINER because blocked_users RLS only shows a block to the
-- blocker, and the check has to see blocks in both directions.

CREATE OR REPLACE FUNCTION enforce_follow_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visibility TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM blocked_users
      WHERE (blocker_id = NEW.following_id AND blocked_id = NEW.follower_id)
         OR (blocker_id = NEW.follower_id AND blocked_id = NEW.following_id)
    ) THEN
      RAISE EXCEPTION 'Cannot follow this user' USING ERRCODE = '42501';
    END IF;

    SELECT profile_visibility INTO v_visibility
    FROM user_profiles
    WHERE user_id = NEW.following_id;

    IF v_visibility = 'private' THEN
      NEW.status := 'pending';
      NEW.accepted_at := NULL;
    ELSE
      NEW.status := 'accepted';
      NEW.accepted_at := COALESCE(NEW.accepted_at, now());
    END IF;

    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.follower_id IS DISTINCT FROM OLD.follower_id
     OR NEW.following_id IS DISTINCT FROM OLD.following_id THEN
    RAISE EXCEPTION 'A follow cannot be re-pointed' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'pending' AND NEW.status IN ('accepted', 'rejected')) THEN
    RAISE EXCEPTION 'Invalid follow status change' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_follow_rules() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_enforce_follow_rules ON follows;
CREATE TRIGGER trigger_enforce_follow_rules
  BEFORE INSERT OR UPDATE ON follows
  FOR EACH ROW EXECUTE FUNCTION enforce_follow_rules();

-- The respond policy had USING (... AND status = 'pending') and no WITH CHECK.
-- Postgres then applies the USING expression to the NEW row as well, so
-- accepting (status -> 'accepted') could never pass. State the new-row rule
-- explicitly: only the followed user, and only to accepted / rejected.
DROP POLICY IF EXISTS "Users can respond to follow requests" ON follows;
CREATE POLICY "Users can respond to follow requests"
  ON follows FOR UPDATE
  USING (auth.uid() = following_id AND status = 'pending')
  WITH CHECK (auth.uid() = following_id AND status IN ('accepted', 'rejected'));
