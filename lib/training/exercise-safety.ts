/**
 * Enhanced Exercise Safety Check
 *
 * Comprehensive safety analysis that considers:
 * - Stabilizer muscle involvement
 * - Spinal loading levels
 * - Movement requirements (back arch, flexion, extension, rotation)
 * - Position stress on body areas
 * - Specific contraindications
 */

import type { Exercise, PositionStress, SpinalLoading } from '@/services/exerciseService';
import type { MuscleGroup } from '@/types/schema';
import {
  INJURY_TYPES,
  getInjuryType,
  mergeInjuryRestrictions,
  type UserInjury,
  type InjuryType,
  type InjuryMovementRestrictions,
  type InjurySeverity,
} from './injury-types';

/**
 * Safety level for an exercise given active injuries
 */
export type SafetyLevel = 'safe' | 'caution' | 'avoid';

/**
 * Detailed reason for a safety flag
 */
export interface SafetyReason {
  type:
    | 'contraindication'
    | 'spinal_loading'
    | 'movement_requirement'
    | 'position_stress'
    | 'stabilizer'
    | 'primary_muscle'
    | 'secondary_muscle';
  description: string;
  /** Severity of this specific reason */
  severity: 'high' | 'medium' | 'low';
}

/**
 * Complete safety analysis result for an exercise
 */
export interface ExerciseSafetyResult {
  level: SafetyLevel;
  reasons: SafetyReason[];
  /** Safe alternatives sorted by similarity */
  alternatives: Exercise[];
  /** Recommendations for using this exercise cautiously */
  cautionRecommendations?: string[];
}

/**
 * Check if an exercise is safe given active injuries
 * Returns detailed safety information including reasons and alternatives
 */
export function checkExerciseSafety(
  exercise: Exercise,
  activeInjuries: UserInjury[],
  allExercises?: Exercise[]
): ExerciseSafetyResult {
  const reasons: SafetyReason[] = [];

  for (const injury of activeInjuries) {
    if (!injury.isActive) continue;

    const injuryType = getInjuryType(injury.injuryTypeId);
    if (!injuryType) continue;

    const restrictions = mergeInjuryRestrictions(injury, injuryType);

    // Check each safety criterion
    checkContraindications(exercise, injury, injuryType, reasons);
    checkSpinalLoading(exercise, injury, restrictions, reasons);
    checkMovementRequirements(exercise, injury, injuryType, restrictions, reasons);
    checkPositionStress(exercise, injury, injuryType, reasons);
    checkStabilizerInvolvement(exercise, injury, injuryType, reasons);
    checkMuscleTargeting(exercise, injury, injuryType, reasons);
  }

  // Determine overall safety level
  const level = determineSafetyLevel(reasons, activeInjuries);

  // Get alternatives if needed
  const alternatives =
    level !== 'safe' && allExercises
      ? findSafeAlternatives(exercise, activeInjuries, allExercises)
      : [];

  // Generate caution recommendations
  const cautionRecommendations =
    level === 'caution' ? generateCautionRecommendations(exercise, reasons) : undefined;

  return {
    level,
    reasons,
    alternatives,
    cautionRecommendations,
  };
}

/**
 * Check if exercise has contraindications for the injury
 */
function checkContraindications(
  exercise: Exercise,
  injury: UserInjury,
  injuryType: InjuryType,
  reasons: SafetyReason[]
): void {
  if (!exercise.contraindications) return;

  if (exercise.contraindications.includes(injury.injuryTypeId)) {
    reasons.push({
      type: 'contraindication',
      description: `Exercise is contraindicated for ${injuryType.name}`,
      severity: 'high',
    });
  }
}

/**
 * Check spinal loading requirements
 */
function checkSpinalLoading(
  exercise: Exercise,
  injury: UserInjury,
  restrictions: InjuryMovementRestrictions,
  reasons: SafetyReason[]
): void {
  if (!restrictions.spinalLoading) return;

  const loadingLevels: SpinalLoading[] = ['none', 'low', 'moderate', 'high'];
  const exerciseLoadingIndex = loadingLevels.indexOf(exercise.spinalLoading);
  const worstAllowedIndex = Math.min(
    ...restrictions.spinalLoading.map((l) => loadingLevels.indexOf(l))
  );

  if (exerciseLoadingIndex >= worstAllowedIndex) {
    const severityMap: Record<SpinalLoading, 'high' | 'medium' | 'low'> = {
      none: 'low',
      low: 'low',
      moderate: 'medium',
      high: 'high',
    };

    reasons.push({
      type: 'spinal_loading',
      description: `${capitalize(exercise.spinalLoading)} spinal loading may aggravate your injury`,
      severity:
        injury.severity === 'severe' ? 'high' : severityMap[exercise.spinalLoading],
    });
  }
}

/**
 * Check movement requirements (back arch, spinal movements)
 */
function checkMovementRequirements(
  exercise: Exercise,
  injury: UserInjury,
  injuryType: InjuryType,
  restrictions: InjuryMovementRestrictions,
  reasons: SafetyReason[]
): void {
  if (restrictions.backArch && exercise.requiresBackArch) {
    reasons.push({
      type: 'movement_requirement',
      description: 'Requires back arch which stresses your injured area',
      severity: injury.severity === 'severe' ? 'high' : 'medium',
    });
  }

  if (restrictions.spinalFlexion && exercise.requiresSpinalFlexion) {
    reasons.push({
      type: 'movement_requirement',
      description: 'Requires spinal flexion which may aggravate your injury',
      severity: injury.severity === 'severe' ? 'high' : 'medium',
    });
  }

  if (restrictions.spinalExtension && exercise.requiresSpinalExtension) {
    reasons.push({
      type: 'movement_requirement',
      description: 'Requires spinal extension which may aggravate your injury',
      severity: injury.severity === 'severe' ? 'high' : 'medium',
    });
  }

  if (restrictions.spinalRotation && exercise.requiresSpinalRotation) {
    reasons.push({
      type: 'movement_requirement',
      description: 'Requires spinal rotation which may aggravate your injury',
      severity: injury.severity === 'severe' ? 'high' : 'medium',
    });
  }
}

/**
 * Check if exercise stresses injured body positions
 */
function checkPositionStress(
  exercise: Exercise,
  injury: UserInjury,
  injuryType: InjuryType,
  reasons: SafetyReason[]
): void {
  if (!exercise.positionStress || !injuryType.avoidPositionStress) return;

  for (const area of injuryType.avoidPositionStress) {
    if (exercise.positionStress[area]) {
      reasons.push({
        type: 'position_stress',
        description: `Stresses the ${formatArea(area)} which is affected by your ${injuryType.name}`,
        severity: injury.severity === 'severe' ? 'high' : 'medium',
      });
    }
  }
}

/**
 * Check if stabilizer muscles include injured areas
 */
function checkStabilizerInvolvement(
  exercise: Exercise,
  injury: UserInjury,
  injuryType: InjuryType,
  reasons: SafetyReason[]
): void {
  if (!exercise.stabilizers?.length) return;

  for (const area of injuryType.affectedAreas) {
    if (exercise.stabilizers.includes(area)) {
      reasons.push({
        type: 'stabilizer',
        description: `Uses ${area} as a stabilizer, which is part of your injured area`,
        severity: injury.severity === 'severe' ? 'medium' : 'low',
      });
    }
  }
}

/**
 * Check if exercise directly targets injured muscle groups
 */
function checkMuscleTargeting(
  exercise: Exercise,
  injury: UserInjury,
  injuryType: InjuryType,
  reasons: SafetyReason[]
): void {
  // Primary muscle targeting is handled by the existing injury system
  // Here we add awareness for secondary muscle involvement
  for (const area of injuryType.affectedAreas) {
    if (exercise.secondaryMuscles.includes(area)) {
      reasons.push({
        type: 'secondary_muscle',
        description: `Works ${area} as a secondary muscle, which is affected by your injury`,
        severity: injury.severity === 'severe' ? 'medium' : 'low',
      });
    }
  }
}

/**
 * Determine overall safety level from collected reasons
 */
function determineSafetyLevel(
  reasons: SafetyReason[],
  injuries: UserInjury[]
): SafetyLevel {
  if (reasons.length === 0) return 'safe';

  const hasHighSeverity = reasons.some((r) => r.severity === 'high');
  const hasMediumSeverity = reasons.some((r) => r.severity === 'medium');
  const hasContraindication = reasons.some((r) => r.type === 'contraindication');
  const anySevereInjury = injuries.some((i) => i.severity === 'severe');

  // AVOID if:
  // - Has contraindication
  // - Any high severity reason
  // - Multiple medium severity reasons with severe injury
  if (
    hasContraindication ||
    hasHighSeverity ||
    (hasMediumSeverity && anySevereInjury && reasons.filter((r) => r.severity === 'medium').length > 1)
  ) {
    return 'avoid';
  }

  // CAUTION if:
  // - Any medium or low severity reasons
  if (hasMediumSeverity || reasons.length > 0) {
    return 'caution';
  }

  return 'safe';
}

/**
 * Find safe alternatives for an unsafe exercise
 */
export function findSafeAlternatives(
  unsafeExercise: Exercise,
  activeInjuries: UserInjury[],
  allExercises: Exercise[],
  maxResults: number = 5
): Exercise[] {
  // Find exercises with same primary muscle
  const sameMuscleCandidates = allExercises.filter(
    (e) =>
      e.id !== unsafeExercise.id &&
      e.primaryMuscle === unsafeExercise.primaryMuscle
  );

  // Filter to only safe exercises
  const safeAlternatives: { exercise: Exercise; score: number }[] = [];

  for (const candidate of sameMuscleCandidates) {
    const safety = checkExerciseSafety(candidate, activeInjuries);

    if (safety.level === 'safe') {
      const score = calculateSimilarityScore(unsafeExercise, candidate);
      safeAlternatives.push({ exercise: candidate, score });
    }
  }

  // Sort by similarity and equipment preference
  safeAlternatives.sort((a, b) => {
    // Prioritize machine > cable > dumbbell > barbell for injured users
    const equipmentPriority: Record<string, number> = {
      machine: 4,
      cable: 3,
      dumbbell: 2,
      barbell: 1,
      bodyweight: 2,
      kettlebell: 1,
    };

    const aPriority = equipmentPriority[a.exercise.equipment] || 0;
    const bPriority = equipmentPriority[b.exercise.equipment] || 0;

    // If equipment priorities differ significantly, use that
    if (Math.abs(aPriority - bPriority) >= 2) {
      return bPriority - aPriority;
    }

    // Otherwise use similarity score
    return b.score - a.score;
  });

  return safeAlternatives.slice(0, maxResults).map((a) => a.exercise);
}

/**
 * Calculate similarity score between two exercises
 */
function calculateSimilarityScore(source: Exercise, candidate: Exercise): number {
  let score = 0;

  // Same pattern is valuable
  if (source.pattern === candidate.pattern) score += 30;

  // Same mechanic
  if (source.mechanic === candidate.mechanic) score += 20;

  // Similar hypertrophy tier
  if (source.hypertrophyScore.tier === candidate.hypertrophyScore.tier) score += 15;

  // Overlapping secondary muscles
  const overlappingSecondary = source.secondaryMuscles.filter((m) =>
    candidate.secondaryMuscles.includes(m)
  );
  score += overlappingSecondary.length * 5;

  // Similar rep range
  const repDiff = Math.abs(source.defaultRepRange[0] - candidate.defaultRepRange[0]);
  if (repDiff <= 2) score += 10;

  return score;
}

/**
 * Generate caution recommendations for an exercise
 */
function generateCautionRecommendations(
  exercise: Exercise,
  reasons: SafetyReason[]
): string[] {
  const recommendations: string[] = [];

  recommendations.push('Use lighter weight than normal');
  recommendations.push('Focus on controlled movement');
  recommendations.push('Stop immediately if you feel any discomfort');

  // Add specific recommendations based on reasons
  for (const reason of reasons) {
    if (reason.type === 'spinal_loading') {
      recommendations.push('Keep your core tight throughout the movement');
    }
    if (reason.type === 'movement_requirement' && reason.description.includes('back arch')) {
      recommendations.push('Minimize back arch while maintaining proper form');
    }
    if (reason.type === 'stabilizer') {
      recommendations.push('Consider using a machine variation if available');
    }
  }

  // Deduplicate
  return Array.from(new Set(recommendations));
}

/**
 * Scan a workout for problematic exercises
 */
export interface WorkoutScanResult {
  hasIssues: boolean;
  avoidExercises: { exercise: Exercise; reasons: SafetyReason[] }[];
  cautionExercises: { exercise: Exercise; reasons: SafetyReason[] }[];
}

export function scanWorkoutForInjuries(
  workoutExercises: Exercise[],
  activeInjuries: UserInjury[],
  allExercises?: Exercise[]
): WorkoutScanResult {
  const avoidExercises: { exercise: Exercise; reasons: SafetyReason[] }[] = [];
  const cautionExercises: { exercise: Exercise; reasons: SafetyReason[] }[] = [];

  for (const exercise of workoutExercises) {
    const safety = checkExerciseSafety(exercise, activeInjuries, allExercises);

    if (safety.level === 'avoid') {
      avoidExercises.push({ exercise, reasons: safety.reasons });
    } else if (safety.level === 'caution') {
      cautionExercises.push({ exercise, reasons: safety.reasons });
    }
  }

  return {
    hasIssues: avoidExercises.length > 0 || cautionExercises.length > 0,
    avoidExercises,
    cautionExercises,
  };
}

/**
 * Auto-swap all unsafe exercises in a workout
 */
export function autoSwapUnsafeExercises(
  workoutExercises: Exercise[],
  activeInjuries: UserInjury[],
  allExercises: Exercise[]
): { exercise: Exercise; swappedFrom?: Exercise }[] {
  return workoutExercises.map((exercise) => {
    const safety = checkExerciseSafety(exercise, activeInjuries, allExercises);

    if (safety.level === 'avoid' && safety.alternatives.length > 0) {
      return {
        exercise: safety.alternatives[0],
        swappedFrom: exercise,
      };
    }

    return { exercise };
  });
}

// === Utility Functions ===

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatArea(area: keyof PositionStress): string {
  const areaNames: Record<keyof PositionStress, string> = {
    lowerBack: 'lower back',
    upperBack: 'upper back',
    shoulders: 'shoulders',
    knees: 'knees',
    wrists: 'wrists',
    elbows: 'elbows',
    hips: 'hips',
    neck: 'neck',
  };
  return areaNames[area] || area;
}

// Export types for use in components
export type { InjuryType, UserInjury, InjurySeverity };
