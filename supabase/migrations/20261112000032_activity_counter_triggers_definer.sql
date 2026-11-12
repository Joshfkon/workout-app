-- The reaction/comment counter triggers on `activities` ran as the acting
-- user. RLS only lets an activity's owner update it, so a reaction or comment
-- from anyone else silently updated zero rows and the counts never moved.
-- Run the counter functions as their owner instead. They take no arguments,
-- are only reachable through the triggers, and touch one counter column.
-- Guarded so the migration is a no-op where a function is absent.

DO $$
BEGIN
  IF to_regprocedure('public.update_activity_reaction_count()') IS NOT NULL THEN
    ALTER FUNCTION public.update_activity_reaction_count() SECURITY DEFINER;
    ALTER FUNCTION public.update_activity_reaction_count() SET search_path = public;
  END IF;
  IF to_regprocedure('public.update_activity_comment_count()') IS NOT NULL THEN
    ALTER FUNCTION public.update_activity_comment_count() SECURITY DEFINER;
    ALTER FUNCTION public.update_activity_comment_count() SET search_path = public;
  END IF;
END $$;
