// ============================================================
// SMART WARMUP DETECTION FOR ISOLATION EXERCISES
// Suggests warmup compounds when starting with isolation exercises
// ============================================================

import type { MuscleGroup, Exercise, WarmupSet } from '@/types/schema';

// ============================================================
// WARMUP COMPOUND SUGGESTIONS BY MUSCLE GROUP
// Maps isolation exercise muscle groups to appropriate compound warmup exercises
// ============================================================

/**
 * Suggested compound exercises for warming up before isolation work
 * Key: Primary muscle group of the isolation exercise
 * Value: Array of compound exercise IDs that would effectively warm up that area
 */
export const warmupCompoundSuggestions: Record<MuscleGroup, string[]> = {
  shoulders: ['machine-shoulder-press', 'smith-ohp', 'seated-dumbbell-shoulder-press'],
  biceps: ['lat-pulldown', 'cable-row', 'chin-up'],
  triceps: ['machine-chest-press', 'close-grip-bench', 'dip'],
  chest: ['machine-chest-press', 'push-up', 'dumbbell-bench-press'],
  back: ['lat-pulldown', 'cable-row', 'dumbbell-row'],
  quads: ['leg-press', 'goblet-squat', 'hack-squat'],
  hamstrings: ['leg-press', 'db-rdl', 'romanian-deadlift'],
  glutes: ['leg-press', 'hip-thrust', 'goblet-squat'],
  calves: ['leg-press'],
  abs: [], // Abs don't require a compound warmup
  adductors: ['leg-press', 'goblet-squat'],
  traps: ['cable-row', 'lat-pulldown', 'dumbbell-row'],
  forearms: ['cable-row', 'dumbbell-row'],
};

// ============================================================
// WARMUP PREFERENCES INTERFACE
// ============================================================

export interface WarmupPreferences {
  /** User can toggle in settings to disable warmup prompts entirely */
  skipWarmupPrompt: boolean;
  /** Auto-increments when user dismisses, resets if user re-enables */
  warmupDismissCount: number;
  /** Remember user's last choice for auto-selection */
  preferredWarmupMethod: 'compound' | 'light_sets' | 'general' | 'none' | null;
}

export const DEFAULT_WARMUP_PREFERENCES: WarmupPreferences = {
  skipWarmupPrompt: false,
  warmupDismissCount: 0,
  preferredWarmupMethod: null,
};

// ============================================================
// WARMUP PROMPT RESULT INTERFACE
// ============================================================

export interface WarmupPromptResult {
  /** Whether to show the warmup prompt modal */
  shouldPrompt: boolean;
  /** The isolation exercise that triggered the prompt */
  exercise: Exercise | null;
  /** The primary muscle group of the isolation exercise */
  primaryMuscle: MuscleGroup | null;
  /** Suggested compound exercises for warmup */
  suggestedCompounds: string[];
  /** Reason for not prompting (if shouldPrompt is false) */
  skipReason?: 'compound_exercise' | 'user_disabled' | 'too_many_dismissals' | 'abs_exercise';
}

// ============================================================
// DETECTION FUNCTION
// ============================================================

/**
 * Checks if the user should be prompted for warmup options
 * when starting a workout with an isolation exercise
 *
 * @param firstExercise - The first exercise in the workout
 * @param userPreferences - User's warmup preferences
 * @returns WarmupPromptResult indicating whether to prompt and with what options
 */
export function checkNeedsWarmupPrompt(
  firstExercise: Exercise,
  userPreferences: { skipWarmupPrompt?: boolean; warmupDismissCount?: number }
): WarmupPromptResult {
  // Check if it's a compound exercise - no prompt needed
  if (firstExercise.mechanic === 'compound') {
    return {
      shouldPrompt: false,
      exercise: null,
      primaryMuscle: null,
      suggestedCompounds: [],
      skipReason: 'compound_exercise',
    };
  }

  // Check if user has disabled warmup prompts
  if (userPreferences.skipWarmupPrompt === true) {
    return {
      shouldPrompt: false,
      exercise: null,
      primaryMuscle: null,
      suggestedCompounds: [],
      skipReason: 'user_disabled',
    };
  }

  // Check if user has dismissed too many times (5+ dismissals stops prompts)
  if ((userPreferences.warmupDismissCount ?? 0) >= 5) {
    return {
      shouldPrompt: false,
      exercise: null,
      primaryMuscle: null,
      suggestedCompounds: [],
      skipReason: 'too_many_dismissals',
    };
  }

  // Get the primary muscle group
  const primaryMuscle = firstExercise.primaryMuscle as MuscleGroup;

  // Abs don't require warmup prompt
  if (primaryMuscle === 'abs') {
    return {
      shouldPrompt: false,
      exercise: null,
      primaryMuscle: null,
      suggestedCompounds: [],
      skipReason: 'abs_exercise',
    };
  }

  // Get suggested compounds for this muscle group
  const suggestedCompounds = warmupCompoundSuggestions[primaryMuscle] || [];

  return {
    shouldPrompt: true,
    exercise: firstExercise,
    primaryMuscle,
    suggestedCompounds,
  };
}

// ============================================================
// LIGHT WARMUP SET GENERATOR
// ============================================================

export interface IsolationWarmupSet {
  /** Set number (1-indexed) */
  setNumber: number;
  /** Target reps for this warmup set */
  targetReps: number;
  /** Multiplier to apply to working weight (e.g., 0.3 for 30%) */
  weightMultiplier: number;
  /** Flag indicating this is a warmup set */
  isWarmup: true;
  /** Purpose description for the set */
  purpose: string;
  /** Rest seconds after this set */
  restSeconds: number;
}

/**
 * Generates light warmup sets for an isolation exercise
 * Used when user chooses "Add light warmup sets" option
 *
 * @param workingWeight - The target working weight in kg
 * @returns Array of warmup sets
 */
export function generateIsolationWarmupSets(workingWeight: number): IsolationWarmupSet[] {
  return [
    {
      setNumber: 1,
      targetReps: 15,
      weightMultiplier: 0.3,
      isWarmup: true,
      purpose: 'Light activation - increase blood flow',
      restSeconds: 30,
    },
    {
      setNumber: 2,
      targetReps: 10,
      weightMultiplier: 0.5,
      isWarmup: true,
      purpose: 'Movement groove practice',
      restSeconds: 45,
    },
  ];
}

/**
 * Converts isolation warmup sets to the standard WarmupSet format
 * used by the WarmupProtocol component
 *
 * @param isolationSets - The generated isolation warmup sets
 * @returns Array of standard WarmupSet objects
 */
export function convertToStandardWarmupSets(isolationSets: IsolationWarmupSet[]): WarmupSet[] {
  return isolationSets.map((set) => ({
    setNumber: set.setNumber,
    percentOfWorking: Math.round(set.weightMultiplier * 100),
    targetReps: set.targetReps,
    purpose: set.purpose,
    restSeconds: set.restSeconds,
  }));
}

// ============================================================
// GENERAL WARMUP CHECKLIST
// ============================================================

export interface GeneralWarmupItem {
  id: string;
  label: string;
  duration?: string;
  description?: string;
}

/**
 * General warmup checklist items for when user chooses
 * "General warmup only" option
 */
export const generalWarmupChecklist: GeneralWarmupItem[] = [
  {
    id: 'cardio',
    label: '5 min cardio',
    duration: '5 min',
    description: 'Light jog, bike, or elliptical to raise heart rate',
  },
  {
    id: 'arm-circles',
    label: 'Arm circles',
    duration: '30 sec each direction',
    description: 'Forward and backward to loosen shoulders',
  },
  {
    id: 'dynamic-stretches',
    label: 'Dynamic stretches',
    duration: '2-3 min',
    description: 'Leg swings, torso twists, hip circles',
  },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Gets the display name for a warmup method
 */
export function getWarmupMethodLabel(method: WarmupPreferences['preferredWarmupMethod']): string {
  switch (method) {
    case 'compound':
      return 'Add warmup compound';
    case 'light_sets':
      return 'Add light warmup sets';
    case 'general':
      return 'General warmup only';
    case 'none':
      return "I'm already warm";
    default:
      return 'Choose warmup method';
  }
}
