/**
 * Exercise Swapper
 * 
 * Pure functions for finding similar exercises and suggesting swaps
 * based on movement patterns, muscle targeting, and equipment.
 */

import type {
  Exercise,
  SwapSuggestion,
  MovementPattern,
} from '@/types/schema';

// ============================================
// TYPES
// ============================================

export interface SwapContext {
  /** Reason for the swap */
  reason: 'plateau' | 'injury' | 'equipment' | 'preference' | 'variation';
  /** Available equipment (if limited) */
  availableEquipment?: string[];
  /** Exercises the user has done before */
  userHistory?: string[];
}

// ============================================
// SIMILARITY SCORING
// ============================================

/**
 * Calculate similarity score between two exercises (0-100)
 */
export function calculateSimilarityScore(
  source: Exercise,
  candidate: Exercise
): number {
  let score = 0;

  // Same primary muscle: 40 points
  if (source.primaryMuscle === candidate.primaryMuscle) {
    score += 40;
  }

  // Same movement pattern: 30 points
  if (source.movementPattern === candidate.movementPattern) {
    score += 30;
  }

  // Same mechanic: 15 points
  if (source.mechanic === candidate.mechanic) {
    score += 15;
  }

  // Overlapping secondary muscles: up to 10 points
  const secondaryOverlap = source.secondaryMuscles.filter((m) =>
    candidate.secondaryMuscles.includes(m)
  ).length;
  score += Math.min(10, secondaryOverlap * 3);

  // Similar rep range: 5 points
  const [srcMin, srcMax] = source.defaultRepRange;
  const [candMin, candMax] = candidate.defaultRepRange;
  if (Math.abs(srcMin - candMin) <= 2 && Math.abs(srcMax - candMax) <= 2) {
    score += 5;
  }

  return Math.min(100, score);
}

/**
 * Find similar exercises to a source exercise
 */
export function findSimilarExercises(
  source: Exercise,
  allExercises: Exercise[],
  context?: SwapContext
): Exercise[] {
  // Filter out the source exercise
  const candidates = allExercises.filter((e) => e.id !== source.id);

  // Score and sort by similarity
  const scored = candidates.map((exercise) => ({
    exercise,
    score: calculateSimilarityScore(source, exercise),
  }));

  // Apply context-based adjustments
  if (context?.availableEquipment) {
    scored.forEach((item) => {
      const hasEquipment = item.exercise.equipmentRequired.every((eq) =>
        context.availableEquipment!.includes(eq)
      );
      if (!hasEquipment) {
        item.score *= 0.5; // Penalize if equipment not available
      }
    });
  }

  // Boost exercises the user has done before (familiarity)
  if (context?.userHistory) {
    scored.forEach((item) => {
      if (context.userHistory!.includes(item.exercise.id)) {
        item.score *= 1.1; // 10% boost
      }
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return exercises with score > 50
  return scored.filter((s) => s.score > 50).map((s) => s.exercise);
}

// ============================================
// SWAP SUGGESTIONS
// ============================================

/**
 * Generate swap suggestions with reasoning
 */
export function suggestSwap(
  source: Exercise,
  allExercises: Exercise[],
  context: SwapContext
): SwapSuggestion[] {
  const similar = findSimilarExercises(source, allExercises, context);
  
  // Take top 5 suggestions
  const top = similar.slice(0, 5);

  return top.map((exercise) => {
    const score = calculateSimilarityScore(source, exercise);
    const reason = generateSwapReason(source, exercise, context, score);

    return {
      exercise,
      matchScore: score,
      reason,
    };
  });
}

/**
 * Generate human-readable reason for the swap suggestion
 */
function generateSwapReason(
  source: Exercise,
  candidate: Exercise,
  context: SwapContext,
  score: number
): string {
  const reasons: string[] = [];

  // Primary muscle match
  if (source.primaryMuscle === candidate.primaryMuscle) {
    reasons.push(`targets the same primary muscle (${source.primaryMuscle})`);
  }

  // Movement pattern match
  if (source.movementPattern === candidate.movementPattern) {
    reasons.push(`uses the same movement pattern`);
  } else {
    // Explain the difference
    reasons.push(`provides a different angle/movement variation`);
  }

  // Mechanic context
  if (source.mechanic !== candidate.mechanic) {
    if (candidate.mechanic === 'isolation') {
      reasons.push('allows more targeted muscle focus');
    } else {
      reasons.push('adds compound movement benefits');
    }
  }

  // Context-specific reasons
  switch (context.reason) {
    case 'plateau':
      reasons.push('provides novel stimulus to break plateau');
      break;
    case 'injury':
      reasons.push('may be easier on the injured area');
      break;
    case 'equipment':
      reasons.push('uses available equipment');
      break;
    case 'variation':
      reasons.push('adds variety to your program');
      break;
  }

  return reasons.join('; ');
}

// ============================================
// EQUIPMENT-BASED FILTERING
// ============================================

/**
 * Rank exercises by equipment availability
 */
export function rankByEquipmentAvailability(
  exercises: Exercise[],
  availableEquipment: string[]
): Exercise[] {
  const scored = exercises.map((exercise) => {
    const required = exercise.equipmentRequired;
    const hasAll = required.every((eq) => availableEquipment.includes(eq));
    const hasSome = required.some((eq) => availableEquipment.includes(eq));
    
    let score = 0;
    if (hasAll) score = 100;
    else if (hasSome) score = 50;
    else if (required.length === 0 || required.includes('bodyweight')) score = 80;

    return { exercise, score };
  });

  scored.sort((a, b) => b.score - a.score);
  
  return scored.map((s) => s.exercise);
}

/**
 * Get exercises that don't require specific equipment
 */
export function getBodyweightAlternatives(
  source: Exercise,
  allExercises: Exercise[]
): Exercise[] {
  return allExercises.filter(
    (e) =>
      e.id !== source.id &&
      e.primaryMuscle === source.primaryMuscle &&
      (e.equipmentRequired.length === 0 ||
        e.equipmentRequired.includes('bodyweight') ||
        e.equipmentRequired.every((eq) =>
          ['bodyweight', 'pull-up bar', 'dip bars'].includes(eq)
        ))
  );
}

// ============================================
// MOVEMENT PATTERN HELPERS
// ============================================

/**
 * Get all exercises for a movement pattern
 */
export function getExercisesByPattern(
  pattern: MovementPattern,
  exercises: Exercise[]
): Exercise[] {
  return exercises.filter((e) => e.movementPattern === pattern);
}

/**
 * Get related movement patterns for variety suggestions
 */
export function getRelatedPatterns(pattern: MovementPattern): MovementPattern[] {
  const relations: Record<MovementPattern, MovementPattern[]> = {
    'horizontal_push': ['vertical_push'],
    'horizontal_pull': ['vertical_pull'],
    'vertical_push': ['horizontal_push'],
    'vertical_pull': ['horizontal_pull'],
    'hip_hinge': ['squat'],
    'squat': ['lunge', 'hip_hinge'],
    'lunge': ['squat'],
    'knee_flexion': ['hip_hinge'],
    'elbow_flexion': [],
    'elbow_extension': [],
    'shoulder_isolation': [],
    'calf_raise': [],
    'core': [],
  };

  return relations[pattern] || [];
}

// ============================================
// COMPREHENSIVE SWAP ANALYSIS
// ============================================

export interface SwapAnalysis {
  directSwaps: SwapSuggestion[];
  patternVariations: SwapSuggestion[];
  equipmentAlternatives: SwapSuggestion[];
}

/**
 * Comprehensive swap analysis with multiple categories
 */
export function analyzeSwapOptions(
  source: Exercise,
  allExercises: Exercise[],
  context: SwapContext
): SwapAnalysis {
  // Direct swaps (same pattern, same muscle)
  const directSwaps = suggestSwap(source, allExercises, context);

  // Pattern variations (related patterns, same muscle)
  const relatedPatterns = getRelatedPatterns(source.movementPattern as MovementPattern);
  const patternCandidates = allExercises.filter(
    (e) =>
      e.id !== source.id &&
      e.primaryMuscle === source.primaryMuscle &&
      relatedPatterns.includes(e.movementPattern as MovementPattern)
  );
  const patternVariations = patternCandidates.slice(0, 3).map((exercise) => ({
    exercise,
    matchScore: calculateSimilarityScore(source, exercise),
    reason: `Different movement angle for ${source.primaryMuscle}`,
  }));

  // Equipment alternatives
  const bodyweight = getBodyweightAlternatives(source, allExercises);
  const equipmentAlternatives = bodyweight.slice(0, 3).map((exercise) => ({
    exercise,
    matchScore: calculateSimilarityScore(source, exercise),
    reason: 'Minimal equipment required',
  }));

  return {
    directSwaps,
    patternVariations,
    equipmentAlternatives,
  };
}

/**
 * Get a single best swap suggestion
 */
export function getBestSwap(
  source: Exercise,
  allExercises: Exercise[],
  context: SwapContext
): SwapSuggestion | null {
  const suggestions = suggestSwap(source, allExercises, context);
  return suggestions.length > 0 ? suggestions[0] : null;
}

/**
 * Check if two exercises are valid swaps (interchangeable)
 */
export function areExercisesInterchangeable(a: Exercise, b: Exercise): boolean {
  return (
    a.primaryMuscle === b.primaryMuscle &&
    a.movementPattern === b.movementPattern &&
    a.mechanic === b.mechanic
  );
}

