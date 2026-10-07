-- Where a lifter's between-rep pause sits for an exercise: the START
-- position of the concentric (the motion pipeline measures the dwell
-- before each concentric). Read by the motion coach ("you paused … at the
-- bottom"). NULL = no reliable top/bottom (rows, flys, hip machines, leg
-- curls): the coach then says "between reps". When NULL the app falls back
-- to movement_pattern (presses / squats / hinges / lunges → bottom,
-- vertical pulls → top).

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS pause_point TEXT
  CHECK (pause_point IS NULL OR pause_point IN ('top', 'bottom'));

COMMENT ON COLUMN exercises.pause_point IS
  'Start position of the concentric (where a between-rep pause sits): top | bottom | NULL (ambiguous — coach says "between reps").';

-- Isolation work with an unambiguous start position. Idempotent: only
-- fills NULLs, so hand-set values survive a re-run.
UPDATE exercises SET pause_point = 'bottom'
WHERE pause_point IS NULL
  AND (
    (name ILIKE '%curl%'
      AND name NOT ILIKE '%leg curl%'
      AND name NOT ILIKE '%wrist curl%'
      AND name NOT ILIKE '%nordic%'
      AND name NOT ILIKE '%jefferson%')
    OR name ILIKE '%leg extension%'
    OR name ILIKE '%lateral raise%'
    OR name ILIKE '%front raise%'
    OR name ILIKE '%y-raise%'
    OR name ILIKE '%calf raise%'
    OR name ILIKE '%calf press%'
    OR name ILIKE '%shrug%'
    OR name ILIKE '%upright row%'
    OR name ILIKE '%overhead tricep%'
    OR name ILIKE '%leg press%'
  );

UPDATE exercises SET pause_point = 'top'
WHERE pause_point IS NULL
  AND name ILIKE '%pushdown%';
