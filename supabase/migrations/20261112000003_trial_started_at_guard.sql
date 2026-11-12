-- Security review finding 5: the Elite trial clock was user-writable.
--
-- users.trial_started_at is only ever written by its column DEFAULT (now())
-- when the row is created (handle_new_user trigger, or the client's own
-- "insert own profile" fallback). The "Users can update own profile" policy
-- has no column restriction, so `update users set trial_started_at = '2099…'`
-- gave a permanent trial.
--
-- This trigger pins the column for the browser roles:
--   INSERT: always now() (a client cannot pre-date or post-date its trial)
--   UPDATE: always the existing value (silently — client upserts that echo the
--           whole row keep working)
-- The service role, postgres and SECURITY DEFINER functions are unaffected, so
-- support can still adjust a trial.

CREATE OR REPLACE FUNCTION protect_users_trial_started_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.trial_started_at := now();
    ELSE
      NEW.trial_started_at := OLD.trial_started_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_users_trial_started_at ON users;
CREATE TRIGGER protect_users_trial_started_at
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION protect_users_trial_started_at();
