-- ============================================================================
-- Audited in-app editing of STOCK catalog exercises
-- ----------------------------------------------------------------------------
-- RLS only allows direct UPDATEs on a user's own custom rows
-- (20241212000001), so stock catalog edits from the edit UI matched zero
-- rows. The app now reports that honestly (updateExerciseRow), and this
-- migration adds the sanctioned write path: update_catalog_exercise(), a
-- SECURITY DEFINER RPC that
--   1. rejects anything but a whitelisted, user-editable column set (so a
--      caller can never touch is_custom / created_by / deleted_at /
--      merged_into through it),
--   2. records the previous values of exactly the touched columns in
--      exercise_catalog_edit_audit BEFORE writing (policy: audit before
--      data changes; rollback is a rejoin against the audit table),
--   3. applies the patch to the shared catalog row — the single source of
--      truth every read path (volume, recovery, session load) already joins.
--
-- Catalog edits apply to EVERY user by design (operator decision,
-- 2026-07-27: single-user beta, catalog corrections should be global).
-- If this ever becomes properly multi-tenant, tighten access by swapping
-- the GRANT below for an editor-allowlist check inside the function —
-- the audit trail already records who changed what.
--
-- PARSER NOTE: the UPDATE inside the function body is schema-qualified AND
-- aliased ("UPDATE public.exercises e") ON PURPOSE so
-- scripts/seedTagParser.js (which naive-splits statements on ';' and
-- derives the stock tag snapshot from name-keyed updates) skips it instead
-- of parsing runtime SQL as seed data.
-- ============================================================================

-- exercise_id is deliberately NOT a foreign key: the audit row must outlive
-- its subject (same rationale as exercise_muscle_retag_audit).
CREATE TABLE IF NOT EXISTS exercise_catalog_edit_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id UUID NOT NULL,
  edited_by UUID NOT NULL,
  old_values JSONB NOT NULL,
  new_values JSONB NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only: RLS enabled with no policies (operator audit trail).
ALTER TABLE exercise_catalog_edit_audit ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_edit_audit_exercise
  ON exercise_catalog_edit_audit (exercise_id);

CREATE OR REPLACE FUNCTION update_catalog_exercise(
  p_exercise_id UUID,
  p_patch JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed CONSTANT TEXT[] := ARRAY[
    'name', 'is_bodyweight', 'bodyweight_type', 'assistance_type',
    'equipment', 'equipment_required', 'movement_pattern', 'primary_muscle',
    'secondary_muscles', 'hypertrophy_tier', 'default_rep_range',
    'default_rir', 'setup_note', 'youtube_video_id'
  ];
  v_key TEXT;
  v_row public.exercises%ROWTYPE;
  v_old JSONB := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'update_catalog_exercise: not authenticated';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'update_catalog_exercise: patch must be a non-empty object';
  END IF;

  SELECT * INTO v_row FROM public.exercises WHERE id = p_exercise_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_catalog_exercise: exercise % does not exist', p_exercise_id;
  END IF;
  IF v_row.is_custom THEN
    RAISE EXCEPTION 'update_catalog_exercise: "%" is a custom exercise — edit it directly (RLS covers your own rows)', v_row.name;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'update_catalog_exercise: "%" is soft-deleted; restore it before editing', v_row.name;
  END IF;

  -- Whitelist enforcement + old-value capture for exactly the touched keys.
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'update_catalog_exercise: column "%" is not editable', v_key;
    END IF;
    v_old := v_old || jsonb_build_object(v_key, to_jsonb(v_row) -> v_key);
  END LOOP;

  -- Audit BEFORE the write; same transaction, so a failed write rolls both back.
  INSERT INTO exercise_catalog_edit_audit (exercise_id, edited_by, old_values, new_values)
  VALUES (p_exercise_id, auth.uid(), v_old, p_patch);

  UPDATE public.exercises e SET
    name               = CASE WHEN p_patch ? 'name' THEN p_patch->>'name' ELSE e.name END,
    is_bodyweight      = CASE WHEN p_patch ? 'is_bodyweight' THEN (p_patch->>'is_bodyweight')::boolean ELSE e.is_bodyweight END,
    bodyweight_type    = CASE WHEN p_patch ? 'bodyweight_type' THEN p_patch->>'bodyweight_type' ELSE e.bodyweight_type END,
    assistance_type    = CASE WHEN p_patch ? 'assistance_type' THEN p_patch->>'assistance_type' ELSE e.assistance_type END,
    equipment          = CASE WHEN p_patch ? 'equipment' THEN p_patch->>'equipment' ELSE e.equipment END,
    equipment_required = CASE WHEN p_patch ? 'equipment_required' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'equipment_required')) ELSE e.equipment_required END,
    movement_pattern   = CASE WHEN p_patch ? 'movement_pattern' THEN p_patch->>'movement_pattern' ELSE e.movement_pattern END,
    primary_muscle     = CASE WHEN p_patch ? 'primary_muscle' THEN p_patch->>'primary_muscle' ELSE e.primary_muscle END,
    secondary_muscles  = CASE WHEN p_patch ? 'secondary_muscles' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'secondary_muscles')) ELSE e.secondary_muscles END,
    hypertrophy_tier   = CASE WHEN p_patch ? 'hypertrophy_tier' THEN p_patch->>'hypertrophy_tier' ELSE e.hypertrophy_tier END,
    default_rep_range  = CASE WHEN p_patch ? 'default_rep_range' THEN ARRAY(SELECT (jsonb_array_elements_text(p_patch->'default_rep_range'))::integer) ELSE e.default_rep_range END,
    default_rir        = CASE WHEN p_patch ? 'default_rir' THEN (p_patch->>'default_rir')::integer ELSE e.default_rir END,
    setup_note         = CASE WHEN p_patch ? 'setup_note' THEN p_patch->>'setup_note' ELSE e.setup_note END,
    youtube_video_id   = CASE WHEN p_patch ? 'youtube_video_id' THEN p_patch->>'youtube_video_id' ELSE e.youtube_video_id END
  WHERE e.id = p_exercise_id;

  RETURN jsonb_build_object('id', p_exercise_id, 'updated', true);
END;
$$;

REVOKE ALL ON FUNCTION update_catalog_exercise(UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_catalog_exercise(UUID, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION update_catalog_exercise(UUID, JSONB) TO authenticated, service_role;
