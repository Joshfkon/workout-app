-- Phase 2 apply (muscle-attribution audit, docs/MUSCLE_ATTRIBUTION_AUDIT.md):
-- retag exercises whose PRIMARY is a coarse legacy group token that the
-- volume counter splits uniformly across heads. The split share (⅓ for
-- 'shoulders', ½ for 'chest'/'back') is never larger than the 0.5 secondary
-- credit, so such an exercise ranks its own target at or below every
-- secondary it touches — one bad rule, not N bad rows.
--
-- The stock library was fixed by 20260702000001 (name-keyed). This migration
-- covers the rows that migration could not reach: USER-CREATED exercises and
-- stray stock rows, matched by NAME PATTERN using the confirmed rules from
-- lib/migrations/coarsePrimaryRetag.ts (name_pattern class only — rows whose
-- name doesn't disambiguate are left untouched and keep surfacing in the
-- runtime dry-run report for a human decision).
--
-- AUDIT + REVERSIBILITY: previous tags are recorded in
-- exercise_muscle_retag_audit BEFORE each update; nothing is deleted, and a
-- rollback is a rejoin against this table. Soft-deleted rows are retagged
-- too so a later restore comes back with correct tags.
--
-- PARSER NOTE: statements use "UPDATE public.exercises" deliberately.
-- scripts/seedTagParser.js (the generated stock-tag snapshot) only
-- understands name-keyed updates and throws on pattern-keyed ones; the
-- schema-qualified form is skipped by its statement matcher. These updates
-- target user rows by pattern, not stock rows by name, so they must NOT
-- feed the stock snapshot.

CREATE TABLE IF NOT EXISTS exercise_muscle_retag_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL REFERENCES exercises(id),
  migration TEXT NOT NULL,
  rule TEXT NOT NULL,
  old_primary TEXT,
  old_secondaries TEXT[],
  new_primary TEXT NOT NULL,
  new_secondaries TEXT[] NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only: RLS enabled with no policies (this is an operator audit
-- trail, not user-facing data).
ALTER TABLE exercise_muscle_retag_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_exercise_retag_audit_exercise
  ON exercise_muscle_retag_audit (exercise_id);

-- One statement pair per rule, applied in first-match-wins order: the
-- candidate query excludes rows already audited by THIS migration, so
-- 'Arnold Press' is consumed by the arnold rule before the generic press
-- rule can see it. new_secondaries = (old secondaries + rule additions),
-- minus the old coarse token and the new primary, deduplicated.

-- ── shoulders / arnold → front_delts + lateral_delts ─────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'arnold'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'arnold', primary_muscle, secondary_muscles, 'front_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['lateral_delts']) AS s
        WHERE lower(s) NOT IN ('shoulders', 'front_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'arnold';

-- ── shoulders / lateral raises → lateral_delts ───────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'lateral raise|side raise|side lateral'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'lateral_raise', primary_muscle, secondary_muscles, 'lateral_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('shoulders', 'lateral_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'lateral_raise';

-- ── shoulders / front raises → front_delts ───────────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'front raise'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'front_raise', primary_muscle, secondary_muscles, 'front_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('shoulders', 'front_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'front_raise';

-- ── shoulders / rear-delt work → rear_delts ──────────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'rear delt|reverse fly|reverse pec|reverse crossover|face pull'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'rear_delt', primary_muscle, secondary_muscles, 'rear_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('shoulders', 'rear_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'rear_delt';

-- ── shoulders / upright rows → lateral_delts + traps ─────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'upright row'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'upright_row', primary_muscle, secondary_muscles, 'lateral_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['traps']) AS s
        WHERE lower(s) NOT IN ('shoulders', 'lateral_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'upright_row';

-- ── shoulders / shrugs → traps ───────────────────────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'shrug'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'shrug', primary_muscle, secondary_muscles, 'traps',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('shoulders', 'traps'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'shrug';

-- ── shoulders / presses (generic, after arnold consumed) → front_delts ───
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'shoulders'
    AND name ~* 'press'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'shoulder_press', primary_muscle, secondary_muscles, 'front_delts',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('shoulders', 'front_delts'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'shoulder_press';

-- ── chest / incline → chest_upper + chest_lower ──────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'chest'
    AND name ~* 'incline'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'chest_incline', primary_muscle, secondary_muscles, 'chest_upper',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['chest_lower']) AS s
        WHERE lower(s) NOT IN ('chest', 'chest_upper'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'chest_incline';

-- ── chest / decline + dips → chest_lower + chest_upper ───────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'chest'
    AND name ~* 'decline|dip'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'chest_decline_dip', primary_muscle, secondary_muscles, 'chest_lower',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[]) || ARRAY['chest_upper']) AS s
        WHERE lower(s) NOT IN ('chest', 'chest_lower'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'chest_decline_dip';

-- ── back / vertical pulls → lats ─────────────────────────────────────────
WITH candidates AS (
  SELECT id, primary_muscle, secondary_muscles
  FROM public.exercises
  WHERE lower(primary_muscle) = 'back'
    AND name ~* 'pulldown|pull.?up|chin.?up'
    AND id NOT IN (SELECT exercise_id FROM exercise_muscle_retag_audit
                   WHERE migration = '20260727000001')
)
INSERT INTO exercise_muscle_retag_audit
  (exercise_id, migration, rule, old_primary, old_secondaries, new_primary, new_secondaries)
SELECT id, '20260727000001', 'back_vertical_pull', primary_muscle, secondary_muscles, 'lats',
  ARRAY(SELECT DISTINCT s
        FROM unnest(coalesce(secondary_muscles, '{}'::text[])) AS s
        WHERE lower(s) NOT IN ('back', 'lats'))
FROM candidates;

UPDATE public.exercises e
SET primary_muscle = a.new_primary, secondary_muscles = a.new_secondaries
FROM exercise_muscle_retag_audit a
WHERE a.exercise_id = e.id AND a.migration = '20260727000001' AND a.rule = 'back_vertical_pull';

-- Flat/bench pressing tagged 'chest' and rows tagged 'back' are INTENTIONALLY
-- coarse (both sub-groups work hard) and are deliberately not retagged here —
-- matching the stock-library policy and the audit's tied-class decision.
