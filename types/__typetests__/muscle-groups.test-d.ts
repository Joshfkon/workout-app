/**
 * Type tests for muscle group types and mappings in schema.ts
 * These tests verify the two-tier muscle group system and type guards.
 */
import { expectType, expectAssignable, expectNotAssignable } from 'tsd';
import type {
  StandardMuscleGroup,
  DetailedMuscleGroup,
  MuscleGroup,
  Experience,
  VolumeLandmarks,
} from '../schema';
import {
  STANDARD_MUSCLE_GROUPS,
  DETAILED_MUSCLE_GROUPS,
  DETAILED_TO_STANDARD_MAP,
  STANDARD_MUSCLE_DISPLAY_NAMES,
  DETAILED_MUSCLE_DISPLAY_NAMES,
  toStandardMuscle,
  toStandardMuscles,
  getDetailedMusclesFor,
  isDetailedMuscle,
  isStandardMuscle,
  legacyToDetailedMuscle,
  legacyToStandardMuscles,
  DEFAULT_VOLUME_LANDMARKS,
} from '../schema';

// ============================================================================
// StandardMuscleGroup Type Tests (24 groups)
// ============================================================================

// Valid StandardMuscleGroup values
expectAssignable<StandardMuscleGroup>('chest_upper');
expectAssignable<StandardMuscleGroup>('chest_lower');
expectAssignable<StandardMuscleGroup>('front_delts');
expectAssignable<StandardMuscleGroup>('lateral_delts');
expectAssignable<StandardMuscleGroup>('rear_delts');
expectAssignable<StandardMuscleGroup>('lats');
expectAssignable<StandardMuscleGroup>('upper_back');
expectAssignable<StandardMuscleGroup>('traps');
expectAssignable<StandardMuscleGroup>('upper_traps');
expectAssignable<StandardMuscleGroup>('mid_lower_traps');
expectAssignable<StandardMuscleGroup>('gastrocnemius');
expectAssignable<StandardMuscleGroup>('soleus');
expectAssignable<StandardMuscleGroup>('biceps');
expectAssignable<StandardMuscleGroup>('triceps');
expectAssignable<StandardMuscleGroup>('forearms');
expectAssignable<StandardMuscleGroup>('quads');
expectAssignable<StandardMuscleGroup>('hamstrings');
expectAssignable<StandardMuscleGroup>('glutes');
expectAssignable<StandardMuscleGroup>('glute_med');
expectAssignable<StandardMuscleGroup>('adductors');
expectAssignable<StandardMuscleGroup>('calves');
expectAssignable<StandardMuscleGroup>('abs');
expectAssignable<StandardMuscleGroup>('obliques');
expectAssignable<StandardMuscleGroup>('erectors');

// Invalid StandardMuscleGroup values
expectNotAssignable<StandardMuscleGroup>('chest');
expectNotAssignable<StandardMuscleGroup>('back');
expectNotAssignable<StandardMuscleGroup>('shoulders');
expectNotAssignable<StandardMuscleGroup>('arms');
expectNotAssignable<StandardMuscleGroup>('legs');
expectNotAssignable<StandardMuscleGroup>('core');

// Detailed-only muscles should NOT be valid StandardMuscleGroup
expectNotAssignable<StandardMuscleGroup>('chest_mid');
expectNotAssignable<StandardMuscleGroup>('triceps_long');
expectNotAssignable<StandardMuscleGroup>('biceps_long');
expectNotAssignable<StandardMuscleGroup>('rhomboids');

// ============================================================================
// DetailedMuscleGroup Type Tests (33 groups)
// ============================================================================

// Valid DetailedMuscleGroup values - Chest
expectAssignable<DetailedMuscleGroup>('chest_upper');
expectAssignable<DetailedMuscleGroup>('chest_lower');
expectAssignable<DetailedMuscleGroup>('chest_mid');

// Valid DetailedMuscleGroup values - Delts
expectAssignable<DetailedMuscleGroup>('front_delts');
expectAssignable<DetailedMuscleGroup>('lateral_delts');
expectAssignable<DetailedMuscleGroup>('rear_delts');

// Valid DetailedMuscleGroup values - Back
expectAssignable<DetailedMuscleGroup>('lats');
expectAssignable<DetailedMuscleGroup>('upper_back');
expectAssignable<DetailedMuscleGroup>('rhomboids');
expectAssignable<DetailedMuscleGroup>('lower_traps');
expectAssignable<DetailedMuscleGroup>('upper_traps');

// Valid DetailedMuscleGroup values - Spine
expectAssignable<DetailedMuscleGroup>('erectors');

// Valid DetailedMuscleGroup values - Triceps
expectAssignable<DetailedMuscleGroup>('triceps_long');
expectAssignable<DetailedMuscleGroup>('triceps_lateral');
expectAssignable<DetailedMuscleGroup>('triceps_medial');

// Valid DetailedMuscleGroup values - Biceps
expectAssignable<DetailedMuscleGroup>('biceps_long');
expectAssignable<DetailedMuscleGroup>('biceps_short');
expectAssignable<DetailedMuscleGroup>('brachialis');
expectAssignable<DetailedMuscleGroup>('brachioradialis');

// Valid DetailedMuscleGroup values - Forearms
expectAssignable<DetailedMuscleGroup>('forearm_flexors');
expectAssignable<DetailedMuscleGroup>('forearm_extensors');

// Valid DetailedMuscleGroup values - Quads
expectAssignable<DetailedMuscleGroup>('quads_rectus_femoris');
expectAssignable<DetailedMuscleGroup>('quads_vastus');

// Valid DetailedMuscleGroup values - Hamstrings
expectAssignable<DetailedMuscleGroup>('hamstrings_biceps_femoris');
expectAssignable<DetailedMuscleGroup>('hamstrings_semis');

// Valid DetailedMuscleGroup values - Glutes
expectAssignable<DetailedMuscleGroup>('glute_max');
expectAssignable<DetailedMuscleGroup>('glute_med');

// Valid DetailedMuscleGroup values - Hip
expectAssignable<DetailedMuscleGroup>('adductors');
expectAssignable<DetailedMuscleGroup>('abductors');

// Valid DetailedMuscleGroup values - Calves
expectAssignable<DetailedMuscleGroup>('calves_gastrocnemius');
expectAssignable<DetailedMuscleGroup>('calves_soleus');

// Valid DetailedMuscleGroup values - Core
expectAssignable<DetailedMuscleGroup>('abs_rectus');
expectAssignable<DetailedMuscleGroup>('abs_obliques');

// Invalid DetailedMuscleGroup values
expectNotAssignable<DetailedMuscleGroup>('chest');
expectNotAssignable<DetailedMuscleGroup>('back');
expectNotAssignable<DetailedMuscleGroup>('biceps');
expectNotAssignable<DetailedMuscleGroup>('triceps');
expectNotAssignable<DetailedMuscleGroup>('quads');

// ============================================================================
// DETAILED_TO_STANDARD_MAP Tests
// ============================================================================

// Map should return StandardMuscleGroup for all DetailedMuscleGroup keys
const chestUpperMapping = DETAILED_TO_STANDARD_MAP['chest_upper'];
expectType<StandardMuscleGroup>(chestUpperMapping);

const tricepsLongMapping = DETAILED_TO_STANDARD_MAP['triceps_long'];
expectType<StandardMuscleGroup>(tricepsLongMapping);

// ============================================================================
// toStandardMuscle Function Tests
// ============================================================================

// Function should accept DetailedMuscleGroup and return StandardMuscleGroup
const standard1 = toStandardMuscle('chest_mid');
expectType<StandardMuscleGroup>(standard1);

const standard2 = toStandardMuscle('triceps_lateral');
expectType<StandardMuscleGroup>(standard2);

const standard3 = toStandardMuscle('biceps_long');
expectType<StandardMuscleGroup>(standard3);

// ============================================================================
// toStandardMuscles Function Tests
// ============================================================================

// Function should accept DetailedMuscleGroup[] and return StandardMuscleGroup[]
const standards = toStandardMuscles(['chest_mid', 'triceps_long', 'biceps_short']);
expectType<StandardMuscleGroup[]>(standards);

// ============================================================================
// getDetailedMusclesFor Function Tests
// ============================================================================

// Function should accept StandardMuscleGroup and return DetailedMuscleGroup[]
const detailedMuscles = getDetailedMusclesFor('triceps');
expectType<DetailedMuscleGroup[]>(detailedMuscles);

const chestDetailed = getDetailedMusclesFor('chest_upper');
expectType<DetailedMuscleGroup[]>(chestDetailed);

// ============================================================================
// Type Guard Function Tests
// ============================================================================

// isDetailedMuscle should narrow string to DetailedMuscleGroup
function testDetailedGuard(value: string) {
  if (isDetailedMuscle(value)) {
    // Inside this block, value should be narrowed to DetailedMuscleGroup
    expectType<DetailedMuscleGroup>(value);
  }
}

// isStandardMuscle should narrow string to StandardMuscleGroup
function testStandardGuard(value: string) {
  if (isStandardMuscle(value)) {
    // Inside this block, value should be narrowed to StandardMuscleGroup
    expectType<StandardMuscleGroup>(value);
  }
}

// ============================================================================
// Legacy Mapping Function Tests
// ============================================================================

// legacyToDetailedMuscle returns DetailedMuscleGroup | undefined
const legacyDetailed = legacyToDetailedMuscle('chest');
expectType<DetailedMuscleGroup | undefined>(legacyDetailed);

// legacyToStandardMuscles returns StandardMuscleGroup[]
const legacyStandards = legacyToStandardMuscles('chest');
expectType<StandardMuscleGroup[]>(legacyStandards);

// ============================================================================
// Display Names Record Tests
// ============================================================================

// STANDARD_MUSCLE_DISPLAY_NAMES should map all StandardMuscleGroup to string
expectType<Record<StandardMuscleGroup, string>>(STANDARD_MUSCLE_DISPLAY_NAMES);

const chestUpperDisplay: string = STANDARD_MUSCLE_DISPLAY_NAMES['chest_upper'];
expectType<string>(chestUpperDisplay);

// DETAILED_MUSCLE_DISPLAY_NAMES should map all DetailedMuscleGroup to string
expectType<Record<DetailedMuscleGroup, string>>(DETAILED_MUSCLE_DISPLAY_NAMES);

const tricepsLongDisplay: string = DETAILED_MUSCLE_DISPLAY_NAMES['triceps_long'];
expectType<string>(tricepsLongDisplay);

// ============================================================================
// DEFAULT_VOLUME_LANDMARKS Record Tests
// ============================================================================

// Should be Record<Experience, Record<StandardMuscleGroup, VolumeLandmarks>>
expectType<Record<Experience, Record<StandardMuscleGroup, VolumeLandmarks>>>(DEFAULT_VOLUME_LANDMARKS);

// Accessing by experience level should return Record<StandardMuscleGroup, VolumeLandmarks>
const noviceLandmarks = DEFAULT_VOLUME_LANDMARKS['novice'];
expectType<Record<StandardMuscleGroup, VolumeLandmarks>>(noviceLandmarks);

const intermediateLandmarks = DEFAULT_VOLUME_LANDMARKS['intermediate'];
expectType<Record<StandardMuscleGroup, VolumeLandmarks>>(intermediateLandmarks);

const advancedLandmarks = DEFAULT_VOLUME_LANDMARKS['advanced'];
expectType<Record<StandardMuscleGroup, VolumeLandmarks>>(advancedLandmarks);

// Accessing by muscle group should return VolumeLandmarks
const chestLandmarks = DEFAULT_VOLUME_LANDMARKS['novice']['chest_upper'];
expectType<VolumeLandmarks>(chestLandmarks);

const quadsLandmarks = DEFAULT_VOLUME_LANDMARKS['advanced']['quads'];
expectType<VolumeLandmarks>(quadsLandmarks);

// ============================================================================
// STANDARD_MUSCLE_GROUPS Const Array Tests
// ============================================================================

// Array should be readonly
expectType<readonly [
  'chest_upper', 'chest_lower', 'front_delts', 'lateral_delts', 'rear_delts',
  'lats', 'upper_back', 'traps', 'upper_traps', 'mid_lower_traps',
  'biceps', 'triceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'glute_med', 'adductors',
  'calves', 'gastrocnemius', 'soleus',
  'abs', 'obliques', 'erectors'
]>(STANDARD_MUSCLE_GROUPS);

// ============================================================================
// Deprecated MuscleGroup Type Tests
// ============================================================================

// MuscleGroup should still work (backwards compatibility)
// Note: MuscleGroup uses legacy names like 'chest', 'back', 'shoulders'
// instead of detailed names like 'chest_upper', 'lats'
expectAssignable<MuscleGroup>('chest');
expectAssignable<MuscleGroup>('back');
expectAssignable<MuscleGroup>('shoulders');
expectAssignable<MuscleGroup>('biceps');
expectAssignable<MuscleGroup>('triceps');

// Invalid MuscleGroup values
expectNotAssignable<MuscleGroup>('arms'); // Use 'biceps' or 'triceps' instead
expectNotAssignable<MuscleGroup>('legs'); // Use specific muscle groups instead

// But it's different from StandardMuscleGroup
expectNotAssignable<StandardMuscleGroup>('chest' as MuscleGroup);
