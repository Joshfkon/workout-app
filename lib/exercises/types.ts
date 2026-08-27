/**
 * Types for AI-Assisted Custom Exercise Completion
 *
 * Uses the two-tier muscle group system:
 * - User input: Legacy MuscleGroup (13 muscles) for simplicity
 * - AI output: DetailedMuscleGroup (33 muscles) for precision
 * - Volume tracking: StandardMuscleGroup for display
 */

import type {
  MuscleGroup,
  Equipment,
  ExerciseType,
  MovementPattern,
  ExerciseDifficulty,
  FatigueRating,
  HypertrophyTier,
  HypertrophyRating,
  StandardMuscleGroup,
  DetailedMuscleGroup,
} from '@/types/schema';

import { STANDARD_MUSCLE_GROUPS, STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import { isGroupSplitPrimary } from '@/services/muscleAttributionAudit';
import type { SpinalLoading, PositionStress } from '@/services/exerciseService';

// ============================================
// BASIC INPUT (Phase 1 - User Provides)
// ============================================

export interface BasicExerciseInput {
  /** Exercise name (required) */
  name: string;
  /** Primary muscle targeted (required) - can be MuscleGroup or DetailedMuscleGroup */
  primaryMuscle: string;
  /** Equipment used (required) */
  equipment: Equipment;
  /** Optional description to help AI understand the movement */
  description?: string;
  /** Exercise ID if this is a variation of an existing exercise */
  variationOf?: string;
  /** Name of the base exercise if this is a variation */
  variationOfName?: string;
  /**
   * Per-gym-location availability chosen at creation time.
   * Only set when the user has multiple gym locations; omitted means
   * available everywhere (no exercise_location_availability rows written).
   */
  locationAvailability?: Array<{ locationId: string; isAvailable: boolean }>;

  // === Optional Detailed Fields ===

  /** Secondary muscles worked (can be MuscleGroup[] or DetailedMuscleGroup[]) */
  secondaryMuscles?: string[];
  /** Movement pattern */
  pattern?: MovementPattern | 'isolation' | 'carry';
  /** Exercise mechanic type */
  mechanic?: 'compound' | 'isolation';
  /** Difficulty level */
  difficulty?: ExerciseDifficulty;
  /** Fatigue rating (1-3) */
  fatigueRating?: FatigueRating;

  /**
   * Modality: rep_based (default) or duration_based. For duration exercises
   * defaultRepRange holds a seconds range and logged sets store seconds in
   * the reps field.
   */
  exerciseType?: ExerciseType;

  /** Default rep range [min, max] — seconds for duration_based exercises */
  defaultRepRange?: [number, number];
  /** Default RIR target */
  defaultRir?: number;
  /** Minimum weight increment in kg */
  minWeightIncrementKg?: number;

  /** Form cues for proper execution */
  formCues?: string[];
  /** Common mistakes to avoid */
  commonMistakes?: string[];
  /** Setup instructions or notes */
  setupNote?: string;

  /** Spinal loading level */
  spinalLoading?: SpinalLoading;
  /** Muscles used for stability (can be MuscleGroup[] or DetailedMuscleGroup[]) */
  stabilizers?: string[];
  /** Requires back arch */
  requiresBackArch?: boolean;
  /** Requires spinal flexion */
  requiresSpinalFlexion?: boolean;
  /** Requires spinal extension */
  requiresSpinalExtension?: boolean;
  /** Requires spinal rotation */
  requiresSpinalRotation?: boolean;
  /** Position stress areas */
  positionStress?: PositionStress;
  /** Injury contraindications */
  contraindications?: string[];
  
  /** Hypertrophy tier */
  hypertrophyTier?: HypertrophyTier;
  /** Stretch under load rating (1-5) */
  stretchUnderLoad?: HypertrophyRating;
  /** Resistance profile rating (1-5) */
  resistanceProfile?: HypertrophyRating;
  /** Progression ease rating (1-5) */
  progressionEase?: HypertrophyRating;
}

// ============================================
// AI COMPLETION OUTPUT (Phase 2 - AI Fills In)
// ============================================

export interface HypertrophyScoreData {
  tier: HypertrophyTier;
  stretchUnderLoad: HypertrophyRating;
  resistanceProfile: HypertrophyRating;
  progressionEase: HypertrophyRating;
}

export interface CompletedExerciseData {
  // === User Provided ===
  name: string;
  primaryMuscle: string; // Can be MuscleGroup or DetailedMuscleGroup
  equipment: Equipment;
  description?: string;
  variationOf?: string;

  // === AI Completed ===
  /** AI's detailed classification of the primary muscle */
  primaryMuscleDetailed: DetailedMuscleGroup;
  /** Secondary muscles targeted (can be MuscleGroup or DetailedMuscleGroup) */
  secondaryMuscles: string[];
  /** Stabilizer muscles (can be MuscleGroup or DetailedMuscleGroup) */
  stabilizers: string[];
  pattern: MovementPattern | 'isolation' | 'carry';
  mechanic: 'compound' | 'isolation';
  difficulty: ExerciseDifficulty;
  fatigueRating: FatigueRating;
  /** Modality: rep_based (default) or duration_based (defaultRepRange = seconds) */
  exerciseType: ExerciseType;
  defaultRepRange: [number, number];
  defaultRir: number;
  minWeightIncrementKg: number;

  // Spinal/safety metadata
  spinalLoading: SpinalLoading;
  requiresBackArch: boolean;
  requiresSpinalFlexion: boolean;
  requiresSpinalExtension: boolean;
  requiresSpinalRotation: boolean;
  positionStress: PositionStress;
  contraindications: string[];

  // Hypertrophy scoring
  hypertrophyScore: HypertrophyScoreData;

  // Form guidance
  formCues: string[];
  commonMistakes?: string[];
  setupNote?: string;

  // === Metadata ===
  aiConfidence: AIConfidence;
  aiNotes?: string;
  /**
   * Where this completion actually came from. 'ai' = the model reviewed the
   * exercise; 'fallback' = equipment-based defaults stood in (no API key, AI
   * error, unparseable response, or usage limit). The review form surfaces
   * 'fallback' explicitly — muscle review is mandatory, so defaults must
   * never masquerade as an AI verdict. Absent on legacy payloads = unknown.
   */
  aiSource?: 'ai' | 'fallback';
}

// ============================================
// CONFIDENCE & VALIDATION
// ============================================

export type AIConfidence = 'high' | 'medium' | 'low';

export interface ConfidenceDisplay {
  level: AIConfidence;
  color: string;
  bgColor: string;
  message: string;
}

export const CONFIDENCE_DISPLAY: Record<AIConfidence, ConfidenceDisplay> = {
  high: {
    level: 'high',
    color: 'text-success-400',
    bgColor: 'bg-success-900/30',
    message: 'AI is confident in this analysis',
  },
  medium: {
    level: 'medium',
    color: 'text-warning-400',
    bgColor: 'bg-warning-900/30',
    message: 'Review recommended - some assumptions made',
  },
  low: {
    level: 'low',
    color: 'text-danger-400',
    bgColor: 'bg-danger-900/30',
    message: 'Please review carefully - unusual exercise',
  },
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================
// USAGE TRACKING
// ============================================

export interface AIUsageRecord {
  userId: string;
  usageToday: number;
  usageThisMonth: number;
  lastUsedAt: string;
}

export interface AIUsageLimits {
  exerciseCompletionsPerDay: number;
  exerciseCompletionsPerMonth: number;
}

export const DEFAULT_AI_USAGE_LIMITS: AIUsageLimits = {
  exerciseCompletionsPerDay: 10,
  exerciseCompletionsPerMonth: 50,
};

// ============================================
// EQUIPMENT-BASED DEFAULTS (Fallback)
// ============================================

export interface EquipmentDefaults {
  spinalLoading: SpinalLoading;
  difficulty: ExerciseDifficulty;
  fatigueRating: FatigueRating;
  hypertrophyScore: HypertrophyScoreData;
  defaultRepRange: [number, number];
  minWeightIncrementKg: number;
}

export const EQUIPMENT_DEFAULTS: Record<Equipment, EquipmentDefaults> = {
  machine: {
    spinalLoading: 'none',
    difficulty: 'beginner',
    fatigueRating: 1,
    hypertrophyScore: {
      tier: 'B',
      stretchUnderLoad: 3,
      resistanceProfile: 4,
      progressionEase: 5,
    },
    defaultRepRange: [10, 15],
    minWeightIncrementKg: 5,
  },
  cable: {
    spinalLoading: 'low',
    difficulty: 'beginner',
    fatigueRating: 1,
    hypertrophyScore: {
      tier: 'A',
      stretchUnderLoad: 4,
      resistanceProfile: 5,
      progressionEase: 4,
    },
    defaultRepRange: [10, 15],
    minWeightIncrementKg: 2.5,
  },
  barbell: {
    spinalLoading: 'moderate',
    difficulty: 'intermediate',
    fatigueRating: 2,
    hypertrophyScore: {
      tier: 'B',
      stretchUnderLoad: 3,
      resistanceProfile: 3,
      progressionEase: 4,
    },
    defaultRepRange: [6, 10],
    minWeightIncrementKg: 2.5,
  },
  dumbbell: {
    spinalLoading: 'low',
    difficulty: 'intermediate',
    fatigueRating: 2,
    hypertrophyScore: {
      tier: 'A',
      stretchUnderLoad: 4,
      resistanceProfile: 3,
      progressionEase: 3,
    },
    defaultRepRange: [8, 12],
    minWeightIncrementKg: 2,
  },
  bodyweight: {
    spinalLoading: 'low',
    difficulty: 'beginner',
    fatigueRating: 1,
    hypertrophyScore: {
      tier: 'B',
      stretchUnderLoad: 3,
      resistanceProfile: 2,
      progressionEase: 2,
    },
    defaultRepRange: [8, 15],
    minWeightIncrementKg: 0,
  },
  kettlebell: {
    spinalLoading: 'moderate',
    difficulty: 'intermediate',
    fatigueRating: 2,
    hypertrophyScore: {
      tier: 'B',
      stretchUnderLoad: 3,
      resistanceProfile: 3,
      progressionEase: 3,
    },
    defaultRepRange: [8, 12],
    minWeightIncrementKg: 4,
  },
};

// ============================================
// MUSCLE GROUP OPTIONS
// ============================================

export const MUSCLE_GROUP_OPTIONS: { value: MuscleGroup; label: string }[] = [
  { value: 'chest', label: 'Chest' },
  { value: 'back', label: 'Back' },
  { value: 'shoulders', label: 'Shoulders' },
  { value: 'biceps', label: 'Biceps' },
  { value: 'triceps', label: 'Triceps' },
  { value: 'quads', label: 'Quads' },
  { value: 'hamstrings', label: 'Hamstrings' },
  { value: 'glutes', label: 'Glutes' },
  { value: 'calves', label: 'Calves' },
  { value: 'abs', label: 'Abs' },
  { value: 'adductors', label: 'Adductors' },
  { value: 'forearms', label: 'Forearms' },
  { value: 'traps', label: 'Traps' },
];

// ============================================
// PRECISE (STANDARD-MUSCLE) TAGGING OPTIONS
// ============================================
//
// Custom-exercise tagging was coarse-only, which is how user exercises like
// "Lateral Raise (Machine)" ended up primary 'shoulders' — a tag the volume
// counter SPLITS evenly across all three delt heads (⅓ credit each), leaking
// side-delt work onto the front/rear delt rows. The creation flow now offers
// the fine standard muscles too (mirroring the in-workout edit form's
// taxonomy); coarse remains selectable as an explicit "whole group" fallback
// that surfaces the split-credit warning below.

/** One selectable muscle group with its fine (standard-taxonomy) heads. */
export interface GroupedMuscleOption {
  /** Coarse token stored when the whole group is selected. */
  value: string;
  label: string;
  /** Fine standard tokens; empty for groups with no meaningful subdivision. */
  subMuscles: { value: StandardMuscleGroup; label: string }[];
}

const fine = (value: StandardMuscleGroup): { value: StandardMuscleGroup; label: string } => ({
  value,
  label: STANDARD_MUSCLE_DISPLAY_NAMES[value],
});

/** The creation-flow taxonomy — same shape/content as the workout edit form's
 *  (components/workout/exercise-details/editFormOptions.ts). */
export const GROUPED_MUSCLE_OPTIONS: GroupedMuscleOption[] = [
  { value: 'chest', label: 'Chest', subMuscles: [fine('chest_upper'), fine('chest_lower')] },
  { value: 'back', label: 'Back', subMuscles: [fine('lats'), fine('upper_back')] },
  { value: 'shoulders', label: 'Shoulders', subMuscles: [fine('front_delts'), fine('lateral_delts'), fine('rear_delts')] },
  { value: 'biceps', label: 'Biceps', subMuscles: [] },
  { value: 'triceps', label: 'Triceps', subMuscles: [fine('triceps_long'), fine('triceps_lat_med')] },
  { value: 'forearms', label: 'Forearms', subMuscles: [] },
  { value: 'traps', label: 'Traps', subMuscles: [fine('upper_traps'), fine('mid_lower_traps')] },
  { value: 'quads', label: 'Quads', subMuscles: [] },
  { value: 'hamstrings', label: 'Hamstrings', subMuscles: [] },
  { value: 'glutes', label: 'Glutes', subMuscles: [fine('glute_med')] },
  { value: 'adductors', label: 'Adductors', subMuscles: [] },
  { value: 'calves', label: 'Calves', subMuscles: [fine('gastrocnemius'), fine('soleus')] },
  { value: 'abs', label: 'Abs', subMuscles: [fine('obliques')] },
  // Top-level group, not a back subdivision — hinge/squat work is what loads it.
  { value: 'erectors', label: 'Erectors', subMuscles: [] },
];

/**
 * Flat option list for plain <Select> primary-muscle pickers: each group
 * followed by its fine heads ("Shoulders · Side Delts"). Coarse entries with
 * subdivisions are labeled "(whole group)" so choosing them is a deliberate
 * act, not the default reading.
 */
export const PRECISE_MUSCLE_GROUP_OPTIONS: { value: string; label: string }[] =
  GROUPED_MUSCLE_OPTIONS.flatMap((group) => [
    // A whole-group PRIMARY is only offered when the coarse token does not
    // split its credit ('glutes', 'traps', …). Splitting groups
    // (chest/back/shoulders) require a head: createCustomExercise rejects a
    // splitting primary (validateExercisePrimary), so advertising one here
    // only sets up a failed save at the end of the flow.
    ...(isGroupSplitPrimary(group.value)
      ? []
      : [
          {
            value: group.value,
            label: group.subMuscles.length > 0 ? `${group.label} (whole group)` : group.label,
          },
        ]),
    ...group.subMuscles.map((s) => ({ value: s.value, label: `${group.label} · ${s.label}` })),
  ]);

/**
 * Every taggable token — each coarse group followed by its fine heads — for
 * SECONDARY-muscle pickers and muscle filters. Unlike
 * PRECISE_MUSCLE_GROUP_OPTIONS this keeps the splitting coarse groups
 * (chest/back/shoulders): the primary-only rule that rejects them
 * (validateExercisePrimary) does not apply to secondaries, where an
 * even split across a group's heads is a fair description of the work.
 *
 * These lists are the reason a subdivision is taggable at all. Volume rows for
 * Obliques, Glute Med and the trap/tricep heads render whether or not anything
 * feeds them, but only a fine tag applied here can put sets on one — a coarse
 * 'abs' tag never leaks into Obliques (see resolveMuscleToStandard).
 */
export const ALL_MUSCLE_TAG_OPTIONS: { value: string; label: string }[] =
  GROUPED_MUSCLE_OPTIONS.flatMap((group) => [
    {
      value: group.value,
      label: group.subMuscles.length > 0 ? `${group.label} (whole group)` : group.label,
    },
    ...group.subMuscles.map((s) => ({ value: s.value, label: `${group.label} · ${s.label}` })),
  ]);

/**
 * Same coverage as ALL_MUSCLE_TAG_OPTIONS with bare labels ("Obliques", not
 * "Abs · Obliques") — for muscle FILTER chips, where the group already matches
 * its subdivisions and a fine chip is simply a narrower query.
 */
export const MUSCLE_FILTER_OPTIONS: { value: string; label: string }[] =
  GROUPED_MUSCLE_OPTIONS.flatMap((group) => [
    { value: group.value, label: group.label },
    ...group.subMuscles.map((s) => ({ value: s.value, label: s.label })),
  ]);

/**
 * Warning copy when a SPLITTING coarse token is selected (a group with
 * subdivisions): volume credit will be divided evenly across the listed heads.
 * Returns null for precise tokens and for coarse groups with no subdivisions.
 */
export function coarseSplitWarning(muscle: string): string | null {
  const group = GROUPED_MUSCLE_OPTIONS.find((g) => g.value === muscle.toLowerCase().trim());
  if (!group || group.subMuscles.length === 0) return null;
  const heads = group.subMuscles.map((s) => s.label).join(' / ');
  return `Whole-group tag: volume credit is split evenly across ${heads}. Pick a specific muscle if this exercise targets one.`;
}

export const EQUIPMENT_OPTIONS: { value: Equipment; label: string }[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'cable', label: 'Cable' },
  { value: 'machine', label: 'Machine' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'kettlebell', label: 'Kettlebell' },
];

// ============================================
// STANDARD MUSCLE GROUP OPTIONS (for volume UI)
// ============================================

/**
 * Standard muscle group options for volume tracking UI
 * Uses the new 20-muscle system for granular volume display
 */
export const STANDARD_MUSCLE_GROUP_OPTIONS: { value: StandardMuscleGroup; label: string }[] =
  STANDARD_MUSCLE_GROUPS.map((muscle) => ({
    value: muscle,
    label: STANDARD_MUSCLE_DISPLAY_NAMES[muscle],
  }));

/**
 * Standard muscle groups organized by body region for UI display
 */
export const STANDARD_MUSCLE_GROUPS_BY_REGION: Record<string, StandardMuscleGroup[]> = {
  'Chest': ['chest_upper', 'chest_lower'],
  'Shoulders': ['front_delts', 'lateral_delts', 'rear_delts'],
  'Back': ['lats', 'upper_back', 'traps', 'upper_traps', 'mid_lower_traps'],
  'Arms': ['biceps', 'triceps', 'forearms'],
  'Legs': ['quads', 'hamstrings', 'glutes', 'glute_med', 'adductors', 'calves', 'gastrocnemius', 'soleus'],
  'Core & Spine': ['abs', 'obliques', 'erectors'],
};
