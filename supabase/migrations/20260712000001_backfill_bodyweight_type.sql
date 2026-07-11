-- ============================================================================
-- Backfill bodyweight_type for library exercises left NULL
-- ============================================================================
--
-- ROOT CAUSE
-- The original classifier (20241224000001_bodyweight_exercises.sql) assigned
-- bodyweight_type by EXACT, SINGULAR names ('Pull-Up', 'Dip', 'Plank', …). Two
-- problems left most bodyweight exercises unclassified (bodyweight_type IS NULL):
--
--   1. Name mismatches. The seeded library uses different spellings/plurals:
--      'Pull-Ups', 'Dips (Chest Focus)', 'Dips (Tricep Focus)', etc. — none of
--      which matched the singular UPDATE targets.
--   2. Ordering. `supabase db reset` runs migrations, THEN seed.sql. The
--      name-based UPDATEs in 20241224000001 executed BEFORE seed.sql inserted
--      most of these rows, so they matched nothing on a fresh database.
--   3. Later additions. Bodyweight exercises added in 2026 migrations
--      (Superman Hold, Side Plank, Dead Hang, Copenhagen Plank,
--      Single Leg Calf Raise, …) were never given a type.
--
-- A NULL bodyweight_type makes the set logger fall back to "offer both weight
-- and assistance", and any name-flagging edge case can drop the weight field
-- entirely — the symptom in the bug report ("Back extensions" shows no weight
-- field while "Back Extension" has weighted history).
--
-- FIX
-- Classify by CASE-INSENSITIVE name patterns, but ONLY where bodyweight_type is
-- still NULL (never override an explicit choice) and the row is a bodyweight
-- exercise. Genuinely ambiguous custom exercises whose names don't match any
-- known movement are intentionally left NULL for manual review.
--
-- Idempotent: re-running is a no-op once types are set.
-- ============================================================================

-- First, make sure library bodyweight movements are actually flagged
-- is_bodyweight so the classifier below (and the set logger) recognise them.
-- Covers rows tagged bodyweight either on the scalar column or in the
-- equipment_required array, plus the canonical bodyweight movement names.
UPDATE exercises
SET is_bodyweight = true
WHERE is_bodyweight IS DISTINCT FROM true
  AND (
    LOWER(COALESCE(equipment, '')) = 'bodyweight'
    OR 'bodyweight' = ANY(COALESCE(equipment_required, '{}'))
    OR name ~* '(pull[-\s]?up|chin[-\s]?up|muscle[-\s]?up|^dips?\y|\ydips?\y|push[-\s]?up|back extension|leg raise|glute bridge|hip thrust|nordic curl|sissy squat|pistol squat|plank|dead bug|ab wheel|superman|copenhagen|hollow|l[-\s]?sit|bird ?dog|dead hang|inverted row)'
  );

-- both: weighted OR assisted (pull-ups, chin-ups, dips, muscle-ups)
UPDATE exercises
SET bodyweight_type = 'both',
    assistance_type = COALESCE(assistance_type, 'band')
WHERE is_bodyweight = true
  AND bodyweight_type IS NULL
  AND name ~* '(pull[-\s]?up|chin[-\s]?up|muscle[-\s]?up|(^|\y)dips?(\y|$))'
  AND name !~* 'assist';

-- assisted_possible: assistance-only machines / Nordic curls
UPDATE exercises
SET bodyweight_type = 'assisted_possible',
    assistance_type = COALESCE(
      assistance_type,
      CASE WHEN name ~* 'machine' THEN 'machine' ELSE 'band' END
    )
WHERE is_bodyweight = true
  AND bodyweight_type IS NULL
  AND (name ~* 'assist' OR name ~* 'nordic');

-- pure: isometric holds / anti-movement core with no practical load mod.
-- `dead hang` matches but a generic "hanging leg raise" does not (it is loadable).
UPDATE exercises
SET bodyweight_type = 'pure'
WHERE is_bodyweight = true
  AND bodyweight_type IS NULL
  AND name ~* '(plank|dead bug|ab wheel|superman|copenhagen|hollow|l[-\s]?sit|bird ?dog|dead hang|wall sit)';

-- weighted_possible: everything loadable — push-ups, back extensions, leg
-- raises, glute bridges, hip thrusts, squats, rows, calf raises, abduction.
UPDATE exercises
SET bodyweight_type = 'weighted_possible'
WHERE is_bodyweight = true
  AND bodyweight_type IS NULL
  AND name ~* '(push[-\s]?up|back extension|leg raise|glute bridge|hip thrust|sissy squat|pistol squat|step[-\s]?up|inverted row|calf raise|hip abduction|hip adduction|decline crunch|russian twist|hyperextension)';

-- Note: any remaining is_bodyweight row with bodyweight_type IS NULL is an
-- unrecognised (likely custom) exercise. Run the audit query in
-- docs/BODYWEIGHT_TYPE_AUDIT.md to list them for manual classification.
