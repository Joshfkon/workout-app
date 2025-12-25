-- Create atomic increment function for promo code usage
-- This prevents race conditions when multiple users redeem the same code simultaneously

CREATE OR REPLACE FUNCTION increment_promo_code_uses(code_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE promo_codes
  SET current_uses = current_uses + 1
  WHERE id = code_id;
END;
$$;

-- Grant execute permission to authenticated users (service role will use this)
GRANT EXECUTE ON FUNCTION increment_promo_code_uses(UUID) TO service_role;
