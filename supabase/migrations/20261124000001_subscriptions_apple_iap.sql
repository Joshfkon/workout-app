-- Apple in-app purchase subscriptions alongside Stripe.
--
-- WHY: App Store Guideline 3.1.1 / 3.1.3(b): an iOS app that unlocks a
-- subscription bought on the web must also sell it in the app. The iOS app now
-- sells Pro/Elite through StoreKit 2; the server verifies Apple's signed
-- transactions (lib/apple/verifyJws.ts) and records them here, in the same
-- one-row-per-user table the Stripe webhook writes, so every tier check
-- (useSubscription, getEffectiveTier, RLS-scoped reads) works unchanged.
--
-- PRESERVED DELIBERATELY: the one-row-per-user shape, the Stripe columns and
-- the lockdown (20261112000001): only the service role writes this table.
-- Nothing is rewritten or deleted; existing rows get billing_source = NULL
-- (read as Stripe or promo, as before).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_source TEXT
    CHECK (billing_source IS NULL OR billing_source IN ('stripe', 'apple', 'promo')),
  -- Apple's originalTransactionId: stable across renewals, the key App Store
  -- Server Notifications carry. One Apple subscription maps to one account.
  ADD COLUMN IF NOT EXISTS apple_original_transaction_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS apple_product_id TEXT,
  ADD COLUMN IF NOT EXISTS apple_environment TEXT
    CHECK (apple_environment IS NULL OR apple_environment IN ('Production', 'Sandbox', 'Xcode', 'LocalTesting')),
  -- Apple's signedDate of the newest transaction applied to this row. A
  -- payload signed earlier (an old purchase resent after a refund, a
  -- notification delivered late) is stale and must not overwrite it.
  ADD COLUMN IF NOT EXISTS apple_signed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_apple_original_transaction_id
  ON subscriptions(apple_original_transaction_id);

COMMENT ON COLUMN subscriptions.billing_source IS
  'Who bills this subscription: stripe (web), apple (App Store IAP) or promo. NULL on rows written before Apple IAP (Stripe or promo).';
