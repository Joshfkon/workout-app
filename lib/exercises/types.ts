/**
 * Types for AI-Assisted Custom Exercise Completion
 */

import type {
  MuscleGroup,
  Equipment,
  MovementPattern,
  ExerciseDifficulty,
  FatigueRating,
  HypertrophyTier,
  HypertrophyRating,
} from '@/types/schema';

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
  secondaryMuscles: MuscleGroup[];
  stabilizers: MuscleGroup[];
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
