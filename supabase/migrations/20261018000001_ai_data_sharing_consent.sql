-- Explicit consent before any personal data is sent to a third-party AI
-- provider (xAI, Anthropic). Required by App Store Review Guideline
-- 5.1.2(i). NULL = never asked (the app shows the one-time prompt),
-- TRUE = allowed, FALSE = declined. Every AI server action checks this
-- (lib/ai/consent.ts) and refuses to call a provider unless it is TRUE.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ai_data_sharing_consent BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_data_sharing_consent_at TIMESTAMPTZ;

COMMENT ON COLUMN users.ai_data_sharing_consent IS
  'Consent to send personal data to third-party AI providers: NULL = not asked, TRUE = allowed, FALSE = declined.';
COMMENT ON COLUMN users.ai_data_sharing_consent_at IS
  'When ai_data_sharing_consent was last set.';
