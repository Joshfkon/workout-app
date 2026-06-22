-- Idempotency ledger for Stripe webhook events.
-- Records every Stripe event.id the webhook has processed so duplicate
-- deliveries (Stripe guarantees at-least-once, not exactly-once) are skipped.
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  id TEXT PRIMARY KEY,                 -- Stripe event.id (evt_...)
  type TEXT NOT NULL,                  -- Stripe event.type
  processed_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS. Only the service role (used by the webhook) touches this table;
-- no policies are defined, so it is inaccessible to anon/authenticated clients.
ALTER TABLE stripe_processed_events ENABLE ROW LEVEL SECURITY;

-- Index to prune old events by age if desired.
CREATE INDEX IF NOT EXISTS idx_stripe_processed_events_processed_at
  ON stripe_processed_events(processed_at);
