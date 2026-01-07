// ============================================================
// WORKOUT INTEGRATION
// Bridges the ProgramEngine with workout pages
// ============================================================

import { ProgramEngine } from './programEngine';
import type { WorkingWeightRecommendation } from '@/types/training';

/**
 * Get weight recommendations for multiple exercises using the ProgramEngine.
 * Falls back gracefully if the engine can't provide recommendations.
 */
export async function getWeightRecommendationsForWorkout(
  userId: string,
  exercises: { name: string; targetReps: { min: number; max: number }; targetRIR: number }[]
): Promise<Map<string, WorkingWeightRecommendation>> {
  const recommendations = new Map<string, WorkingWeightRecommendation>();
  
  try {
    const engine = await ProgramEngine.create(userId);
    
    for (const exercise of exercises) {
      const rec = engine.getWeightRecommendation(
        exercise.name,
        exercise.targetReps,
        exercise.targetRIR
      );
      recommendations.set(exercise.name, rec);
    }
  } catch (error) {
    console.error('[getWeightRecommendationsForWorkout] ProgramEngine failed to load:', error);
  }

  return recommendations;
}

/**
 * Get today's workout from an active mesocycle using the ProgramEngine.
 */
export async function getTodayMesocycleWorkout(
  userId: string,
  mesocycleId: string
) {
  try {
    const engine = await ProgramEngine.create(userId);
    return engine.getTodayWorkout(mesocycleId);
  } catch (error) {
    console.error('[getTodayMesocycleWorkout] Failed to get workout from ProgramEngine:', error);
    return null;
  }
}

/**
 * Check if the user should deload based on their fatigue logs.
 */
export async function checkShouldDeload(
  userId: string,
  mesocycleId: string
) {
  try {
    const engine = await ProgramEngine.create(userId);
    return engine.checkDeloadTriggers(mesocycleId);
  } catch (error) {
    console.error('[checkShouldDeload] Failed to check deload triggers:', error);
    return { shouldDeload: false, reasons: [], suggestedDeloadType: 'volume' as const };
  }
}

/**
 * Record exercise history after workout completion.
 */
export async function recordWorkoutExerciseHistory(
  userId: string,
  workoutSessionId: string,
  exerciseResults: {
    exerciseName: string;
    sets: { weight: number; reps: number; rpe?: number; completed: boolean }[];
  }[]
) {
  try {
    const engine = await ProgramEngine.create(userId);
    
    for (const result of exerciseResults) {
      await engine.recordExerciseHistory(
        result.exerciseName,
        workoutSessionId,
        result.sets
      );
    }
  } catch (error) {
    console.error('[recordWorkoutExerciseHistory] Failed to record exercise history:', error);
  }
}

/**
 * Get user's recovery factors from the ProgramEngine.
 */
export async function getUserRecoveryFactors(userId: string) {
  try {
    const engine = await ProgramEngine.create(userId);
    return engine.calculateRecoveryFactors();
  } catch (error) {
    console.error('[getUserRecoveryFactors] Failed to calculate recovery factors:', error);
    return {
      volumeMultiplier: 1.0,
      frequencyMultiplier: 1.0,
      deloadFrequencyWeeks: 5,
      warnings: []
    };
  }
}

/**
 * Check if user has completed onboarding (has body comp + calibrations).
 */
export async function hasCompletedTrainingOnboarding(userId: string): Promise<boolean> {
  try {
    const engine = await ProgramEngine.create(userId);
    return engine.hasCompletedOnboarding();
  } catch (error) {
    console.error('[hasCompletedTrainingOnboarding] Failed to check onboarding status:', error);
    return false;
  }
}

