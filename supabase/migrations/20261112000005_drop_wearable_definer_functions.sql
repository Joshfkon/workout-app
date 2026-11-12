-- Security review finding 6.
--
-- get_active_wearable_connections, get_daily_activity_range and
-- upsert_daily_activity were SECURITY DEFINER, took an arbitrary p_user_id,
-- had no auth.uid() check, no search_path and no REVOKE — any anon or
-- signed-in caller could read or overwrite another user's activity data.
--
-- The app never calls them (it reads/writes the tables directly under RLS),
-- so they are dropped. Every overload is removed by name because production
-- may carry a different signature than the repo.
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_active_wearable_connections',
        'get_daily_activity_range',
        'upsert_daily_activity'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', f.signature);
  END LOOP;
END $$;
