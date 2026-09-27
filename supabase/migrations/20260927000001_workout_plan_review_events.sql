-- Workout plan review events.
--
-- One row per AI review suggestion shown in the pre-workout setup flow
-- (services/workoutSetup/aiReview) and what the user did with it:
--   'accepted'  — tapped Accept (or Accept all). `applied` is false when the
--                 suggestion no longer fit the plan, or was a flag.
--   'dismissed' — tapped Dismiss (or Dismiss all)
--   'ignored'   — still on screen, untouched, when the user tapped Start
-- Written once, at Start, through the offline outbox (client-generated ids,
-- idempotent upserts). Consumer: analysis of whether the review is worth
-- keeping (acceptance rate by suggestion type / severity).

CREATE TABLE IF NOT EXISTS workout_plan_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  -- The model's suggestion id (unique within one review only).
  suggestion_id TEXT NOT NULL,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN (
    'swap', 'reorder', 'remove', 'adjust_sets', 'flag'
  )),
  reason TEXT NOT NULL CHECK (char_length(reason) <= 200),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warn')),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'dismissed', 'ignored')),
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  -- The item's exercise when reviewed, and a swap's replacement.
  exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  replacement_exercise_id UUID REFERENCES exercises(id) ON DELETE SET NULL,
  -- Hash of the plan the review answered (services/workoutSetup/planEdits.planHash).
  plan_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workout_plan_review_events_user_time
  ON workout_plan_review_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workout_plan_review_events_session
  ON workout_plan_review_events(session_id);

ALTER TABLE workout_plan_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plan review events"
  ON workout_plan_review_events FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plan review events"
  ON workout_plan_review_events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own plan review events"
  ON workout_plan_review_events FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own plan review events"
  ON workout_plan_review_events FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE workout_plan_review_events IS
  'AI review suggestions from the pre-workout setup flow and the user''s '
  'decision (accepted / dismissed / ignored); for judging whether the review '
  'is worth it.';
