-- Promo codes table for lifetime and other promotional subscriptions
CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  tier TEXT CHECK (tier IN ('pro', 'elite')) NOT NULL DEFAULT 'elite',
  duration_type TEXT CHECK (duration_type IN ('lifetime', 'months', 'years')) NOT NULL DEFAULT 'lifetime',
  duration_value INTEGER, -- Number of months/years if not lifetime
  max_uses INTEGER DEFAULT 1, -- Max number of times this code can be used
  current_uses INTEGER DEFAULT 0,
  description TEXT, -- Internal note about who this is for
  created_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ, -- Optional expiration date for the code itself
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Track which users have redeemed which codes
CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID REFERENCES promo_codes(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(promo_code_id, user_id) -- Each user can only redeem each code once
);

-- Enable RLS
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Users can view active promo codes (to validate them)
CREATE POLICY "Anyone can view active promo codes" 
  ON promo_codes FOR SELECT 
  USING (is_active = true);

-- Users can view their own redemptions
CREATE POLICY "Users can view own redemptions" 
  ON promo_code_redemptions FOR SELECT 
  USING (auth.uid() = user_id);

-- Users can insert their own redemptions
CREATE POLICY "Users can redeem codes"
  ON promo_code_redemptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_code_redemptions_user_id ON promo_code_redemptions(user_id);

-- Pre-generate some lifetime elite codes for friends & family
-- These are unique codes that can each be used once
INSERT INTO promo_codes (code, tier, duration_type, max_uses, description) VALUES
  ('FAMILY-ELITE-001', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-002', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-003', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-004', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-005', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-006', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-007', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-008', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-009', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  ('FAMILY-ELITE-010', 'elite', 'lifetime', 1, 'Friends & Family lifetime code'),
  -- Shareable code with 50 uses
  ('LIFTSCIENCE-VIP', 'elite', 'lifetime', 50, 'Shareable lifetime code for early adopters');

-- Add a column to subscriptions to track if it's from a promo code
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES promo_codes(id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_lifetime BOOLEAN DEFAULT false;

