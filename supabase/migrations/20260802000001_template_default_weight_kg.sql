-- workout_template_exercises.default_weight is KILOGRAMS.
--
-- The column never declared a unit. Its only writer/reader was the template
-- detail page, whose input was hard-coded "Default Weight (lbs)" and stored
-- the typed number verbatim — so every existing row holds POUNDS, regardless
-- of the user's unit preference. "Save as template" (from the active
-- workout's ⋮ menu) writes kg like the rest of the app, and the detail page
-- now converts for display, so the legacy rows need converting once.
--
-- Idempotent: the column comment set at the bottom is the "already migrated"
-- marker, so re-running this file can never double-convert.

DO $$
DECLARE
  existing_comment text;
BEGIN
  SELECT col_description(
           'workout_template_exercises'::regclass,
           (SELECT attnum
              FROM pg_attribute
             WHERE attrelid = 'workout_template_exercises'::regclass
               AND attname = 'default_weight')
         )
    INTO existing_comment;

  IF existing_comment IS NULL THEN
    UPDATE workout_template_exercises
       SET default_weight = ROUND((default_weight / 2.20462)::numeric, 2)
     WHERE default_weight IS NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN workout_template_exercises.default_weight IS
  'Default working weight in KILOGRAMS (app-wide storage unit); converted for display.';
