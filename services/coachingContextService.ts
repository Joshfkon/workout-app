/**
 * Coaching Context Formatting
 *
 * Pure formatting helper that turns a CoachingContext into a human-readable
 * string for the AI prompt. The DB-aggregation that builds the context lives
 * in lib/data/coachingContext.ts (impure / server-only).
 */

import type { CoachingContext } from '@/types/coaching';

/**
 * Formats coaching context as a human-readable string for the AI prompt
 */
export function formatCoachingContext(context: CoachingContext): string {
  let formatted = `## User Context\n\n`;

  // User info
  formatted += `**User:** ${context.user.name}\n`;
  formatted += `**Age:** ${context.user.age} years\n`;
  formatted += `**Sex:** ${context.user.sex}\n`;
  formatted += `**Height:** ${context.user.height} cm\n`;
  formatted += `**Training Age:** ${context.user.trainingAge} years\n`;
  if (context.user.goal) {
    formatted += `**Primary Goal:** ${context.user.goal}\n`;
  }
  if (context.user.experience) {
    formatted += `**Experience Level:** ${context.user.experience}\n`;
  }
  formatted += `\n`;

  // Phase info
  if (context.phase) {
    formatted += `**Current Phase:** ${context.phase.type} (Week ${context.phase.weekNumber})\n`;
    formatted += `**Starting Weight:** ${context.phase.startWeight} kg\n`;
    if (context.phase.targetWeight) {
      formatted += `**Target Weight:** ${context.phase.targetWeight} kg\n`;
    }
    formatted += `\n`;
  }

  // Current stats
  formatted += `**Current Weight:** ${context.currentStats.weight} kg`;
  if (context.currentStats.weightTrend) {
    formatted += ` (trend: ${context.currentStats.weightTrend})`;
  }
  formatted += `\n`;

  if (context.currentStats.bodyFat) {
    formatted += `**Body Fat:** ${context.currentStats.bodyFat.toFixed(1)}%\n`;
  }
  if (context.currentStats.leanMass) {
    formatted += `**Lean Mass:** ${context.currentStats.leanMass.toFixed(1)} kg\n`;
  }
  if (context.currentStats.ffmi) {
    formatted += `**FFMI:** ${context.currentStats.ffmi.toFixed(1)}\n`;
  }
  if (context.currentStats.lastDexaDate) {
    formatted += `**Last DEXA Scan:** ${context.currentStats.lastDexaDate}\n`;
  }
  formatted += `\n`;

  // Strength calibrations
  if (context.strength && context.strength.calibratedLifts.length > 0) {
    formatted += `**Calibrated Strength (Estimated 1RMs):**\n`;
    if (context.strength.overallLevel) {
      formatted += `Overall Level: ${context.strength.overallLevel}\n`;
    }
    for (const lift of context.strength.calibratedLifts) {
      formatted += `- ${lift.liftName}: ${lift.estimated1RM.toFixed(1)}kg`;
      if (lift.percentileVsTrained) {
        formatted += ` (${lift.percentileVsTrained}th percentile vs trained)`;
      }
      formatted += `\n`;
    }
    formatted += `\n`;
  }

  // Training info
  if (context.training.currentBlock) {
    formatted += `**Current Training Block:** ${context.training.currentBlock}\n`;
    if (context.training.weekInBlock) {
      formatted += `**Week in Block:** ${context.training.weekInBlock}\n`;
    }
    if (context.training.daysPerWeek) {
      formatted += `**Training Days per Week:** ${context.training.daysPerWeek}\n`;
    }
    formatted += `\n`;
  }

  // Recent lifts - only include valid data
  const validLifts = context.training.recentLifts.filter(
    lift => lift.topSetWeight != null && lift.topSetWeight > 0 && lift.topSetReps != null && lift.topSetReps > 0
  );
  
  if (validLifts.length > 0) {
    formatted += `**Recent Lift Performance (last 30 days):**\n`;
    for (const lift of validLifts.slice(0, 10)) {
      const weight = lift.topSetWeight?.toFixed(1) || '?';
      const reps = lift.topSetReps || '?';
      const rpe = lift.topSetRpe || '?';
      const e1rm = lift.estimated1RM?.toFixed(1) || '?';
      formatted += `- ${lift.exerciseName}: ${weight}kg × ${reps} @ RPE ${rpe} (e1RM: ${e1rm}kg) - ${lift.date}\n`;
    }
  } else if (context.training.recentLifts.length > 0) {
    formatted += `**Note:** Recent workout data exists but weight/rep values are incomplete. Please ensure you log weights when completing sets.\n`;
  }

  return formatted;
}
