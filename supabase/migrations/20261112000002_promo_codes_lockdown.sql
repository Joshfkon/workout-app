-- Security review findings 2, 9, 10 (+ native finding 4: created_by FK).
--
-- 2.  promo_codes was readable by anyone holding the anon key ("Anyone can
--     view active promo codes"). Redemption runs server-side with the service
--     role, so the browser roles need no access at all.
-- 9.  increment_promo_code_uses was SECURITY DEFINER, callable by PUBLIC, with
--     no search_path: anyone could exhaust any code.
-- 10. Redemption checked max_uses on a stale read and incremented later, so N
--     concurrent redemptions of a single-use code all passed; and a failed
--     subscription write still burned the code. redeem_promo_code() below does
--     the whole thing in one transaction under a row lock.
--
-- NOTE: this does NOT rotate or deactivate the codes that were committed in
-- 20241216000001_promo_codes.sql. They were world-readable and are in git
-- history; rotating them is an operator decision.

-- ---------------------------------------------------------------------------
-- Table access
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view active promo codes" ON promo_codes;
REVOKE ALL ON promo_codes FROM PUBLIC, anon, authenticated;

-- Users may still read their own redemptions, but never write them: a direct
-- insert would bypass every check in redeem_promo_code().
DROP POLICY IF EXISTS "Users can redeem codes" ON promo_code_redemptions;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON promo_code_redemptions FROM PUBLIC, anon, authenticated;

-- Deleting an account must not be blocked because the user once created a code.
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_created_by_fkey;
ALTER TABLE promo_codes
  ADD CONSTRAINT promo_codes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Legacy counter: keep (old deploys may still call it), service role only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION increment_promo_code_uses(code_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE promo_codes
  SET current_uses = current_uses + 1
  WHERE id = code_id;
END;
$$;

REVOKE ALL ON FUNCTION increment_promo_code_uses(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_promo_code_uses(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Atomic redemption (service role only; the server action passes the user id
-- it verified from the session).
-- Returns jsonb: { ok: true, tier, is_lifetime, duration_type, duration_value }
--            or  { ok: false, error: <reason code> }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redeem_promo_code(p_user_id UUID, p_code TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code promo_codes%ROWTYPE;
  v_is_lifetime boolean;
  v_period_end timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  -- Row lock: concurrent redemptions of the same code queue up here, so the
  -- max_uses check below always sees the committed count.
  SELECT * INTO v_code
  FROM promo_codes
  WHERE code = upper(btrim(p_code)) AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid');
  END IF;

  IF v_code.expires_at IS NOT NULL AND v_code.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expired');
  END IF;

  -- max_uses NULL / 0 means unlimited (same as the previous application check).
  IF COALESCE(v_code.max_uses, 0) > 0
     AND COALESCE(v_code.current_uses, 0) >= v_code.max_uses THEN
    RETURN jsonb_build_object('ok', false, 'error', 'max_uses');
  END IF;

  IF EXISTS (
    SELECT 1 FROM promo_code_redemptions
    WHERE promo_code_id = v_code.id AND user_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = p_user_id AND is_lifetime = true AND tier = 'elite'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_lifetime');
  END IF;

  v_is_lifetime := v_code.duration_type = 'lifetime';
  IF v_is_lifetime THEN
    v_period_end := now() + interval '100 years';
  ELSIF COALESCE(v_code.duration_value, 0) > 0 AND v_code.duration_type = 'months' THEN
    v_period_end := now() + make_interval(months => v_code.duration_value);
  ELSIF COALESCE(v_code.duration_value, 0) > 0 AND v_code.duration_type = 'years' THEN
    v_period_end := now() + make_interval(years => v_code.duration_value);
  ELSE
    v_period_end := NULL;
  END IF;

  -- All three writes commit or roll back together: a failed subscription
  -- write no longer burns the code.
  UPDATE promo_codes
  SET current_uses = COALESCE(current_uses, 0) + 1
  WHERE id = v_code.id;

  INSERT INTO promo_code_redemptions (promo_code_id, user_id)
  VALUES (v_code.id, p_user_id);

  INSERT INTO subscriptions (
    user_id, tier, status, promo_code_id, is_lifetime,
    current_period_start, current_period_end, updated_at
  ) VALUES (
    p_user_id, v_code.tier, 'active', v_code.id, v_is_lifetime,
    now(), v_period_end, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    tier = EXCLUDED.tier,
    status = EXCLUDED.status,
    promo_code_id = EXCLUDED.promo_code_id,
    is_lifetime = EXCLUDED.is_lifetime,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'tier', v_code.tier,
    'is_lifetime', v_is_lifetime,
    'duration_type', v_code.duration_type,
    'duration_value', v_code.duration_value
  );
END;
$$;

REVOKE ALL ON FUNCTION redeem_promo_code(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION redeem_promo_code(UUID, TEXT) TO service_role;
