/**
 * Mesocycle Helpers
 * Utilities for extracting and working with mesocycle program data.
 */

import type {
  MuscleGroup,
  FullProgramRecommendation,
  DetailedSessionWithFatigue,
  DetailedSession,
  DetailedExerciseWithFatigue,
  DetailedExercise,
} from '@/types/schema';
import { now as clockNow } from '@/lib/clock';

/**
 * Normalized exercise data extracted from program_data
 */
export interface ExtractedExercise {
  exerciseId?: string;
  exerciseName: string;
  primaryMuscle: MuscleGroup;
  /**
   * Secondary-muscle tags from the program's exercise entry. Carried so the
   * weekly rollover can count credited (0.5-secondary) volume the same way
   * the tracking surfaces do; [] for entries without tags.
   */
  secondaryMuscles?: string[];
  sets: number;
  repRange: { min: number; max: number };
  targetRir: number;
  restSeconds: number;
  notes?: string;
  loadGuidance?: string;
}

/**
 * Normalized session data extracted from program_data
 */
export interface ExtractedSession {
  dayName: string;
  focus: string;
  muscles: MuscleGroup[];
  exercises: ExtractedExercise[];
  estimatedMinutes: number;
  totalSets: number;
  warmup: string[];
  weekNumber?: number;
  isDeload?: boolean;
}

/**
 * Parse a rep range string like "8-12" into { min, max }
 */
function parseRepRange(range: string | { min: number; max: number }): { min: number; max: number } {
  if (typeof range === 'object' && 'min' in range && 'max' in range) {
    return range;
  }
  if (typeof range === 'string') {
    const parts = range.split('-').map(Number);
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { min: parts[0], max: parts[1] };
    }
    // Single number like "10"
    const single = parseInt(range, 10);
    if (!isNaN(single)) {
      return { min: single, max: single };
    }
  }
  // Default fallback
  return { min: 8, max: 12 };
}

/**
 * Extract muscles from a session's exercises
 */
function extractMusclesFromExercises(
  exercises: Array<{ exercise: { primaryMuscle: string; secondaryMuscles?: string[] } }>
): MuscleGroup[] {
  const muscles = new Set<MuscleGroup>();
  for (const ex of exercises) {
    if (ex.exercise.primaryMuscle) {
      muscles.add(ex.exercise.primaryMuscle as MuscleGroup);
    }
    if ('secondaryMuscles' in ex.exercise && Array.isArray(ex.exercise.secondaryMuscles)) {
      for (const m of ex.exercise.secondaryMuscles) {
        muscles.add(m as MuscleGroup);
      }
    }
  }
  return Array.from(muscles);
}

/**
 * Convert DetailedExerciseWithFatigue to ExtractedExercise
 */
function convertFatigueExercise(ex: DetailedExerciseWithFatigue): ExtractedExercise {
  return {
    exerciseId: ex.exercise.id, // Now available in ExerciseEntry
    exerciseName: ex.exercise.name,
    primaryMuscle: ex.exercise.primaryMuscle as MuscleGroup,
    secondaryMuscles: ex.exercise.secondaryMuscles ?? [],
    sets: ex.sets,
    repRange: {
      min: ex.reps.min,
      max: ex.reps.max,
    },
    targetRir: ex.reps.targetRIR,
    restSeconds: ex.restSeconds,
    notes: ex.notes || undefined,
    loadGuidance: ex.loadGuidance,
  };
}

/**
 * Convert DetailedExercise (legacy format) to ExtractedExercise
 */
function convertLegacyExercise(ex: DetailedExercise): ExtractedExercise {
  return {
    exerciseId: ex.exercise.id, // Now available in ExerciseEntry
    exerciseName: ex.exercise.name,
    primaryMuscle: ex.exercise.primaryMuscle as MuscleGroup,
    secondaryMuscles: ex.exercise.secondaryMuscles ?? [],
    sets: ex.sets,
    repRange: parseRepRange(ex.repRange),
    targetRir: 2, // Default RIR for legacy format
    restSeconds: ex.restSeconds,
    notes: ex.notes || undefined,
  };
}

/**
 * Convert DetailedSessionWithFatigue to ExtractedSession
 */
function convertFatigueSession(
  session: DetailedSessionWithFatigue,
  weekNumber?: number,
  isDeload?: boolean
): ExtractedSession {
  const exercises = session.exercises.map(convertFatigueExercise);
  return {
    dayName: session.day,
    focus: session.focus,
    muscles: extractMusclesFromExercises(session.exercises),
    exercises,
    estimatedMinutes: session.estimatedMinutes,
    totalSets: session.totalSets,
    warmup: session.warmup,
    weekNumber,
    isDeload,
  };
}

/**
 * Convert DetailedSession (legacy format) to ExtractedSession
 */
function convertLegacySession(session: DetailedSession): ExtractedSession {
  const exercises = session.exercises.map(convertLegacyExercise);
  return {
    dayName: session.day,
    focus: session.focus,
    muscles: extractMusclesFromExercises(session.exercises),
    exercises,
    estimatedMinutes: session.estimatedMinutes,
    totalSets: session.totalSets,
    warmup: session.warmup,
  };
}

/**
 * Extract the appropriate session from program_data based on day index and week.
 *
 * Handles both formats:
 * - mesocycleWeeks: Array of weeks, each with sessions (preferred, has week-specific progressions)
 * - sessions: Direct array of sessions (legacy format)
 *
 * @param programData - The FullProgramRecommendation stored in mesocycle.program_data
 * @param dayIndex - 0-based index of the training day within the week (0 = first workout day)
 * @param weekNumber - Current week number (1-based), defaults to 1
 * @param totalWeeks - Total weeks in mesocycle, used to cap week lookup
 * @returns ExtractedSession with normalized exercise data, or null if not found
 */
export function getSessionFromProgramData(
  programData: FullProgramRecommendation | null | undefined,
  dayIndex: number,
  weekNumber: number = 1,
  totalWeeks: number = 6
): ExtractedSession | null {
  if (!programData) return null;

  // Prefer mesocycleWeeks if available (has week-specific data with intensity/volume modifiers)
  if (programData.mesocycleWeeks && programData.mesocycleWeeks.length > 0) {
    // Cap week index to available weeks
    const weekIdx = Math.min(weekNumber - 1, programData.mesocycleWeeks.length - 1);
    const week = programData.mesocycleWeeks[weekIdx];

    if (!week || !week.sessions || week.sessions.length === 0) {
      return null;
    }

    // Wrap day index if it exceeds available sessions
    const sessionIdx = dayIndex % week.sessions.length;
    const session = week.sessions[sessionIdx];

    if (!session) return null;

    return convertFatigueSession(session, week.weekNumber, week.isDeload);
  }

  // Fallback to legacy sessions array
  if (programData.sessions && programData.sessions.length > 0) {
    const sessionIdx = dayIndex % programData.sessions.length;
    const session = programData.sessions[sessionIdx];

    if (!session) return null;

    return convertLegacySession(session);
  }

  return null;
}

/**
 * Get all sessions for a specific week from program_data.
 * Useful for displaying the full week schedule.
 */
export function getWeekSessionsFromProgramData(
  programData: FullProgramRecommendation | null | undefined,
  weekNumber: number = 1
): ExtractedSession[] {
  if (!programData) return [];

  if (programData.mesocycleWeeks && programData.mesocycleWeeks.length > 0) {
    const weekIdx = Math.min(weekNumber - 1, programData.mesocycleWeeks.length - 1);
    const week = programData.mesocycleWeeks[weekIdx];

    if (!week || !week.sessions) return [];

    return week.sessions.map(s => convertFatigueSession(s, week.weekNumber, week.isDeload));
  }

  if (programData.sessions && programData.sessions.length > 0) {
    return programData.sessions.map(convertLegacySession);
  }

  return [];
}

/**
 * Get weekly progression modifiers for a specific week.
 * Used to adjust intensity and volume based on the week in the mesocycle.
 */
export function getWeeklyProgressionModifiers(
  programData: FullProgramRecommendation | null | undefined,
  weekNumber: number = 1
): { intensityModifier: number; volumeModifier: number; isDeload: boolean } {
  const defaults = { intensityModifier: 1.0, volumeModifier: 1.0, isDeload: false };

  if (!programData) return defaults;

  // Check mesocycleWeeks first
  if (programData.mesocycleWeeks && programData.mesocycleWeeks.length > 0) {
    const weekIdx = Math.min(weekNumber - 1, programData.mesocycleWeeks.length - 1);
    const week = programData.mesocycleWeeks[weekIdx];

    if (week) {
      return {
        intensityModifier: week.intensityModifier,
        volumeModifier: week.volumeModifier,
        isDeload: week.isDeload,
      };
    }
  }

  // Check periodization.weeklyProgression if available
  if (programData.periodization?.weeklyProgression) {
    const weekIdx = Math.min(weekNumber - 1, programData.periodization.weeklyProgression.length - 1);
    const progression = programData.periodization.weeklyProgression[weekIdx];

    if (progression) {
      return {
        intensityModifier: progression.intensityModifier,
        volumeModifier: progression.volumeModifier,
        isDeload: false, // Legacy format doesn't have explicit deload flag
      };
    }
  }

  return defaults;
}

/**
 * Determine if the current week is a deload week.
 */
export function isDeloadWeek(
  programData: FullProgramRecommendation | null | undefined,
  weekNumber: number,
  totalWeeks: number
): boolean {
  // Check mesocycleWeeks for explicit deload flag
  if (programData?.mesocycleWeeks && programData.mesocycleWeeks.length > 0) {
    const weekIdx = Math.min(weekNumber - 1, programData.mesocycleWeeks.length - 1);
    const week = programData.mesocycleWeeks[weekIdx];
    if (week) return week.isDeload;
  }

  // Default: last week is deload
  return weekNumber >= totalWeeks;
}

/**
 * Calculate how many training days have been completed this week.
 * Useful for determining which session (dayIndex) to use.
 *
 * @param completedDatesThisWeek - Array of workout dates completed this week
 * @returns Number of completed training days
 */
export function getCompletedDaysThisWeek(completedDatesThisWeek: string[]): number {
  return completedDatesThisWeek.length;
}

// ============================================================
// EXERCISE OVERRIDE MANAGEMENT
// ============================================================

/**
 * Exercise override entry - tracks when a user swaps an exercise
 */
export interface ExerciseOverride {
  originalExerciseId?: string;
  originalExerciseName: string;
  replacementExerciseId: string;
  replacementExerciseName: string;
  createdAt: string;
}

/**
 * Apply exercise overrides to a session's exercises.
 * Replaces exercises that have been swapped by the user.
 */
export function applyExerciseOverrides(
  exercises: ExtractedExercise[],
  overrides: ExerciseOverride[]
): ExtractedExercise[] {
  if (!overrides || overrides.length === 0) return exercises;

  return exercises.map(exercise => {
    // Find matching override by ID or name
    const override = overrides.find(o =>
      (o.originalExerciseId && o.originalExerciseId === exercise.exerciseId) ||
      o.originalExerciseName.toLowerCase() === exercise.exerciseName.toLowerCase()
    );

    if (override) {
      return {
        ...exercise,
        exerciseId: override.replacementExerciseId,
        exerciseName: override.replacementExerciseName,
      };
    }

    return exercise;
  });
}

/**
 * Create or update an exercise override.
 * Returns the updated overrides array.
 */
export function addExerciseOverride(
  existingOverrides: ExerciseOverride[],
  originalExerciseId: string | undefined,
  originalExerciseName: string,
  replacementExerciseId: string,
  replacementExerciseName: string
): ExerciseOverride[] {
  // Remove any existing override for this exercise
  const filtered = existingOverrides.filter(o =>
    !(o.originalExerciseId === originalExerciseId ||
      o.originalExerciseName.toLowerCase() === originalExerciseName.toLowerCase())
  );

  // Add new override
  return [
    ...filtered,
    {
      originalExerciseId,
      originalExerciseName,
      replacementExerciseId,
      replacementExerciseName,
      createdAt: clockNow().toISOString(),
    },
  ];
}
