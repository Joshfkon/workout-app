-- Extend the custom-exercise stabilizer backfill to the six entries added by
-- the 2026-09-13 coverage audit (20260913000002_seed_stabilizers_audit_additions.sql).
--
-- Same mechanism, scope and guards as
-- 20260913000001_backfill_custom_stabilizers.sql: CUSTOM rows only, EMPTY
-- rows only, matched by normalized name token-set (lowercase, split on
-- non-alphanumeric runs, dedupe, sort), idempotent, nothing deleted. The
-- drift-guard test (services/__tests__/stabilizerCustomBackfill.test.ts)
-- parses the UNION of both custom backfill migrations' VALUES lists and
-- compares it to STABILIZERS_BY_EXERCISE_NAME — edit the map and the
-- migrations together or that test fails. Token-set uniqueness across the
-- whole map is asserted there too, so a custom row can never match two
-- entries with different tags.

CREATE OR REPLACE FUNCTION pg_temp.stabilizer_name_tokens(txt TEXT)
RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(array_agg(DISTINCT tok ORDER BY tok), ARRAY[]::TEXT[])
  FROM regexp_split_to_table(lower(regexp_replace(txt, '[^a-zA-Z0-9]+', ' ', 'g')), ' ') AS tok
  WHERE tok <> '';
$fn$;

WITH canonical(name, stabs) AS (
  VALUES
    ('Band Pull-Apart', ARRAY['rotator_cuff']),
    ('Dumbbell Fly', ARRAY['rotator_cuff']),
    ('Overhead Tricep Extension', ARRAY['rotator_cuff']),
    ('Cable Overhead Tricep Extension', ARRAY['rotator_cuff']),
    ('Katana Tricep Extension', ARRAY['rotator_cuff']),
    ('Bulgarian Split Squat', ARRAY['erectors'])
)
UPDATE exercises e
   SET stabilizers = c.stabs
  FROM canonical c
 WHERE e.is_custom IS TRUE
   AND (e.stabilizers IS NULL OR e.stabilizers = '{}')
   AND pg_temp.stabilizer_name_tokens(e.name) = pg_temp.stabilizer_name_tokens(c.name);
