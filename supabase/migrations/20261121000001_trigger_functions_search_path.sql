-- ============================================
-- Make account deletion survive the auth.users cascade
-- ============================================
-- In-app account deletion (lib/actions/account.ts#deleteAccount) calls
-- auth.admin.deleteUser. GoTrue runs as supabase_auth_admin with
-- search_path = auth, and the DELETE on auth.users cascades into every
-- user-owned table IN THAT SESSION. AFTER row triggers fired by the cascade
-- then run as supabase_auth_admin with that search_path, and fail twice over:
--   1. unqualified table names don't resolve
--      (`relation "exercise_blocks" does not exist`), and
--   2. once they do, supabase_auth_admin has no privileges on public tables
--      (`permission denied for table exercise_blocks`).
-- Either error rolls back the whole delete and GoTrue answers
-- "Database error deleting user".
--
-- Reproduced on a local stack (SET ROLE supabase_auth_admin; SET search_path
-- = auth; DELETE FROM auth.users ...):
--   * set_logs        -> update_session_completion()
--   * follows         -> update_follow_counts()
--   * saved_workouts  -> update_shared_workout_save_count()
-- The first alone means any user who has logged a single set cannot delete
-- their account.
--
-- Fix, following 20261112000032 (activity counters): run these three as
-- their owner with a pinned search_path. They take no arguments, are only
-- reachable as triggers, and each writes one derived column
-- (completion_percent, follower/following_count, save_count) of the row the
-- triggering row points at.
--
-- Side effect, intended: follow and save counters now also move when the
-- target row belongs to someone else. Under RLS the invoker could only
-- update their own user_profiles / shared_workouts row, so the other side of
-- a follow, and every save of someone else's shared workout, silently
-- updated zero rows. Existing counts are not backfilled here.
--
-- The remaining cross-table trigger functions only fire on UPDATE of a
-- user's own rows, so they just get the pinned search_path.
--
-- Guarded per function: production may have drifted from the migration
-- history, and a missing function must not abort the migration.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.update_session_completion()',
    'public.update_follow_counts()',
    'public.update_shared_workout_save_count()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', fn);
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    ELSE
      RAISE NOTICE 'trigger_functions_search_path: % not found, skipped', fn;
    END IF;
  END LOOP;

  FOREACH fn IN ARRAY ARRAY[
    'public.update_profile_workout_count()',
    'public.create_workout_activity()',
    'public.deactivate_other_targets()'
  ] LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', fn);
    ELSE
      RAISE NOTICE 'trigger_functions_search_path: % not found, skipped', fn;
    END IF;
  END LOOP;
END
$$;
