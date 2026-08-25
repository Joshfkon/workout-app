-- Flip stored stress levels to the ascending scale (1 = low stress, 5 = high).
--
-- The daily and pre-workout check-in UIs used to label the stress buttons
-- 1 = "Very High" … 5 = "Very Low", while every consumer of the value
-- (calculateReadinessScore, deloadEngine, mesocycleBuilder, the settings
-- profile scale, WellnessTrendsCard) treats HIGHER as MORE stress. The UIs
-- now use the ascending labels, so rows recorded under the old labels are
-- inverted here to preserve what the user actually reported.
--
-- users.stress_level is NOT touched: the settings/onboarding profile UI has
-- always used the ascending scale ("Low stress" → "High stress").

UPDATE daily_check_ins
SET stress_level = 6 - stress_level
WHERE stress_level IS NOT NULL;

-- Pre-workout check-ins captured through ReadinessCheckIn live in JSONB.
UPDATE workout_sessions
SET pre_workout_check_in = jsonb_set(
  pre_workout_check_in,
  '{stressLevel}',
  to_jsonb(6 - (pre_workout_check_in->>'stressLevel')::numeric)
)
WHERE pre_workout_check_in ? 'stressLevel'
  AND jsonb_typeof(pre_workout_check_in->'stressLevel') = 'number';
