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
import { muscleMatchesGroup } from '@/types/schema';
import { BASE_SFR } from './fatigueBudgetEngine';
import { exerciseNameSimilarity } from './exerciseNameMatch';
import { canonicalizePatternToken, legacyPatternFamily } from './warmupEngine';

// ============================================
// STIMULUS-TO-FATIGUE (SFR)
// ============================================

/**
 * Estimate an exercise's stimulus-to-fatigue ratio from the fatigue budget
 * tables. Null when the pattern/equipment combination isn't covered —
 * callers must treat unknown as neutral, never as bad.
 */
export function estimateExerciseSFR(exercise: Exercise): number | null {
  // BASE_SFR is keyed by the legacy pattern vocabulary; route canonical
  // tokens (post-backfill values) through the legacy-family bridge.
  const patternTable = BASE_SFR[legacyPatternFamily(exercise.movementPattern) as keyof typeof BASE_SFR];
  if (!patternTable) return null;
  const equipment = exercise.equipmentRequired.find(
    (eq): eq is keyof typeof patternTable => eq in patternTable
  );
  if (!equipment) return null;
  return patternTable[equipment] ?? null;
}

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
 * Read an exercise's movement pattern regardless of which Exercise shape it
 * came from. The DB-mapped shape (services/exerciseService) stores it on
 * `pattern`; the schema shape stores it on `movementPattern`; some call sites
 * pass a blank placeholder. Returns '' when we genuinely have no pattern —
 * which the scorer treats as "unknown", never as a match.
 */
function getPattern(ex: Exercise): string {
  const raw = ex.movementPattern || (ex as { pattern?: string }).pattern || '';
  // Canonicalize so a legacy-valued row (e.g. a custom exercise with
  // 'horizontal_push') still pattern-matches a backfilled canonical row
  // ('horizontal_press').
  return canonicalizePatternToken(raw.toString());
}

/**
 * Collapse an exercise's equipment down to a coarse class so that, e.g., a
 * "plate loaded machine" and a "machine" count as the same class. Returns ''
 * (unknown) when there is no equipment info, which never matches.
 */
function equipmentClass(ex: Exercise): string {
  const tokens =
    (ex.equipmentRequired && ex.equipmentRequired.length
      ? ex.equipmentRequired
      : [(ex as { equipment?: string }).equipment ?? '']
    )
      .join(' ')
      .toLowerCase();
  if (!tokens.trim()) return '';
  if (tokens.includes('bodyweight') || tokens.includes('body weight')) return 'bodyweight';
  if (tokens.includes('cable')) return 'cable';
  if (tokens.includes('smith') || tokens.includes('machine') || tokens.includes('press machine'))
    return 'machine';
  if (tokens.includes('barbell') || tokens.includes('ez')) return 'barbell';
  if (tokens.includes('dumbbell')) return 'dumbbell';
  if (tokens.includes('kettlebell')) return 'kettlebell';
  if (tokens.includes('band')) return 'band';
  return tokens.split(' ')[0]; // fall back to the first descriptor
}

/**
 * Calculate similarity score between two exercises (0-100).
 *
 * Composite of independent signals. Each component contributes ONLY when we
 * have real data for both exercises — a missing/blank field scores 0 rather
 * than falsely matching another blank field. (The previous formula compared
 * `movementPattern === movementPattern`, and call sites pass a blank
 * placeholder for that field, so every candidate collected a free +30 and the
 * scores collapsed to a narrow band — the "everything is ~60%" bug.)
 *
 * Weights (max 100):
 *   Primary muscle .... 30 exact tag / 22 same standard-muscle group
 *   Movement pattern .. 22
 *   Equipment class ... 14
 *   Mechanic ..........  8
 *   Secondary muscles . up to 6  (3 per shared muscle, capped)
 *   Name similarity ... up to 20  (normalized trigram+token, 0..1 → 0..20)
 *
 * Name similarity is what separates near-identical variants ("Seated Calf
 * Raise (Machine)" vs "Seated Calf Raise (Plate Loaded)") from merely
 * same-muscle movements ("Calf Extension") when the structured fields agree.
 */
export function calculateSimilarityScore(
  source: Exercise,
  candidate: Exercise
): number {
  let score = 0;

  // Primary muscle: exact tag (30) or same standard-muscle group (22)
  // (e.g. legacy 'chest' vs detailed 'chest_upper').
  if (source.primaryMuscle === candidate.primaryMuscle) {
    score += 30;
  } else if (muscleMatchesGroup(candidate.primaryMuscle, source.primaryMuscle)) {
    score += 22;
  }

  // Movement pattern: 22 points, only when both are known and equal.
  const srcPattern = getPattern(source);
  const candPattern = getPattern(candidate);
  if (srcPattern && candPattern && srcPattern === candPattern) {
    score += 22;
  }

  // Equipment class: 14 points, only when both are known and equal.
  const srcEquip = equipmentClass(source);
  const candEquip = equipmentClass(candidate);
  if (srcEquip && candEquip && srcEquip === candEquip) {
    score += 14;
  }

  // Same mechanic: 8 points.
  if (source.mechanic === candidate.mechanic) {
    score += 8;
  }

  // Overlapping secondary muscles: up to 6 points.
  const secondaryOverlap = (source.secondaryMuscles || []).filter((m) =>
    (candidate.secondaryMuscles || []).includes(m)
  ).length;
  score += Math.min(6, secondaryOverlap * 3);

  // Name similarity: up to 20 points. Always available (names are real even
  // when structured metadata is a placeholder), so it also keeps the score
  // meaningful for candidates whose pattern/equipment are unknown.
  score += Math.round(exerciseNameSimilarity(source.name, candidate.name) * 20);

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

  // Efficiency nudge: prefer candidates with a better stimulus-to-fatigue
  // ratio than the source (up to ±10%). Unknown SFR stays neutral.
  const sourceSFR = estimateExerciseSFR(source);
  if (sourceSFR !== null) {
    scored.forEach((item) => {
      const sfr = estimateExerciseSFR(item.exercise);
      if (sfr !== null) {
        item.score *= Math.min(1.1, Math.max(0.9, 1 + (sfr - sourceSFR) * 0.1));
      }
    });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return plausible alternatives. Threshold is lower than the old 50 because
  // the rebalanced formula no longer hands out a free movement-pattern match;
  // a genuine same-muscle swap that differs in equipment now lands in the 40s.
  return scored.filter((s) => s.score >= 40).map((s) => s.exercise);
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

  const sourceSFR = estimateExerciseSFR(source);

  return top.map((exercise) => {
    const score = calculateSimilarityScore(source, exercise);
    let reason = generateSwapReason(source, exercise, context, score);

    const sfr = estimateExerciseSFR(exercise);
    if (sourceSFR !== null && sfr !== null && sfr - sourceSFR >= 0.2) {
      reason += ' Gives more stimulus per unit of fatigue.';
    }

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
  if (getPattern(source) && getPattern(source) === getPattern(candidate)) {
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
      muscleMatchesGroup(e.primaryMuscle, source.primaryMuscle) &&
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
  const target = canonicalizePatternToken(pattern);
  return exercises.filter((e) => getPattern(e) === target);
}

/**
 * Get related movement patterns for variety suggestions.
 *
 * Keyed by the CANONICAL vocabulary (services/warmupEngine); legacy tokens
 * are canonicalized on the way in, and returned values are canonical — so
 * compare candidates via canonicalizePatternToken, never raw stored values.
 */
export function getRelatedPatterns(pattern: MovementPattern | string): string[] {
  const relations: Record<string, string[]> = {
    'horizontal_press': ['vertical_press'],
    'horizontal_pull': ['vertical_pull'],
    'vertical_press': ['horizontal_press'],
    'vertical_pull': ['horizontal_pull'],
    'hinge': ['squat'],
    'squat': ['lunge', 'hinge'],
    'lunge': ['squat'],
    'isolation_knee_flexion': ['hinge'],
  };

  return relations[canonicalizePatternToken(pattern)] || [];
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
  const relatedPatterns = getRelatedPatterns(source.movementPattern);
  const patternCandidates = allExercises.filter(
    (e) =>
      e.id !== source.id &&
      muscleMatchesGroup(e.primaryMuscle, source.primaryMuscle) &&
      relatedPatterns.includes(getPattern(e))
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
    getPattern(a) !== '' &&
    getPattern(a) === getPattern(b) &&
    a.mechanic === b.mechanic
  );
}

