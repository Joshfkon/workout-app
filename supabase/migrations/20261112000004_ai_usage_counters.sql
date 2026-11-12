-- Security review finding 4: AI server actions were unmetered.
--
-- Per-user, per-feature, per-UTC-day request counter. The table has RLS on
-- with NO policies and no grants to the browser roles, so a user can neither
-- read nor reset their own counters. The only way in is consume_ai_quota(),
-- which keys off auth.uid() (never a caller-supplied user id).
--
-- The daily limit is passed by the server action. A user calling the RPC
-- directly with a larger limit gains nothing: the server's own call still
-- compares the stored count against the server's limit, so a direct call can
-- only ever use up the caller's own quota.

CREATE TABLE IF NOT EXISTS ai_usage_counters (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  usage_date DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature, usage_date)
);

ALTER TABLE ai_usage_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_usage_counters FROM PUBLIC, anon, authenticated;

-- Returns TRUE and counts the request when the caller is under p_daily_limit
-- for p_feature today; returns FALSE (and counts nothing) when at the limit.
CREATE OR REPLACE FUNCTION consume_ai_quota(p_feature TEXT, p_daily_limit INTEGER)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated';
  END IF;

  -- Fixed vocabulary so a caller cannot fill the table with made-up features.
  IF p_feature IS NULL OR p_feature NOT IN (
    'coach_chat', 'workout_coach_notes', 'meal_parse', 'label_scan',
    'photo_bf_estimate', 'plan_review', 'motion_coach'
  ) THEN
    RAISE EXCEPTION 'Unknown AI feature: %', p_feature;
  END IF;

  IF p_daily_limit IS NULL OR p_daily_limit < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO ai_usage_counters (user_id, feature, usage_date, request_count)
  VALUES (v_user_id, p_feature, (now() AT TIME ZONE 'utc')::date, 1)
  ON CONFLICT (user_id, feature, usage_date) DO UPDATE
    SET request_count = ai_usage_counters.request_count + 1,
        updated_at = now()
    WHERE ai_usage_counters.request_count < p_daily_limit
  RETURNING request_count INTO v_count;

  RETURN v_count IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION consume_ai_quota(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION consume_ai_quota(TEXT, INTEGER) TO authenticated, service_role;
