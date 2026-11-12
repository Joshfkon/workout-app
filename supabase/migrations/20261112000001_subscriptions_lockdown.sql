-- Security review finding 1 + 8.
--
-- 1. A signed-in user could INSERT their own subscriptions row with any tier /
--    status / is_lifetime ("Users can create own subscription" only checked
--    user_id). Every legitimate write (Stripe webhook, checkout, promo
--    redemption) uses the service role, which bypasses RLS and table grants,
--    so the client needs SELECT only.
-- 8. Stripe can report 'incomplete_expired' and 'paused'; the status CHECK
--    rejected them, so those webhook writes failed.
--
-- Idempotent: production may have drifted from the repo.

DROP POLICY IF EXISTS "Users can create own subscription" ON subscriptions;

-- Belt and braces: whatever policies exist (now or later), the browser roles
-- can never write this table. SELECT stays (own row, via the existing policy).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON subscriptions FROM anon, authenticated;
REVOKE ALL ON subscriptions FROM PUBLIC;
GRANT SELECT ON subscriptions TO authenticated;

-- Widen the status CHECK. Drop whichever CHECK constraint(s) currently guard
-- the status column (the name is auto-generated and may differ in production).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.subscriptions'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%past_due%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscriptions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN (
    'trialing', 'active', 'canceled', 'past_due', 'unpaid',
    'incomplete', 'incomplete_expired', 'paused'
  ));
