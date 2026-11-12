-- Claude connector (MCP): make OAuth-client access tokens read-only at the
-- database, not just in the /mcp tools.
--
-- When a user approves an app on /oauth/consent, Supabase Auth issues that
-- app an access token for the user. It is an ordinary `authenticated` JWT, so
-- without this migration the app could skip the read-only MCP tools and call
-- the Data API directly, where the existing policies allow the owner to
-- insert, update and delete. The consent screen promises read-only access;
-- this is what makes that true.
--
-- OAuth-client tokens carry a `client_id` claim; first-party sign-ins do not
-- (Supabase docs: Auth > OAuth 2.1 Server > Token security and RLS, pattern
-- "(auth.jwt() ->> 'client_id') IS NULL -- only direct user sessions").
--
-- APPLY THIS BEFORE ENABLING THE OAUTH SERVER ON THE PROJECT.

-- 1. One definition of "this request comes from an OAuth client".
CREATE OR REPLACE FUNCTION public.is_oauth_client_token()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(nullif(auth.jwt() ->> 'client_id', ''), '') <> '';
$$;

REVOKE ALL ON FUNCTION public.is_oauth_client_token() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_oauth_client_token() TO anon, authenticated, service_role;

-- 2. Data API choke point: PostgREST runs this before EVERY request (tables
--    and RPCs alike). An OAuth-client token may only make read requests.
--    PostgREST only serves GET for STABLE/IMMUTABLE functions, so a GET can
--    never reach a writing RPC.
--
--    Written so it can only fail on purpose: an unreadable claim set is
--    treated as "not an OAuth client" and the request proceeds to the normal
--    RLS checks, exactly as before this migration.
CREATE OR REPLACE FUNCTION public.reject_oauth_client_writes()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  method text;
BEGIN
  BEGIN
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    claims := NULL;
  END;

  IF claims IS NULL OR coalesce(claims ->> 'client_id', '') = '' THEN
    RETURN;
  END IF;

  method := upper(coalesce(current_setting('request.method', true), ''));
  IF method IN ('GET', 'HEAD', 'OPTIONS') THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'This connection is read-only.'
    USING ERRCODE = '42501',
          HINT = 'Connected apps can read your HyperTrack data but cannot change it.';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_oauth_client_writes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_oauth_client_writes() TO anon, authenticated, service_role;

-- Register it, refusing to silently replace a different pre-request hook.
DO $$
DECLARE
  existing text;
BEGIN
  SELECT split_part(cfg, '=', 2) INTO existing
  FROM pg_db_role_setting s
  JOIN pg_roles r ON r.oid = s.setrole
  CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
  WHERE r.rolname = 'authenticator'
    AND cfg LIKE 'pgrst.db_pre_request=%'
  LIMIT 1;

  IF existing IS NOT NULL
     AND existing NOT IN ('public.reject_oauth_client_writes', 'reject_oauth_client_writes') THEN
    RAISE EXCEPTION
      'A different PostgREST pre-request function is already configured (%). Call public.reject_oauth_client_writes() from it instead of replacing it.',
      existing;
  END IF;

  ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.reject_oauth_client_writes';
END $$;

NOTIFY pgrst, 'reload config';

-- 3. Storage is not behind the Data API hook, so deny object writes there too.
--    RESTRICTIVE policies are ANDed with the existing per-bucket ones.
DROP POLICY IF EXISTS "OAuth clients cannot upload objects" ON storage.objects;
CREATE POLICY "OAuth clients cannot upload objects"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_oauth_client_token());

DROP POLICY IF EXISTS "OAuth clients cannot modify objects" ON storage.objects;
CREATE POLICY "OAuth clients cannot modify objects"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_oauth_client_token())
  WITH CHECK (NOT public.is_oauth_client_token());

DROP POLICY IF EXISTS "OAuth clients cannot delete objects" ON storage.objects;
CREATE POLICY "OAuth clients cannot delete objects"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_oauth_client_token());
