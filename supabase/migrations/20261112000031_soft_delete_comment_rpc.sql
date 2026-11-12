-- Migration: make comment soft-delete work under RLS.
--
-- hooks/useComments.ts soft-deleted with
--   UPDATE activity_comments SET deleted_at = now() WHERE id = ? AND user_id = ?
-- Because that UPDATE reads columns (WHERE), Postgres also applies the SELECT
-- policy to the NEW row, and "View comments" requires deleted_at IS NULL —
-- so the update was rejected ("new row violates row-level security policy")
-- and users could not delete their own comments.
--
-- Fix: a SECURITY DEFINER function that soft-deletes only the caller's own
-- comment. The SELECT policy is left untouched so deleted comments stay
-- invisible to everyone. The comment-count trigger still fires on the UPDATE.

CREATE OR REPLACE FUNCTION soft_delete_comment(p_comment_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE activity_comments
     SET deleted_at = NOW()
   WHERE id = p_comment_id
     AND user_id = auth.uid()
     AND deleted_at IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;

REVOKE ALL ON FUNCTION soft_delete_comment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soft_delete_comment(UUID) TO authenticated;
