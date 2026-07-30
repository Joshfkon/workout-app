-- ============================================================================
-- Exercise soft-delete + reversible merge
-- ----------------------------------------------------------------------------
-- Adds a soft-delete/merge audit trail to `exercises` and a single atomic,
-- collision-safe `merge_exercises(survivor, duplicates[], dry_run)` function
-- that repoints every reference from the duplicates onto the survivor and
-- soft-deletes the losers (reversible: nothing is hard-deleted).
--
-- Nothing here merges anything on its own — the function only runs when invoked
-- (see scripts/mergeExercises.ts), and defaults to dry-run.
-- ============================================================================

-- 1) Soft-delete + merge trail on exercises ---------------------------------
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES exercises(id);

COMMENT ON COLUMN exercises.deleted_at IS
  'When set, the exercise is soft-deleted (hidden from the app). Set by merge_exercises; reversible until manually purged.';
COMMENT ON COLUMN exercises.merged_into IS
  'For a merged duplicate, the survivor exercise its references were repointed to.';

CREATE INDEX IF NOT EXISTS idx_exercises_not_deleted
  ON exercises (id) WHERE deleted_at IS NULL;

-- 2) The merge function ------------------------------------------------------
CREATE OR REPLACE FUNCTION merge_exercises(
  p_survivor   UUID,
  p_duplicates UUID[],
  p_dry_run    BOOLEAN DEFAULT TRUE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dups          UUID[];
  v_active_dups   UUID[];
  v_skipped       UUID[];
  v_survivor_name TEXT;
  v_counts        JSONB;
  v_dropped       JSONB;
  v_active_txt    TEXT[];
BEGIN
  -- --- Guardrails ---------------------------------------------------------
  IF p_survivor IS NULL OR p_duplicates IS NULL OR array_length(p_duplicates, 1) IS NULL THEN
    RAISE EXCEPTION 'merge_exercises: a survivor and a non-empty duplicates array are required';
  END IF;

  IF p_survivor = ANY (p_duplicates) THEN
    RAISE EXCEPTION 'merge_exercises: survivor % must not appear in the duplicates list', p_survivor;
  END IF;

  -- De-dupe the duplicates list.
  SELECT array_agg(DISTINCT d) INTO v_dups FROM unnest(p_duplicates) AS d;

  SELECT name INTO v_survivor_name FROM exercises WHERE id = p_survivor;
  IF v_survivor_name IS NULL THEN
    RAISE EXCEPTION 'merge_exercises: survivor % does not exist', p_survivor;
  END IF;

  IF EXISTS (SELECT 1 FROM exercises WHERE id = p_survivor AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_exercises: survivor % is soft-deleted; pick a live survivor', p_survivor;
  END IF;

  -- Idempotency: only touch duplicates that still exist and are not already
  -- merged/soft-deleted. Everything else is reported as skipped.
  SELECT array_agg(id) INTO v_active_dups
    FROM exercises WHERE id = ANY (v_dups) AND deleted_at IS NULL;

  SELECT array_agg(d) INTO v_skipped
    FROM unnest(v_dups) AS d
    WHERE d <> ALL (COALESCE(v_active_dups, ARRAY[]::uuid[]));

  IF v_active_dups IS NULL THEN
    RETURN jsonb_build_object(
      'survivor',     p_survivor,
      'survivorName', v_survivor_name,
      'dryRun',       p_dry_run,
      'active',       '[]'::jsonb,
      'skipped',      to_jsonb(COALESCE(v_skipped, ARRAY[]::uuid[])),
      'counts',       '{}'::jsonb,
      'note',         'No active duplicates to merge (already merged, soft-deleted, or non-existent).'
    );
  END IF;

  v_active_txt := v_active_dups::text[];

  -- --- Count what will move (works for both dry-run and execute) -----------
  v_counts := jsonb_build_object(
    'exercise_blocks',
      (SELECT count(*) FROM exercise_blocks WHERE exercise_id = ANY (v_active_dups)),
    'exercise_performance_snapshots',
      (SELECT count(*) FROM exercise_performance_snapshots WHERE exercise_id = ANY (v_active_dups)),
    'plateau_alerts',
      (SELECT count(*) FROM plateau_alerts WHERE exercise_id = ANY (v_active_dups)),
    'user_exercise_preferences',
      (SELECT count(*) FROM user_exercise_preferences WHERE exercise_id = ANY (v_active_dups)),
    'user_exercise_settings',
      (SELECT count(*) FROM user_exercise_settings WHERE exercise_id = ANY (v_active_dups)),
    'exercise_location_availability',
      (SELECT count(*) FROM exercise_location_availability WHERE exercise_id = ANY (v_active_dups)),
    'exercise_usage_history',
      (SELECT count(*) FROM exercise_usage_history WHERE exercise_id = ANY (v_active_dups)),
    'leaderboard_entries',
      (SELECT count(*) FROM leaderboard_entries WHERE exercise_id = ANY (v_active_dups)),
    'amrap_calibrations',
      (SELECT count(*) FROM amrap_calibrations WHERE exercise_id = ANY (v_active_dups)),
    'workout_template_exercises',
      (SELECT count(*) FROM workout_template_exercises WHERE exercise_id = ANY (v_active_dups)),
    'mesocycles_with_overrides',
      (SELECT count(*) FROM mesocycles m
        WHERE jsonb_typeof(m.exercise_overrides) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(m.exercise_overrides) e
            WHERE e->>'originalExerciseId'    = ANY (v_active_txt)
               OR e->>'replacementExerciseId' = ANY (v_active_txt)
          ))
  );

  -- --- Per-user settings the survivor already has: these duplicate rows are
  -- dropped (survivor's values win) rather than repointed. Reported so the
  -- caller can see exactly what a merge discards. --------------------------
  v_dropped := jsonb_build_object(
    'user_exercise_preferences',
      (SELECT count(*) FROM user_exercise_preferences t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM user_exercise_preferences s
                      WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id)),
    'user_exercise_settings',
      (SELECT count(*) FROM user_exercise_settings t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM user_exercise_settings s
                      WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id)),
    'exercise_performance_snapshots',
      (SELECT count(*) FROM exercise_performance_snapshots t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM exercise_performance_snapshots s
                      WHERE s.exercise_id = p_survivor
                        AND s.user_id = t.user_id AND s.session_date = t.session_date)),
    'exercise_location_availability',
      (SELECT count(*) FROM exercise_location_availability t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM exercise_location_availability s
                      WHERE s.exercise_id = p_survivor
                        AND s.user_id = t.user_id AND s.location_id = t.location_id)),
    'exercise_usage_history',
      (SELECT count(*) FROM exercise_usage_history t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM exercise_usage_history s
                      WHERE s.exercise_id = p_survivor
                        AND s.user_id = t.user_id AND s.session_id = t.session_id)),
    'leaderboard_entries',
      (SELECT count(*) FROM leaderboard_entries t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM leaderboard_entries s
                      WHERE s.exercise_id = p_survivor
                        AND s.user_id = t.user_id
                        AND s.leaderboard_type = t.leaderboard_type
                        AND s.period_start = t.period_start)),
    'plateau_alerts',
      (SELECT count(*) FROM plateau_alerts t
        WHERE t.exercise_id = ANY (v_active_dups)
          AND EXISTS (SELECT 1 FROM plateau_alerts s
                      WHERE s.exercise_id = p_survivor
                        AND s.user_id = t.user_id AND s.dismissed = t.dismissed))
  );

  -- --- Dry run: report and stop, mutating nothing -------------------------
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'survivor',     p_survivor,
      'survivorName', v_survivor_name,
      'dryRun',       true,
      'active',       to_jsonb(v_active_dups),
      'skipped',      to_jsonb(COALESCE(v_skipped, ARRAY[]::uuid[])),
      'counts',       v_counts,
      'dropped',      v_dropped,
      'note',         'Dry run — no changes were written.'
    );
  END IF;

  -- --- Execute repoints (survivor wins on unique-key collisions) ----------
  -- The whole function body is one implicit transaction; any error rolls back.

  -- set history: exercise_blocks has no unique constraint on exercise_id.
  UPDATE exercise_blocks SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, session_date)
  DELETE FROM exercise_performance_snapshots t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_performance_snapshots s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.session_date = t.session_date);
  UPDATE exercise_performance_snapshots SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, dismissed)
  DELETE FROM plateau_alerts t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM plateau_alerts s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.dismissed = t.dismissed);
  UPDATE plateau_alerts SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id)
  DELETE FROM user_exercise_preferences t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM user_exercise_preferences s
                  WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id);
  UPDATE user_exercise_preferences SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id)
  DELETE FROM user_exercise_settings t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM user_exercise_settings s
                  WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id);
  UPDATE user_exercise_settings SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, location_id)
  DELETE FROM exercise_location_availability t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_location_availability s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.location_id = t.location_id);
  UPDATE exercise_location_availability SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, session_id)
  DELETE FROM exercise_usage_history t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_usage_history s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.session_id = t.session_id);
  UPDATE exercise_usage_history SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, leaderboard_type, exercise_id, period_start)
  DELETE FROM leaderboard_entries t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM leaderboard_entries s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id
                    AND s.leaderboard_type = t.leaderboard_type
                    AND s.period_start = t.period_start);
  UPDATE leaderboard_entries SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- No unique constraint; repoint and refresh the denormalized name.
  UPDATE amrap_calibrations SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);
  UPDATE workout_template_exercises
    SET exercise_id = p_survivor, exercise_name = v_survivor_name
    WHERE exercise_id = ANY (v_active_dups);

  -- mesocycles.exercise_overrides JSONB — rewrite both id/name pairs.
  UPDATE mesocycles m
    SET exercise_overrides = sub.arr
    FROM (
      SELECT m2.id,
             jsonb_agg(
               CASE
                 WHEN elem->>'replacementExerciseId' = ANY (v_active_txt) THEN
                   jsonb_set(
                     jsonb_set(elem, '{replacementExerciseId}', to_jsonb(p_survivor::text)),
                     '{replacementExerciseName}', to_jsonb(v_survivor_name))
                 WHEN elem->>'originalExerciseId' = ANY (v_active_txt) THEN
                   jsonb_set(
                     jsonb_set(elem, '{originalExerciseId}', to_jsonb(p_survivor::text)),
                     '{originalExerciseName}', to_jsonb(v_survivor_name))
                 ELSE elem
               END
               ORDER BY ord
             ) AS arr
        FROM mesocycles m2,
             jsonb_array_elements(m2.exercise_overrides) WITH ORDINALITY AS t(elem, ord)
        WHERE jsonb_typeof(m2.exercise_overrides) = 'array'
        GROUP BY m2.id
    ) sub
    WHERE m.id = sub.id
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(m.exercise_overrides) e
        WHERE e->>'originalExerciseId'    = ANY (v_active_txt)
           OR e->>'replacementExerciseId' = ANY (v_active_txt)
      );

  -- --- Soft-delete the losers --------------------------------------------
  UPDATE exercises
    SET deleted_at = now(), merged_into = p_survivor
    WHERE id = ANY (v_active_dups) AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'survivor',     p_survivor,
    'survivorName', v_survivor_name,
    'dryRun',       false,
    'active',       to_jsonb(v_active_dups),
    'skipped',      to_jsonb(COALESCE(v_skipped, ARRAY[]::uuid[])),
    'counts',       v_counts,
    'dropped',      v_dropped,
    'note',         'Merge complete. Duplicates soft-deleted (merged_into set); reversible until purged.'
  );
END;
$$;

-- Only the service role may merge. Normal app users must never call this.
REVOKE ALL ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) TO service_role;

-- 3) Optional helper to reverse a merge (restores soft-deleted duplicates).
-- References are NOT automatically un-repointed (that history is now genuinely
-- shared); this simply un-hides the rows so a human can re-split if needed.
CREATE OR REPLACE FUNCTION unmerge_exercise(p_duplicate UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE exercises SET deleted_at = NULL, merged_into = NULL
    WHERE id = p_duplicate AND deleted_at IS NOT NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION unmerge_exercise(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION unmerge_exercise(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION unmerge_exercise(UUID) TO service_role;
