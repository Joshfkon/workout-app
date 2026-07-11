-- ============================================================================
-- merge_exercises fixes (follow-up to 20260711000002)
--
-- P1: also rewrite mesocycles.program_data. That JSONB (a FullProgramRecommendation)
--     stores exerciseId UUIDs that startMesocycleSession prefers over a name
--     lookup, so a merged-away duplicate would keep seeding new exercise_blocks
--     (and fresh logs) on the retired row. We deep-remap exerciseId/exerciseName.
--
-- P2: dedupe loser rows among THEMSELVES before repointing unique-key tables.
--     The old code only deleted loser rows colliding with the survivor; when two
--     duplicates in the same merge both had a row for the same user (and the
--     survivor had none), the UPDATE produced two identical (user_id, exercise_id)
--     rows and violated the unique constraint, rolling back the whole merge.
-- ============================================================================

-- Recursive JSON remapper: anywhere in `node` an object has
-- exerciseId ∈ p_from, rewrite it to p_to and set its exerciseName to p_to_name.
-- Shape-agnostic (walks objects and arrays), so it survives program_data schema
-- variation.
CREATE OR REPLACE FUNCTION _remap_exercise_ids(
  node       JSONB,
  p_from     TEXT[],
  p_to       TEXT,
  p_to_name  TEXT
) RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result JSONB;
  k TEXT;
  v JSONB;
  arr JSONB;
BEGIN
  IF node IS NULL THEN
    RETURN node;
  END IF;

  CASE jsonb_typeof(node)
    WHEN 'object' THEN
      result := node;
      IF (result ? 'exerciseId') AND (result->>'exerciseId') = ANY (p_from) THEN
        result := jsonb_set(result, '{exerciseId}', to_jsonb(p_to));
        IF result ? 'exerciseName' THEN
          result := jsonb_set(result, '{exerciseName}', to_jsonb(p_to_name));
        END IF;
      END IF;
      FOR k, v IN SELECT * FROM jsonb_each(result) LOOP
        result := jsonb_set(result, ARRAY[k], _remap_exercise_ids(v, p_from, p_to, p_to_name));
      END LOOP;
      RETURN result;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(_remap_exercise_ids(e, p_from, p_to, p_to_name) ORDER BY ord), '[]'::jsonb)
        INTO arr
        FROM jsonb_array_elements(node) WITH ORDINALITY AS x(e, ord);
      RETURN arr;
    ELSE
      RETURN node;
  END CASE;
END;
$$;

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

  SELECT array_agg(DISTINCT d) INTO v_dups FROM unnest(p_duplicates) AS d;

  SELECT name INTO v_survivor_name FROM exercises WHERE id = p_survivor;
  IF v_survivor_name IS NULL THEN
    RAISE EXCEPTION 'merge_exercises: survivor % does not exist', p_survivor;
  END IF;

  IF EXISTS (SELECT 1 FROM exercises WHERE id = p_survivor AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'merge_exercises: survivor % is soft-deleted; pick a live survivor', p_survivor;
  END IF;

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
          )),
    'mesocycles_program_data',
      (SELECT count(*) FROM mesocycles m
        WHERE m.program_data IS NOT NULL
          AND m.program_data::text LIKE ANY (SELECT '%' || d || '%' FROM unnest(v_active_txt) d))
  );

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

  -- --- Execute repoints. Whole body is one implicit transaction. -----------
  -- For each unique-key table: (1) drop loser rows colliding with the survivor
  -- (survivor wins), (2) drop loser rows colliding with ANOTHER loser (keep one
  -- via ctid), (3) repoint the rest.

  -- set history: no unique constraint on exercise_id.
  UPDATE exercise_blocks SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, session_date)
  DELETE FROM exercise_performance_snapshots t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_performance_snapshots s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.session_date = t.session_date);
  DELETE FROM exercise_performance_snapshots a
    USING exercise_performance_snapshots b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.session_date = b.session_date AND a.ctid < b.ctid;
  UPDATE exercise_performance_snapshots SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, dismissed)
  DELETE FROM plateau_alerts t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM plateau_alerts s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.dismissed = t.dismissed);
  DELETE FROM plateau_alerts a
    USING plateau_alerts b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.dismissed = b.dismissed AND a.ctid < b.ctid;
  UPDATE plateau_alerts SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id)
  DELETE FROM user_exercise_preferences t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM user_exercise_preferences s
                  WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id);
  DELETE FROM user_exercise_preferences a
    USING user_exercise_preferences b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.ctid < b.ctid;
  UPDATE user_exercise_preferences SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id)
  DELETE FROM user_exercise_settings t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM user_exercise_settings s
                  WHERE s.exercise_id = p_survivor AND s.user_id = t.user_id);
  DELETE FROM user_exercise_settings a
    USING user_exercise_settings b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.ctid < b.ctid;
  UPDATE user_exercise_settings SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, location_id)
  DELETE FROM exercise_location_availability t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_location_availability s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.location_id = t.location_id);
  DELETE FROM exercise_location_availability a
    USING exercise_location_availability b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.location_id = b.location_id AND a.ctid < b.ctid;
  UPDATE exercise_location_availability SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, exercise_id, session_id)
  DELETE FROM exercise_usage_history t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM exercise_usage_history s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id AND s.session_id = t.session_id);
  DELETE FROM exercise_usage_history a
    USING exercise_usage_history b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.session_id = b.session_id AND a.ctid < b.ctid;
  UPDATE exercise_usage_history SET exercise_id = p_survivor WHERE exercise_id = ANY (v_active_dups);

  -- (user_id, leaderboard_type, exercise_id, period_start)
  DELETE FROM leaderboard_entries t
    WHERE t.exercise_id = ANY (v_active_dups)
      AND EXISTS (SELECT 1 FROM leaderboard_entries s
                  WHERE s.exercise_id = p_survivor
                    AND s.user_id = t.user_id
                    AND s.leaderboard_type = t.leaderboard_type
                    AND s.period_start = t.period_start);
  DELETE FROM leaderboard_entries a
    USING leaderboard_entries b
    WHERE a.exercise_id = ANY (v_active_dups) AND b.exercise_id = ANY (v_active_dups)
      AND a.user_id = b.user_id AND a.leaderboard_type = b.leaderboard_type
      AND a.period_start = b.period_start AND a.ctid < b.ctid;
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

  -- mesocycles.program_data JSONB — deep-remap stored exerciseId/exerciseName so
  -- a retired duplicate can't seed new blocks on future session starts (P1).
  UPDATE mesocycles m
    SET program_data = _remap_exercise_ids(m.program_data, v_active_txt, p_survivor::text, v_survivor_name)
    WHERE m.program_data IS NOT NULL
      AND m.program_data::text LIKE ANY (SELECT '%' || d || '%' FROM unnest(v_active_txt) d);

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

REVOKE ALL ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_exercises(UUID, UUID[], BOOLEAN) TO service_role;
