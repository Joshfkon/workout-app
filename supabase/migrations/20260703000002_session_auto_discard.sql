-- Soft-delete for stale-session auto-discard (P0-1 hardening).
--
-- The auto-discard guard (isStaleEmptyAdhocSession) currently hard-DELETEs
-- abandoned empty ad-hoc sessions. This adds a recoverable terminal state so
-- support can inspect or restore a session if a user complains. Every session
-- list in the app filters by a positive state allowlist, so 'auto_discarded'
-- rows vanish from the UI exactly like a delete.
--
-- NOTE (Postgres): a newly added enum value cannot be referenced in the same
-- transaction that adds it. Supabase runs each migration file in its own
-- transaction, so keep this file standalone; application code only writes
-- 'auto_discarded' after this has committed (and falls back to hard delete
-- until then).

ALTER TYPE session_state ADD VALUE IF NOT EXISTS 'auto_discarded';

-- When it was discarded — for support lookup and a future retention sweep.
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS auto_discarded_at timestamptz;
