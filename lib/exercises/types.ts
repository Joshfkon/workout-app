/**
 * Types for AI-Assisted Custom Exercise Completion
 *
 * Uses the two-tier muscle group system:
 * - User input: Legacy MuscleGroup (13 muscles) for simplicity
 * - AI output: DetailedMuscleGroup (33 muscles) for precision
 * - Volume tracking: StandardMuscleGroup (20 muscles) for display
 */

import type {
  MuscleGroup,
  Equipment,
  MovementPattern,
  ExerciseDifficulty,
  FatigueRating,
  HypertrophyTier,
  HypertrophyRating,
  StandardMuscleGroup,
  DetailedMuscleGroup,
} from '@/types/schema';

import { STANDARD_MUSCLE_GROUPS, STANDARD_MUSCLE_DISPLAY_NAMES } from '@/types/schema';
import type { SpinalLoading, PositionStress } from '@/services/exerciseService';

// ============================================
// BASIC INPUT (Phase 1 - User Provides)
// ============================================

export interface BasicExerciseInput {
  /** Exercise name (required) */
  name: string;
  /** Primary muscle targeted (required) */
  primaryMuscle: MuscleGroup;
  /** Equipment used (required) */
  equipment: Equipment;
  /** Optional description to help AI understand the movement */
  description?: string;
  /** Exercise ID if this is a variation of an existing exercise */
  variationOf?: string;
  /** Name of the base exercise if this is a variation */
  variationOfName?: string;
  
  // === Optional Detailed Fields ===
  
  /** Secondary muscles worked */
  secondaryMuscles?: MuscleGroup[];
  /** Movement pattern */
  pattern?: MovementPattern | 'isolation' | 'carry';
  /** Exercise mechanic type */
  mechanic?: 'compound' | 'isolation';
  /** Difficulty level */
  difficulty?: ExerciseDifficulty;
  /** Fatigue rating (1-3) */
  fatigueRating?: FatigueRating;
  
  /** Default rep range [min, max] */
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
  /** Muscles used for stability */
  stabilizers?: MuscleGroup[];
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
  primaryMuscle: MuscleGroup;
  equipment: Equipment;
  description?: string;
  variationOf?: string;

  // === AI Completed ===
  /** AI's detailed classification of the primary muscle */
  primaryMuscleDetailed: DetailedMuscleGroup;
  /** Secondary muscles targeted (detailed 33-muscle system) */
  secondaryMuscles: DetailedMuscleGroup[];
  /** Stabilizer muscles (detailed 33-muscle system) */
  stabilizers: DetailedMuscleGroup[];
  pattern: MovementPattern | 'isolation' | 'carry';
  mechanic: 'compound' | 'isolation';
  difficulty: ExerciseDifficulty;
  fatigueRating: FatigueRating;
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
  'Back': ['lats', 'upper_back', 'traps'],
  'Arms': ['biceps', 'triceps', 'forearms'],
  'Legs': ['quads', 'hamstrings', 'glutes', 'glute_med', 'adductors', 'calves'],
  'Core & Spine': ['abs', 'obliques', 'erectors'],
};
