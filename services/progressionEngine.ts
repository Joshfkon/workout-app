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
  ProgressionTargets,
  LastSessionPerformance,
  WarmupSet,
  MovementPattern,
  Equipment,
} from '@/types/schema';
import { roundToIncrement, estimateE1RM } from '@/lib/utils';

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
  // Guard against a non-positive mesocycle length (avoids divide-by-zero /
  // NaN progress). Treat it as the deload/terminal phase.
  if (totalWeeks <= 0) return 'deload';

  const progress = weekInMeso / totalWeeks;

  // Deload is always the last week (or beyond, defensively)
  if (weekInMeso >= totalWeeks) return 'deload';
  
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


/**
 * Adjust progression based on accumulated fatigue
 */
export function adjustForFatigue(
  targets: ProgressionTargets,
  weeklyFatigueScore: number,
  systemicFatiguePercent: number
): ProgressionTargets {
  // High systemic fatigue = more conservative progression
  if (systemicFatiguePercent > 80) {
    return {
      ...targets,
      targetRir: Math.min(4, targets.targetRir + 1),
      reason: targets.reason + ' (adjusted for high systemic fatigue)',
    };
  }
  
  // If weekly fatigue trending up, hold back
  if (weeklyFatigueScore > 7) {
    return {
      ...targets,
      progressionType: 'technique',
      reason: 'High fatigue score - maintaining to allow recovery',
    };
  }
  
  // Moderate fatigue warning
  if (systemicFatiguePercent > 60 || weeklyFatigueScore > 5) {
    return {
      ...targets,
      reason: targets.reason + ' (monitor fatigue levels)',
    };
  }
  
  return targets;
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
  return sets.filter((set) => !set.isWarmup && set.rpe <= SET_QUALITY_THRESHOLDS.junk.maxRpe);
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

  // Set 1: Empty bar or very light (if first exercise, add general warmup)
  if (isFirstExercise) {
    protocol.push({
      setNumber: 1,
      percentOfWorking: 0,
      targetReps: 10,
      purpose: 'General warmup',
      restSeconds: 30,
    });
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
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate estimated 1 rep max using Epley formula
 */
export function calculateE1RM(weight: number, reps: number, rpe: number = 10): number {
  // Delegate to the canonical estimator (Epley + RIR, with rep clamping).
  const rir = 10 - rpe;
  return estimateE1RM(weight, reps, rir);
}

/**
 * Calculate estimated 1 rep max for bodyweight exercises using effective load
 * The effective load accounts for added weight or assistance
 */
export function calculateBodyweightE1RM(set: SetLog): number {
  // Use effective load if available, otherwise fall back to weightKg
  const effectiveLoad = set.bodyweightData?.effectiveLoadKg ?? set.weightKg;
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


// ============================================
// PR (PERSONAL RECORD) LOGIC WITH FORM QUALITY
// ============================================

import type {
  PRResult,
  PRCriteria,
  FormRating,
  RepsInTank,
  WeightSuggestion,
  FormTrendWarning,
  SessionFormHistory,
} from '@/types/schema';

/**
 * Check if a performance qualifies as a Personal Record
 * PRs with ugly form are NOT counted
 */
export function checkForPR(
  current: PRCriteria,
  previousPR: PRCriteria | null
): PRResult {
  // Calculate E1RM for comparison
  const currentE1RM = calculateE1RM(
    current.weight,
    current.reps,
    current.repsInTank === 4 ? 6 : current.repsInTank === 2 ? 7.5 : current.repsInTank === 1 ? 9 : 10
  );

  // First time doing this exercise
  if (!previousPR) {
    // Even first time, ugly form doesn't count as PR
    if (current.form === 'ugly') {
      return {
        isPR: false,
        reason: 'form_breakdown',
        message: 'First attempt recorded. Work on form before setting your PR baseline.',
      };
    }
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'first_time',
      message: 'First PR set! Great starting point.',
    };
  }

  const previousE1RM = calculateE1RM(
    previousPR.weight,
    previousPR.reps,
    previousPR.repsInTank === 4 ? 6 : previousPR.repsInTank === 2 ? 7.5 : previousPR.repsInTank === 1 ? 9 : 10
  );

  // NO PR if form was ugly
  if (current.form === 'ugly') {
    return {
      isPR: false,
      reason: 'form_breakdown',
      message: 'Great effort! Not counted as PR due to form breakdown.',
    };
  }

  // Form PR: Same or better performance with cleaner form
  if (
    current.form === 'clean' &&
    previousPR.form !== 'clean' &&
    currentE1RM >= previousE1RM * 0.95
  ) {
    return {
      isPR: true,
      type: 'form',
      reason: 'new_pr',
      message: 'Form PR! Same weight with cleaner technique.',
    };
  }

  // Require same or better form to count as PR
  if (current.form === 'some_breakdown' && previousPR.form === 'clean') {
    const improvement = (currentE1RM - previousE1RM) / previousE1RM;
    if (improvement < 0.05) {
      return {
        isPR: false,
        reason: 'form_regression',
        message: 'Matched previous PR but with less clean form.',
      };
    }
    // Significant improvement overcomes form regression
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'new_pr',
      message: `New PR! +${Math.round(improvement * 100)}% despite some form breakdown.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Standard PR logic for E1RM
  if (currentE1RM > previousE1RM) {
    const improvement = (currentE1RM - previousE1RM) / previousE1RM;
    return {
      isPR: true,
      type: 'e1rm',
      reason: 'new_pr',
      message: `New PR! +${Math.round(improvement * 100)}% improvement.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Weight PR (heavier weight even with fewer reps).
  // Require the estimated 1RM not to regress, otherwise a much heavier single
  // at far fewer reps would falsely register as a PR over a strong rep set.
  if (
    current.weight > previousPR.weight &&
    current.reps >= previousPR.reps * 0.7 &&
    currentE1RM >= previousE1RM
  ) {
    const improvement = (current.weight - previousPR.weight) / previousPR.weight;
    return {
      isPR: true,
      type: 'weight',
      reason: 'new_pr',
      message: `Weight PR! +${Math.round(improvement * 100)}% heavier.`,
      improvement: Math.round(improvement * 100),
    };
  }

  // Reps PR (more reps at same or higher weight)
  if (current.weight >= previousPR.weight && current.reps > previousPR.reps) {
    return {
      isPR: true,
      type: 'reps',
      reason: 'new_pr',
      message: `Rep PR! +${current.reps - previousPR.reps} more reps.`,
      improvement: current.reps - previousPR.reps,
    };
  }

  return {
    isPR: false,
    reason: 'not_better',
    message: 'Good set! Keep pushing for that PR.',
  };
}

// ============================================
// WEIGHT SUGGESTION WITH FORM QUALITY
// ============================================

export interface FormAwareProgressionInput {
  lastSession: {
    weight: number;
    reps: number[];
    repsInTank: RepsInTank[];
    form: FormRating[];
  };
  targetRepRange: [number, number];
  targetRIR: number;
  exerciseMinIncrement: number;
}

/**
 * Calculate suggested weight factoring in form quality
 */
export function calculateSuggestedWeight(
  input: FormAwareProgressionInput
): WeightSuggestion {
  const { lastSession, targetRepRange, targetRIR, exerciseMinIncrement } = input;

  // Import form score calculation
  const formScoreHelper = (form: FormRating): number => {
    switch (form) {
      case 'clean':
        return 1.0;
      case 'some_breakdown':
        return 0.5;
      case 'ugly':
        return 0;
    }
  };

  const avgForm =
    lastSession.form.reduce((sum, f) => sum + formScoreHelper(f), 0) / lastSession.form.length;
  const avgRIR =
    lastSession.repsInTank.reduce((sum: number, r: number) => sum + r, 0) / lastSession.repsInTank.length;
  const avgReps = lastSession.reps.reduce((sum, r) => sum + r, 0) / lastSession.reps.length;

  // FORM REGRESSION: Suggest lower weight (avg form < 0.5 means mostly ugly/some breakdown)
  if (avgForm < 0.5) {
    return {
      weight: roundToIncrement(lastSession.weight * 0.9, exerciseMinIncrement),
      reason: 'form_correction',
      message: 'Reducing weight to rebuild clean form',
      confidence: 'high',
    };
  }

  // FORM BREAKDOWN: Hold weight, don't progress (0.5 <= avgForm < 0.8)
  if (avgForm < 0.8) {
    return {
      weight: lastSession.weight,
      reason: 'form_consolidation',
      message: 'Same weight - focus on cleaner reps before progressing',
      confidence: 'high',
    };
  }

  // CLEAN FORM + TOO EASY: Progress (avgRIR > targetRIR + 1)
  if (avgForm >= 0.8 && avgRIR > targetRIR + 1) {
    return {
      weight: roundToIncrement(lastSession.weight + exerciseMinIncrement, exerciseMinIncrement),
      reason: 'progression',
      message: 'Clean form and reps in tank - time to progress!',
      confidence: 'high',
    };
  }

  // CLEAN FORM + ON TARGET: Maintain
  if (avgForm >= 0.8 && avgRIR >= targetRIR - 0.5 && avgRIR <= targetRIR + 1) {
    return {
      weight: lastSession.weight,
      reason: 'on_target',
      message: 'Perfect - stay here until it feels easier',
      confidence: 'high',
    };
  }

  // CLEAN FORM + TOO HARD: Reduce slightly
  if (avgForm >= 0.8 && avgRIR < targetRIR - 0.5) {
    return {
      weight: roundToIncrement(lastSession.weight * 0.95, exerciseMinIncrement),
      reason: 'intensity_reduction',
      message: 'Reps were harder than target - slight reduction',
      confidence: 'medium',
    };
  }

  // Default: maintain weight
  return {
    weight: lastSession.weight,
    reason: 'on_target',
    message: 'Continue at current weight',
    confidence: 'medium',
  };
}

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
  const formScoreHelper = (form: FormRating): number => {
    switch (form) {
      case 'clean':
        return 1.0;
      case 'some_breakdown':
        return 0.5;
      case 'ugly':
        return 0;
    }
  };

  const formScores = recentSessions.map((session) => {
    const forms = session.sets.map((s) => s.form);
    return forms.reduce((sum, f) => sum + formScoreHelper(f), 0) / forms.length;
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

