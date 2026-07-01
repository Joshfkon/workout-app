-- Saved meals: user-named bundles of food items logged together in one tap.
-- items is a jsonb array of { name, serving_size, servings, calories, protein, carbs, fat, icon? }
-- (denormalized on purpose — a saved meal is a snapshot, not a live reference,
-- so editing a custom food later never silently changes a saved meal).
CREATE TABLE IF NOT EXISTS saved_meals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_calories NUMERIC NOT NULL DEFAULT 0,
  total_protein NUMERIC NOT NULL DEFAULT 0,
  total_carbs NUMERIC NOT NULL DEFAULT 0,
  total_fat NUMERIC NOT NULL DEFAULT 0,
  times_logged INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_meals_user
  ON saved_meals(user_id, times_logged DESC);

ALTER TABLE saved_meals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved meals"
  ON saved_meals FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved meals"
  ON saved_meals FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own saved meals"
  ON saved_meals FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved meals"
  ON saved_meals FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE saved_meals IS
  'Named food bundles for one-tap re-logging (Phase 4 nutrition rebuild)';
