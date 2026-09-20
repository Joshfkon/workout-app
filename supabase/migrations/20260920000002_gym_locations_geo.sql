-- ============================================
-- GYM LOCATION COORDINATES
-- ============================================
-- Lets the app suggest "you're probably at Fitness 19" from the phone's
-- position when a workout's location picker opens. Coordinates are learned
-- passively: when the user picks a gym in the in-workout picker while a
-- fresh position fix is available and the gym has none stored, that fix is
-- saved — the user is standing in the gym at that moment, which is better
-- ground truth than any address form.
--
-- Additive and nullable: rows without coordinates simply never match a
-- proximity suggestion, and code shipped before this migration is
-- unaffected.

ALTER TABLE gym_locations
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION
    CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE gym_locations
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION
    CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

COMMENT ON COLUMN gym_locations.latitude IS
  'Learned when the user selects this gym mid-workout with a position fix available; drives the picker''s "Near you" suggestion';
COMMENT ON COLUMN gym_locations.longitude IS
  'See gym_locations.latitude';
