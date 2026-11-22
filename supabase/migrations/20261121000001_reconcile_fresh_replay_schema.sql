-- Reconcile what a fresh replay of supabase/migrations is still missing
-- compared with the schema the app uses. These objects reached production
-- outside the migration files; this records them so `supabase db reset`
-- produces a database the app runs against.
--
-- Idempotent: on production every statement is a no-op.

-- set_logs.feedback: structured per-set feedback (RIR, form, discomfort;
-- SetFeedback in types/schema.ts). Written by the workout page on every
-- logged set; no migration ever added it.
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS feedback JSONB;

-- The legacy food_log (20241213000001) limits source to
-- nutritionix|custom|manual. The app logs 'usda', 'fatsecret' and 'ai'
-- (types/nutrition.ts FoodSource, LabelScanner), so on production this check
-- cannot be in place. Drop it only if it still has the legacy definition.
DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.food_log'::regclass
    AND c.conname = 'food_log_source_check';
  IF def IS NOT NULL AND def NOT LIKE '%usda%' THEN
    ALTER TABLE public.food_log DROP CONSTRAINT food_log_source_check;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_food_log_food_id
  ON food_log(food_id) WHERE food_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
