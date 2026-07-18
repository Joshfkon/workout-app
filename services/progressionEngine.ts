/**
 * Progression Engine
 * 
 * Pure functions for calculating workout progression, set quality, and warmup protocols.
 * No side effects or database calls - all data passed as input.
 */

import type {
  Exercise,
  ExerciseEntry,
  SetLog,
  SetQuality,
  LastSessionPerformance,
  WarmupSet,
  MovementPattern,
  Equipment,
} from '@/types/schema';
import {
  calculateAvgFormScore,
  muscleMatchesGroup,
  normalizeMuscleToken,
} from '@/types/schema';
import { roundToIncrement } from '@/lib/utils';
import { estimate1RM } from './shared/strengthCalculations';

// ============================================
// TYPE ADAPTERS
// ============================================

/**
 * Convert ExerciseEntry (from mesocycle builder) to Exercise (for progression engine)
 * Derives missing progression fields from pattern and equipment
 */
export function exerciseEntryToExercise(entry: ExerciseEntry): Exercise {
  // Derive mechanic from pattern
  const mechanic = entry.mechanic || (entry.pattern === 'isolation' ? 'isolation' : 'compound');
  
  // Derive default rep range from pattern/equipment/difficulty
  const defaultRepRange = entry.defaultRepRange || getDefaultRepRangeForPattern(entry.pattern, mechanic);
  
  // Derive default RIR from difficulty
  const defaultRir = entry.defaultRir ?? (entry.difficulty === 'advanced' ? 2 : entry.difficulty === 'intermediate' ? 3 : 4);
  
  // Derive minimum weight increment from equipment
  const minWeightIncrementKg = entry.minWeightIncrementKg ?? getMinIncrementForEquipment(entry.equipment);
  
  // Map pattern to movement pattern string
  const movementPattern = typeof entry.pattern === 'string' ? entry.pattern : 'compound';
  
  return {
    id: entry.name.toLowerCase().replace(/\s+/g, '-'),
    name: entry.name,
    primaryMuscle: entry.primaryMuscle,
    secondaryMuscles: entry.secondaryMuscles,
    mechanic,
    defaultRepRange,
    defaultRir,
    minWeightIncrementKg,
    // Additional required fields with defaults
    formCues: [],
    commonMistakes: [],
    setupNote: entry.notes || '',
    movementPattern,
    equipmentRequired: [entry.equipment],
  };
}

/**
 * Get default rep range based on movement pattern
 */
function getDefaultRepRangeForPattern(
  pattern: MovementPattern | 'isolation' | 'carry',
  mechanic: 'compound' | 'isolation'
): [number, number] {
  if (mechanic === 'isolation') return [10, 15];
  
  // Compound movements
  switch (pattern) {
    case 'squat':
    case 'hip_hinge':
      return [5, 8]; // Heavy compounds
    case 'horizontal_push':
    case 'horizontal_pull':
    case 'vertical_push':
    case 'vertical_pull':
      return [6, 10];
    case 'lunge':
      return [8, 12];
    default:
      return [8, 12];
  }
}

/**
 * Get minimum weight increment based on equipment type
 */
function getMinIncrementForEquipment(equipment: Equipment): number {
  switch (equipment) {
    case 'barbell':
      return 2.5; // Standard barbell plates
    case 'dumbbell':
      return 2.0; // Most gyms have 1kg increments per hand
    case 'kettlebell':
      return 4.0; // Kettlebells have larger jumps
    case 'cable':
      return 2.5; // Cable stacks vary
    case 'machine':
      return 2.5; // Machine stacks vary
    case 'bodyweight':
      return 0; // No external load
    default:
      return 2.5;
  }
}

// ============================================
// CONSTANTS
// ============================================

/** RPE thresholds for set quality classification */
const SET_QUALITY_THRESHOLDS = {
  junk: { maxRpe: 5 },           // RPE <= 5 (RIR >= 5) is junk volume
  effective: { minRpe: 6, maxRpe: 7 }, // RPE 6-7 is effective
  stimulative: { minRpe: 7.5, maxRpe: 9.5 }, // RPE 7.5-9.5 is stimulative
  excessive: { minRpe: 10 },     // RPE 10 (failure) may be excessive
};

// ============================================
// PERIODIZATION PHASES
// ============================================

export type PeriodizationPhase = 'hypertrophy' | 'strength' | 'peaking' | 'deload';

/**
 * Determine periodization phase based on week and model
 */
export function getPeriodizationPhase(
  weekInMeso: number,
  totalWeeks: number,
  model: 'linear' | 'daily_undulating' | 'weekly_undulating' | 'block' = 'linear'
): PeriodizationPhase {
  // Guard against division by zero
  if (totalWeeks <= 0) {
    return 'hypertrophy'; // Default to hypertrophy phase
  }
  const progress = weekInMeso / totalWeeks;
  
  // Deload is always the last week
  if (weekInMeso === totalWeeks) return 'deload';
  
  if (model === 'block') {
    if (progress < 0.5) return 'hypertrophy';
    if (progress < 0.85) return 'strength';
    return 'peaking';
  }
  
  // Linear and undulating use progressive approach
  if (progress < 0.4) return 'hypertrophy';
  if (progress < 0.8) return 'strength';
  return 'peaking';
}

// ============================================
// SET QUALITY CLASSIFICATION
// ============================================

export interface CalculateSetQualityInput {
  rpe: number;
  targetRir: number;
  reps: number;
  targetRepRange: [number, number];
  isLastSet: boolean;
}

/**
 * Calculate the quality classification of a logged set
 */
export function calculateSetQuality(input: CalculateSetQualityInput): {
  quality: SetQuality;
  reason: string;
} {
  const { rpe, targetRir, reps, targetRepRange, isLastSet } = input;
  const [minReps, maxReps] = targetRepRange;
  const rir = 10 - rpe;

  // Junk volume: too easy (high RIR, low RPE)
  if (rpe <= SET_QUALITY_THRESHOLDS.junk.maxRpe) {
    return {
      quality: 'junk',
      reason: `RPE ${rpe} (${rir} RIR) - too far from failure to stimulate growth`,
    };
  }

  // Excessive: too hard (failure or near-failure when not intended)
  if (rpe >= SET_QUALITY_THRESHOLDS.excessive.minRpe && !isLastSet) {
    return {
      quality: 'excessive',
      reason: 'Reached failure on non-final set - may impact remaining sets',
    };
  }

  // Check rep range compliance
  if (reps < minReps) {
    return {
      quality: 'effective',
      reason: `Below target rep range (${reps}/${minReps}-${maxReps}) - consider reducing weight`,
    };
  }

  // Stimulative: in the sweet spot
  if (
    rpe >= SET_QUALITY_THRESHOLDS.stimulative.minRpe &&
    rpe <= SET_QUALITY_THRESHOLDS.stimulative.maxRpe
  ) {
    return {
      quality: 'stimulative',
      reason: `RPE ${rpe} with ${reps} reps - excellent hypertrophy stimulus`,
    };
  }

  // Effective: good but not optimal
  return {
    quality: 'effective',
    reason: `RPE ${rpe} - contributing to volume but could push harder`,
  };
}

/**
 * Detect sets that count as "junk volume" (too easy to stimulate growth)
 */
export function detectJunkVolume(sets: SetLog[]): SetLog[] {
  // Ramp/feeder sets are intentionally light — they're potentiation, not junk
  // volume. Only working sets can be "too easy to stimulate growth".
  return sets.filter(
    (set) => !set.isWarmup && set.setRole !== 'ramp' && set.rpe <= SET_QUALITY_THRESHOLDS.junk.maxRpe
  );
}

/**
 * Detect regression in performance
 */
export function detectRegression(
  current: LastSessionPerformance,
  previous: LastSessionPerformance | null
): { isRegression: boolean; reason: string } {
  if (!previous) {
    return { isRegression: false, reason: 'No previous data to compare' };
  }

  // Weight decreased
  if (current.weightKg < previous.weightKg) {
    return {
      isRegression: true,
      reason: `Weight dropped from ${previous.weightKg}kg to ${current.weightKg}kg`,
    };
  }

  // Same weight, fewer reps
  if (current.weightKg === previous.weightKg && current.reps < previous.reps - 1) {
    return {
      isRegression: true,
      reason: `Reps dropped from ${previous.reps} to ${current.reps} at same weight`,
    };
  }

  // Higher RPE for same performance
  if (
    current.weightKg === previous.weightKg &&
    current.reps === previous.reps &&
    current.averageRpe > previous.averageRpe + 1
  ) {
    return {
      isRegression: true,
      reason: 'Same performance required significantly more effort',
    };
  }

  return { isRegression: false, reason: '' };
}

// ============================================
// WARMUP PROTOCOL GENERATION
// ============================================

export interface GenerateWarmupInput {
  workingWeight: number;
  exercise: Exercise;
  isFirstExercise: boolean;
  /** Barbell type for determining empty bar weight (only used for barbell exercises) */
  barbellType?: 'olympic' | 'womens' | 'ez_curl' | 'trap';
}

/**
 * Get appropriate rest time for a warmup set based on intensity
 * Lighter warmups need less rest, heavier warmups need more
 */
function getWarmupRestSeconds(percentOfWorking: number): number {
  if (percentOfWorking <= 0) return 30;   // Empty bar / general warmup
  if (percentOfWorking <= 40) return 30;  // Very light
  if (percentOfWorking <= 50) return 45;  // Light
  if (percentOfWorking <= 70) return 60;  // Medium
  if (percentOfWorking <= 85) return 75;  // Heavy
  return 90;                               // Very heavy (potentiation)
}

/**
 * Get the barbell weight in kg based on barbell type
 */
function getBarbellWeightKg(barbellType: 'olympic' | 'womens' | 'ez_curl' | 'trap' = 'olympic'): number {
  switch (barbellType) {
    case 'olympic': return 20;
    case 'womens': return 15;
    case 'ez_curl': return 10;
    case 'trap': return 25;
    default: return 20;
  }
}

/**
 * Check if an exercise uses a barbell based on equipment
 */
function isBarbellExercise(exercise: Exercise): boolean {
  return exercise.equipmentRequired?.some(
    (eq) => eq.toLowerCase() === 'barbell' || eq.toLowerCase() === 'olympic barbell'
  ) ?? false;
}

/**
 * Generate a warmup protocol based on working weight
 */
export function generateWarmupProtocol(input: GenerateWarmupInput): WarmupSet[] {
  const { workingWeight, exercise, isFirstExercise, barbellType = 'olympic' } = input;

  const isBarbell = isBarbellExercise(exercise);
  const barbellWeightKg = getBarbellWeightKg(barbellType);

  // No warmup needed for very light weights
  if (workingWeight < 20) {
    return [
      {
        setNumber: 1,
        percentOfWorking: 50,
        targetReps: 10,
        purpose: 'Light activation',
        restSeconds: 30,
      },
    ];
  }

  // Standard warmup protocol
  const protocol: WarmupSet[] = [];

  // Set 1: Empty bar or light warmup (if first exercise, add general warmup)
  // Only barbell exercises can use "empty bar" (0%); other equipment uses a light percentage
  if (isFirstExercise) {
    if (isBarbell) {
      // Barbell exercises: empty bar for general warmup makes sense
      protocol.push({
        setNumber: 1,
        percentOfWorking: 0,
        targetReps: 10,
        purpose: 'General warmup',
        restSeconds: 30,
      });
    } else {
      // Non-barbell exercises (dumbbells, cables, etc.): use light weight, not 0
      // Use 30% of working weight as a minimum meaningful warmup
      protocol.push({
        setNumber: 1,
        percentOfWorking: 30,
        targetReps: 10,
        purpose: 'General warmup',
        restSeconds: 30,
      });
    }
  }

  // For barbell exercises with sufficient working weight, add a bar-only warmup set
  // This helps practice the movement pattern before adding plates
  if (isBarbell && workingWeight > barbellWeightKg * 1.5) {
    // Calculate what percentage of working weight the empty bar represents
    const barPercentOfWorking = Math.round((barbellWeightKg / workingWeight) * 100);

    protocol.push({
      setNumber: protocol.length + 1,
      percentOfWorking: barPercentOfWorking,
      targetReps: 10,
      purpose: 'Bar warmup',
      restSeconds: 30,
      isBarOnly: true,
    } as WarmupSet);
  }

  // Progressive loading warmups
  const warmupPercents = workingWeight >= 100
    ? [30, 50, 70, 85]
    : workingWeight >= 50
    ? [40, 60, 80]
    : [50, 75];

  // Filter out percentages that would be less than or equal to bar weight for barbell exercises
  const filteredPercents = isBarbell
    ? warmupPercents.filter((percent) => {
        const warmupWeight = workingWeight * (percent / 100);
        return warmupWeight > barbellWeightKg;
      })
    : warmupPercents;

  filteredPercents.forEach((percent) => {
    const warmupWeight = roundToIncrement(
      workingWeight * (percent / 100),
      exercise.minWeightIncrementKg
    );

    // Reps decrease as weight increases
    const reps = percent <= 50 ? 8 : percent <= 70 ? 5 : 3;

    let purpose = 'Progressive loading';
    if (percent <= 50) purpose = 'Movement groove';
    else if (percent <= 70) purpose = 'Neuro prep';
    else purpose = 'CNS activation';

    protocol.push({
      setNumber: protocol.length + 1,
      percentOfWorking: percent,
      targetReps: reps,
      purpose,
      restSeconds: getWarmupRestSeconds(percent),
    });
  });

  return protocol;
}

// ============================================
// MUSCLE WARMUP STATUS
// ============================================

export interface WarmedMusclesInput {
  /** Sets completed so far this session */
  completedSets: Array<{
    exerciseBlockId: string;
    isWarmup?: boolean;
    setType?: string | null;
  }>;
  /** Exercise blocks in the session, used to map sets to muscles */
  blocks: Array<{
    id: string;
    exercise: { primaryMuscle: string; secondaryMuscles?: string[] };
  }>;
}

/**
 * Determine which muscles are already warmed up this session.
 *
 * A muscle counts as warm once any set has been completed on an exercise
 * that targets it as the primary muscle, or once a working (non-warmup)
 * set has been completed on an exercise that hits it as a secondary
 * muscle — e.g. bench press working sets warm the triceps and front
 * delts, so a triceps exercise later in the session needs no warmup.
 *
 * Returns the normalized raw tokens as logged on the exercises; callers
 * should match against them with isMuscleWarmedUp, which resolves legacy,
 * standard, and detailed tokens through the muscle taxonomy.
 */
export function getWarmedUpMuscles(input: WarmedMusclesInput): Set<string> {
  const { completedSets, blocks } = input;
  const warmed = new Set<string>();
  const blocksById = new Map(blocks.map((b) => [b.id, b]));

  for (const set of completedSets) {
    const block = blocksById.get(set.exerciseBlockId);
    if (!block) continue;

    if (block.exercise.primaryMuscle) {
      warmed.add(normalizeMuscleToken(block.exercise.primaryMuscle));
    }

    // Light warmup sets prep their own primary muscle, but only working
    // sets carry enough load to count for secondary muscles
    const isWarmupSet = set.isWarmup || set.setType === 'warmup';
    if (!isWarmupSet) {
      for (const secondary of block.exercise.secondaryMuscles ?? []) {
        if (secondary) warmed.add(normalizeMuscleToken(secondary));
      }
    }
  }

  return warmed;
}

/**
 * Whether a muscle has already been warmed up this session.
 * See getWarmedUpMuscles for what counts as "warm".
 *
 * Matching goes through the muscle taxonomy in both directions, so a
 * coarse legacy token and a precise standard/detailed token warm each
 * other — e.g. flat bench ('chest') warms 'chest_upper' for a following
 * incline press, and 'front_delts' work warms 'shoulders'.
 */
export function isMuscleWarmedUp(muscle: string, input: WarmedMusclesInput): boolean {
  if (!muscle) return false;
  const warmed = getWarmedUpMuscles(input);
  const token = normalizeMuscleToken(muscle);
  if (warmed.has(token)) return true;
  for (const warmedMuscle of Array.from(warmed)) {
    if (muscleMatchesGroup(warmedMuscle, token) || muscleMatchesGroup(token, warmedMuscle)) {
      return true;
    }
  }
  return false;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate estimated 1 rep max using multi-formula average
 * Uses shared strength calculations for consistency across the codebase
 * (Brzycki, Epley, Lombardi average for accuracy)
 */
export function calculateE1RM(weight: number, reps: number, rpe: number = 10): number {
  return estimate1RM(weight, reps, rpe);
}

/**
 * Calculate estimated 1 rep max for bodyweight exercises using effective load
 * The effective load accounts for added weight or assistance
 */
export function calculateBodyweightE1RM(set: SetLog): number {
  // Use effective load if available, otherwise fall back to weightKg
  const effectiveLoad = set.bodyweightData?.effectiveLoadKg || set.weightKg;
  const reps = set.reps;
  const rpe = set.rpe;

  return calculateE1RM(effectiveLoad, reps, rpe);
}

/**
 * Calculate relative strength (effective load / bodyweight) for bodyweight exercises
 * This normalizes strength across different bodyweights
 */
export function calculateRelativeStrength(set: SetLog): number {
  if (!set.bodyweightData) return 1;
  const { effectiveLoadKg, userBodyweightKg } = set.bodyweightData;
  if (userBodyweightKg <= 0) return 1;
  return Math.round((effectiveLoadKg / userBodyweightKg) * 100) / 100;
}

/**
 * Extract performance data from completed sets
 * For bodyweight exercises, uses effective load (bodyweight +/- modifications)
 */
export function extractPerformanceFromSets(
  sets: SetLog[],
  exerciseId: string
): LastSessionPerformance | null {
  const workingSets = sets.filter((s) => !s.isWarmup);

  if (workingSets.length === 0) return null;

  // Get top set based on effective load for bodyweight exercises
  const topSet = workingSets.reduce((best, current) => {
    // Use effective load if available (bodyweight exercises), otherwise weight
    const currentLoad = current.bodyweightData?.effectiveLoadKg || current.weightKg;
    const bestLoad = best.bodyweightData?.effectiveLoadKg || best.weightKg;

    if (currentLoad > bestLoad) return current;
    if (currentLoad === bestLoad && current.reps > best.reps) return current;
    return best;
  });

  const averageRpe =
    workingSets.reduce((sum, s) => sum + s.rpe, 0) / workingSets.length;

  // Use effective load for bodyweight exercises
  const weightKg = topSet.bodyweightData?.effectiveLoadKg || topSet.weightKg;

  return {
    exerciseId,
    weightKg,
    reps: topSet.reps,
    rpe: topSet.rpe,
    sets: workingSets.length,
    allSetsCompleted: true, // Would need target to verify
    averageRpe: Math.round(averageRpe * 10) / 10,
  };
}

/**
 * Extract bodyweight-specific performance data from completed sets
 * Returns data needed for bodyweight exercise progression tracking
 */
export function extractBodyweightPerformance(
  sets: SetLog[],
  exerciseId: string
): {
  performance: LastSessionPerformance | null;
  bodyweightData: {
    modification: 'none' | 'weighted' | 'assisted';
    addedWeightKg?: number;
    assistanceWeightKg?: number;
    userBodyweightKg: number;
    effectiveLoadKg: number;
  } | null;
} {
  const performance = extractPerformanceFromSets(sets, exerciseId);

  const workingSets = sets.filter((s) => !s.isWarmup && s.bodyweightData);
  if (workingSets.length === 0) {
    return { performance, bodyweightData: null };
  }

  // Find the top set (same logic as extractPerformanceFromSets)
  const topSet = workingSets.reduce((best, current) => {
    const currentLoad = current.bodyweightData!.effectiveLoadKg;
    const bestLoad = best.bodyweightData!.effectiveLoadKg;

    if (currentLoad > bestLoad) return current;
    if (currentLoad === bestLoad && current.reps > best.reps) return current;
    return best;
  });

  return {
    performance,
    bodyweightData: {
      modification: topSet.bodyweightData!.modification,
      addedWeightKg: topSet.bodyweightData!.addedWeightKg,
      assistanceWeightKg: topSet.bodyweightData!.assistanceWeightKg,
      userBodyweightKg: topSet.bodyweightData!.userBodyweightKg,
      effectiveLoadKg: topSet.bodyweightData!.effectiveLoadKg,
    },
  };
}

// ============================================
// FORM QUALITY DISPLAY + TRENDS
// ============================================

import type {
  FormRating,
  FormTrendWarning,
  SessionFormHistory,
} from '@/types/schema';

// ============================================
// FORM TREND WARNINGS
// ============================================

/**
 * Check for declining form trends across multiple sessions
 */
export function checkFormTrend(
  exerciseHistory: SessionFormHistory[]
): FormTrendWarning | null {
  if (exerciseHistory.length < 3) return null;

  const recentSessions = exerciseHistory.slice(0, 5);

  // Calculate average form score per session
  const formScores = recentSessions.map((session) => {
    const forms = session.sets.map((s) => s.form);
    return calculateAvgFormScore(forms);
  });

  // Declining form trend (each session worse than 2 sessions ago)
  if (
    formScores.length >= 4 &&
    formScores[0] < formScores[2] &&
    formScores[1] < formScores[3]
  ) {
    return {
      type: 'declining_form',
      message: 'Form has been declining over recent sessions',
      suggestion: 'Consider a 10% deload to rebuild movement quality',
      action: 'deload_suggested',
    };
  }

  // Consistently ugly form (3 sessions in a row with avg < 0.5)
  if (
    formScores.length >= 3 &&
    formScores.slice(0, 3).every((s) => s < 0.5)
  ) {
    return {
      type: 'persistent_breakdown',
      message: 'Form breakdown 3 sessions in a row',
      suggestion: 'Weight may be too heavy - recommending 15% reduction',
      action: 'deload_required',
    };
  }

  return null;
}

/**
 * Get form quality label for display
 */
export function getFormLabel(form: FormRating): string {
  switch (form) {
    case 'clean':
      return 'Clean';
    case 'some_breakdown':
      return 'Some Breakdown';
    case 'ugly':
      return 'Form Breakdown';
  }
}

/**
 * Get form quality color class for display
 */
export function getFormColorClass(form: FormRating): string {
  switch (form) {
    case 'clean':
      return 'text-success-400';
    case 'some_breakdown':
      return 'text-warning-400';
    case 'ugly':
      return 'text-danger-400';
  }
}

