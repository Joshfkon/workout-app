-- ============================================================
-- FINE-MUSCLE TAXONOMY RETAG (traps + calves split, 2026-07-13)
-- ============================================================
-- Companion to the taxonomy extension in types/schema.ts that adds four fine
-- standard muscles with coarse parents:
--   traps  -> upper_traps / mid_lower_traps
--   calves -> gastrocnemius / soleus
-- (shoulders -> front/lateral/rear delts, chest -> chest_upper/chest_lower and
-- abs -> abs/obliques were already fine-tagged by the 20260702000001 audit;
-- glutes -> glute_med and back -> lats/erectors predate it.)
--
-- Rule-based retag of stock exercises where the NAME/PATTERN makes the fine
-- assignment unambiguous. Coarse tags stay valid and roll up to the coarse
-- row, so anything ambiguous is deliberately left alone:
--
--   RETAGGED (primary)
--   * Shrug pattern -> upper_traps (elevation is upper-trap work, full stop).
--   * SEATED calf raise (bent knee slackens the gastroc) -> soleus primary,
--     gastrocnemius secondary.
--   * Standing / donkey / leg-press-pattern calf raises (straight knee)
--     -> gastrocnemius primary, soleus secondary.
--
--   RETAGGED (secondary 'traps' -> fine member)
--   * Upright rows -> upper_traps (loaded scapular elevation).
--   * Y-raise pattern (Cable Y-Raise, Prone Y-Raise) -> mid_lower_traps —
--     the movement exists to bias the lower fibers.
--   * Face Pull -> mid_lower_traps (scap retraction + external rotation is
--     mid/lower-trap territory; the rear_delts primary is untouched).
--
--   KEPT COARSE (deliberately — diffuse or genuinely two-headed)
--   * Hinge/carry 'traps' secondaries (Deadlift, Romanian/Stiff Leg/Sumo
--     Deadlift, Farmer's/Suitcase Carry): heavy holds load the whole
--     trapezius; picking a fiber region would be false precision.
--   * Flat pressing + flys stay 'chest'; rows stay 'back'; trunk-flexion ab
--     work stays 'abs' (the volume tracker splits or holds coarse credit
--     appropriately — see LEGACY_PRIMARY_VOLUME_WEIGHTS).
--
-- No exercise rows are inserted; there is no stock Kelso shrug, so
-- mid_lower_traps is fed by secondaries only (face pulls / Y-raises), exactly
-- like other indirect-fill muscles (MEV 0 defaults).
--
-- Values use StandardMuscleGroup tokens (types/schema.ts). App-side matching
-- stays overlap-aware via muscleMatchesGroup(): the legacy 'traps'/'calves'
-- chips and filters match the new fine tags through LEGACY_TO_STANDARD_MAP.
-- Idempotent plain UPDATEs keyed by unique exercise name, scoped to
-- is_custom IS NOT TRUE so user-created customs are never touched.
-- supabase/seed.sql carries the same values for fresh databases (migrations
-- run before seed, so these UPDATEs are no-ops there by design).
--
-- KEEP IN SYNC: the RECLASSIFY table in
-- app/(dashboard)/dashboard/exercises/__tests__/muscleChipCoverage.test.ts
-- mirrors the primary_muscle changes below.
-- ============================================================

-- ============================================
-- TRAPS: shrugs are upper-trap primaries
-- ============================================
UPDATE exercises SET primary_muscle = 'upper_traps'
  WHERE name IN ('Dumbbell Shrug', 'Barbell Shrug')
  AND is_custom IS NOT TRUE;

-- Upright rows: loaded elevation — the 'traps' secondary is upper-trap work.
UPDATE exercises SET secondary_muscles = ARRAY['upper_traps','biceps']
  WHERE name IN ('Upright Row', 'Cable Upright Row')
  AND is_custom IS NOT TRUE;

-- Y-raise pattern exists to bias the lower fibers.
UPDATE exercises SET secondary_muscles = ARRAY['mid_lower_traps']
  WHERE name = 'Cable Y-Raise'
  AND is_custom IS NOT TRUE;

UPDATE exercises SET secondary_muscles = ARRAY['rear_delts','mid_lower_traps']
  WHERE name = 'Prone Y-Raise'
  AND is_custom IS NOT TRUE;

-- Face pull: scap retraction + external rotation loads the mid/lower fibers.
UPDATE exercises SET secondary_muscles = ARRAY['upper_back','mid_lower_traps']
  WHERE name = 'Face Pull'
  AND is_custom IS NOT TRUE;

-- ============================================
-- CALVES: knee angle decides the primary
-- ============================================
-- Seated (bent knee) raises slacken the gastrocnemius: soleus does the work.
UPDATE exercises SET primary_muscle = 'soleus', secondary_muscles = ARRAY['gastrocnemius']
  WHERE name = 'Seated Calf Raise'
  AND is_custom IS NOT TRUE;

-- Straight-knee raises (standing / donkey / leg-press pattern) are
-- gastrocnemius-dominant; the soleus still fires throughout.
UPDATE exercises SET primary_muscle = 'gastrocnemius', secondary_muscles = ARRAY['soleus']
  WHERE name IN (
    'Standing Calf Raise',
    'Smith Machine Calf Raise',
    'Donkey Calf Raise',
    'Single Leg Calf Raise',
    'Leg Press Calf Raise',
    'Calf Press Machine'
  )
  AND is_custom IS NOT TRUE;
