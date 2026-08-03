/**
 * Rep Range Engine
 * Calculates optimal rep ranges based on muscle fiber type, periodization phase,
 * exercise position, and training goals.
 */

import type {
  Goal,
  Experience,
  MuscleGroup,
  StandardMuscleGroup,
  MovementPattern,
  PeriodizationModel,
  ExercisePosition,
  DUPDayType,
  FiberType,
  RepRangeConfig,
  RepRangeFactors,
} from '@/types/schema';
import { isStandardMuscle, toLegacyMuscleGroup } from '@/types/schema';

// ============================================================
// MUSCLE FIBER TYPE DATA
// ============================================================

/**
 * Muscle fiber type dominance affects optimal rep ranges:
 * - Fast-twitch dominant muscles respond better to lower reps (heavier loads)
 * - Slow-twitch dominant muscles benefit from higher reps (time under tension)
 *
 * Keyed by the COARSE legacy group. Fine muscles whose composition differs
 * from their coarse parent are handled by STANDARD_MUSCLE_FIBER_OVERRIDES
 * below — read fiber type through `fiberTypeForMuscle`, never from this table
 * directly, or a fine key silently inherits the coarse label.
 */
export const MUSCLE_FIBER_PROFILE: Record<MuscleGroup, FiberType> = {
  chest: 'mixed',
  back: 'mixed',
  shoulders: 'mixed',      // Lateral delts are more slow-twitch
  biceps: 'mixed',
  triceps: 'fast',         // Long head especially
  quads: 'mixed',          // Rectus femoris is faster, vastus are slower
  hamstrings: 'fast',      // Very fast-twitch dominant
  glutes: 'mixed',
  calves: 'slow',          // Notoriously slow-twitch, need high reps
  abs: 'slow',             // Postural muscles, endurance-oriented
  adductors: 'mixed',      // Inner thigh muscles
  forearms: 'slow',        // Grip endurance, need higher reps
  traps: 'mixed',          // Upper back/neck
};

/**
 * Per-STANDARD-muscle fiber overrides, for fine muscles whose composition
 * differs materially from their coarse parent's label.
 *
 * The coarse 'calves' label is 'slow', which is accurate for soleus (~80%+
 * type I) but not for gastrocnemius, which is substantially more mixed. The
 * two heads are programmed separately in this app (straight-knee vs
 * bent-knee), so they should not share one label.
 *
 * soleus is pinned explicitly even though it would inherit 'slow' from
 * 'calves' — the pairing is the point, and an implicit inherit would make the
 * next person wonder whether it was considered.
 */
export const STANDARD_MUSCLE_FIBER_OVERRIDES: Partial<Record<StandardMuscleGroup, FiberType>> = {
  gastrocnemius: 'mixed',
  soleus: 'slow',
};

/** Fallback for tokens that resolve to nothing recognizable. */
export const DEFAULT_FIBER_TYPE: FiberType = 'mixed';

/**
 * THE fiber-type read. Accepts a legacy coarse group, a standard muscle
 * (coarse or fine), or any raw token, and resolves:
 *   1. a fine per-standard override (gastrocnemius, soleus);
 *   2. the standard muscle's coarse parent via toLegacyMuscleGroup;
 *   3. the legacy table directly;
 *   4. DEFAULT_FIBER_TYPE.
 *
 * KNOWN ARCHITECTURAL ISSUE (flagged, not fixed here): this single categorical
 * label drives BOTH rep prescription (calculateRepRange / getDUPRepRange) and
 * recovery decay (fatigueBudgetEngine.calculateRecoveryRate). Those are
 * different physiological claims and should not share one enum. Splitting them
 * belongs with the unified-recovery work tracked separately.
 */
export function fiberTypeForMuscle(muscle: MuscleGroup | StandardMuscleGroup | string): FiberType {
  const token = typeof muscle === 'string' ? muscle.toLowerCase().trim() : '';
  if (!token) return DEFAULT_FIBER_TYPE;

  if (isStandardMuscle(token)) {
    const override = STANDARD_MUSCLE_FIBER_OVERRIDES[token as StandardMuscleGroup];
    if (override) return override;
  }

  const legacy = toLegacyMuscleGroup(token);
  if (legacy) return MUSCLE_FIBER_PROFILE[legacy];

  return (MUSCLE_FIBER_PROFILE as Record<string, FiberType>)[token] ?? DEFAULT_FIBER_TYPE;
}

// ============================================================
// BASE REP RANGES BY GOAL
// ============================================================

const BASE_REP_RANGES: Record<Goal, { compound: [number, number]; isolation: [number, number] }> = {
  cut: {
    compound: [4, 6],      // Preserve strength, heavy loads
    isolation: [8, 12],    // Moderate for muscle preservation
  },
  bulk: {
    compound: [6, 10],     // Hypertrophy-focused
    isolation: [10, 15],   // Higher volume accumulation
  },
  maintenance: {
    compound: [5, 8],      // Balance strength and hypertrophy
    isolation: [8, 12],
  },
  recomp: {
    compound: [5, 8],      // Similar to maintenance - balanced approach
    isolation: [8, 12],
  },
};

// ============================================================
// REP RANGE CALCULATION
// ============================================================

/**
 * Calculate optimal rep range based on comprehensive factors
 */
export function calculateRepRange(factors: RepRangeFactors): RepRangeConfig {
  const isCompound = factors.exercisePattern !== 'isolation';
  const fiberType = fiberTypeForMuscle(factors.muscleGroup);
  
  // Start with base range for goal
  const baseRange = isCompound 
    ? BASE_REP_RANGES[factors.goal].compound 
    : BASE_REP_RANGES[factors.goal].isolation;
  
  let minReps = baseRange[0];
  let maxReps = baseRange[1];
  
  // === FIBER TYPE ADJUSTMENT ===
  switch (fiberType) {
    case 'fast':
      minReps = Math.max(3, minReps - 1);
      maxReps = Math.max(minReps + 2, maxReps - 1);
      break;
    case 'slow':
      minReps += 2;
      maxReps += 3;
      break;
    // 'mixed' - no adjustment
  }
  
  // === EXERCISE POSITION ADJUSTMENT ===
  switch (factors.positionInWorkout) {
    case 'first':
      minReps = Math.max(3, minReps - 1);
      break;
    case 'early':
      break;
    case 'mid':
      minReps += 1;
      maxReps += 1;
      break;
    case 'late':
      minReps += 2;
      maxReps += 2;
      break;
  }
  
  // === PERIODIZATION PHASE ADJUSTMENT ===
  const mesocycleProgress = factors.weekInMesocycle / factors.totalMesocycleWeeks;
  
  switch (factors.periodizationModel) {
    case 'linear':
      if (mesocycleProgress < 0.33) {
        minReps += 2;
        maxReps += 2;
      } else if (mesocycleProgress > 0.66) {
        minReps = Math.max(3, minReps - 1);
        maxReps = Math.max(minReps + 2, maxReps - 1);
      }
      break;
      
    case 'block':
      if (mesocycleProgress < 0.5) {
        // Hypertrophy block
        minReps += 2;
        maxReps += 3;
      } else if (mesocycleProgress < 0.85) {
        // Strength block
        minReps = Math.max(3, minReps - 2);
        maxReps = Math.max(minReps + 2, maxReps - 2);
      } else {
        // Peaking
        minReps = Math.max(1, minReps - 3);
        maxReps = Math.max(minReps + 2, maxReps - 3);
      }
      break;
      
    case 'daily_undulating':
    case 'weekly_undulating':
      // DUP/WUP varies by day, handled separately
      break;
  }
  
  // === EXPERIENCE ADJUSTMENT ===
  if (factors.experience === 'novice') {
    minReps = Math.max(6, minReps);
    maxReps = Math.max(8, maxReps);
  }
  
  // === FINAL BOUNDS CHECK ===
  minReps = Math.max(1, Math.min(20, minReps));
  maxReps = Math.max(minReps + 2, Math.min(25, maxReps));
  
  // === CALCULATE TARGET RIR ===
  let targetRIR: number;
  if (factors.experience === 'novice') {
    targetRIR = 3 - Math.floor(mesocycleProgress * 1.5);  // 3 -> 2
  } else if (factors.experience === 'intermediate') {
    targetRIR = 3 - Math.floor(mesocycleProgress * 2);    // 3 -> 1
  } else {
    targetRIR = 2 - Math.floor(mesocycleProgress * 2);    // 2 -> 0
  }
  targetRIR = Math.max(0, Math.min(4, targetRIR));
  
  // === TEMPO RECOMMENDATION ===
  const tempoRecommendation = getTempoRecommendation(isCompound, factors.goal, mesocycleProgress);
  
  return {
    min: minReps,
    max: maxReps,
    targetRIR,
    tempoRecommendation,
    notes: buildRepRangeNotes(factors, fiberType, targetRIR),
  };
}

/**
 * Get tempo recommendation based on exercise type and goals
 * Format: Eccentric-Pause-Concentric-Pause (e.g., "3-1-1-0")
 */
function getTempoRecommendation(
  isCompound: boolean,
  goal: Goal,
  mesocycleProgress: number
): string {
  if (goal === 'cut') {
    return isCompound ? '2-0-1-0' : '2-1-1-0';
  }
  
  if (goal === 'bulk') {
    if (mesocycleProgress < 0.5) {
      return isCompound ? '3-0-1-1' : '3-1-1-0';
    }
    return isCompound ? '2-0-1-0' : '2-0-1-0';
  }
  
  return '2-0-1-0';
}

/**
 * Build explanatory notes for rep range selection
 */
function buildRepRangeNotes(
  factors: RepRangeFactors,
  fiberType: FiberType,
  targetRIR: number
): string {
  const notes: string[] = [];
  
  if (fiberType === 'fast') {
    notes.push(`${factors.muscleGroup} responds well to heavier loads`);
  } else if (fiberType === 'slow') {
    notes.push(`${factors.muscleGroup} benefits from higher reps and time under tension`);
  }
  
  if (factors.positionInWorkout === 'late') {
    notes.push('Accumulated fatigue - prioritize form over load');
  }
  
  if (targetRIR <= 1) {
    notes.push('High intensity week - push close to failure');
  } else if (targetRIR >= 3) {
    notes.push('Submaximal - focus on movement quality');
  }
  
  return notes.join('. ');
}

// ============================================================
// DUP (DAILY UNDULATING PERIODIZATION) REP RANGES
// ============================================================

const DUP_BASE_RANGES: Record<DUPDayType, { compound: [number, number]; isolation: [number, number] }> = {
  hypertrophy: { compound: [8, 12], isolation: [12, 15] },
  strength: { compound: [4, 6], isolation: [6, 8] },
  power: { compound: [3, 5], isolation: [6, 8] },
};

/**
 * Get rep range for a specific DUP day type
 */
export function getDUPRepRange(
  dayType: DUPDayType,
  isCompound: boolean,
  muscleGroup: MuscleGroup | StandardMuscleGroup
): { min: number; max: number } {
  const fiberType = fiberTypeForMuscle(muscleGroup);
  let range = isCompound ? DUP_BASE_RANGES[dayType].compound : DUP_BASE_RANGES[dayType].isolation;
  
  // Fiber type adjustment
  if (fiberType === 'slow' && dayType === 'hypertrophy') {
    range = [range[0] + 3, range[1] + 4];
  } else if (fiberType === 'fast' && dayType !== 'power') {
    range = [Math.max(3, range[0] - 1), Math.max(5, range[1] - 1)];
  }
  
  return { min: range[0], max: range[1] };
}

/**
 * Get DUP-specific tempo recommendation
 */
export function getDUPTempo(dayType: DUPDayType, isCompound: boolean): string {
  switch (dayType) {
    case 'hypertrophy':
      return isCompound ? '3-0-1-1' : '3-1-1-0';
    case 'strength':
      return '2-1-1-0';
    case 'power':
      return '1-0-X-0';  // X = explosive concentric
  }
}

/**
 * Get DUP-specific rest period
 */
export function getDUPRestPeriod(dayType: DUPDayType, isCompound: boolean): number {
  switch (dayType) {
    case 'hypertrophy':
      return isCompound ? 120 : 75;
    case 'strength':
      return isCompound ? 180 : 120;
    case 'power':
      return isCompound ? 180 : 120;
  }
}

/**
 * Get DUP-specific notes
 */
export function getDUPNotes(dayType: DUPDayType): string {
  switch (dayType) {
    case 'hypertrophy':
      return 'Focus on muscle contraction and time under tension';
    case 'strength':
      return 'Focus on moving heavy weight with good form';
    case 'power':
      return 'Focus on bar speed and explosiveness - stop if speed drops';
  }
}

/**
 * Get target RIR for DUP day type
 */
export function getDUPTargetRIR(dayType: DUPDayType): number {
  switch (dayType) {
    case 'hypertrophy':
      return 2;
    case 'strength':
      return 1;
    case 'power':
      return 2;  // Power work shouldn't be to failure
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Convert exercise position number to category
 */
export function getPositionCategory(
  position: number,
  totalExercises: number
): ExercisePosition {
  if (position === 1) return 'first';
  const relativePosition = position / totalExercises;
  if (relativePosition < 0.33) return 'early';
  if (relativePosition < 0.66) return 'mid';
  return 'late';
}

/**
 * Rep-range config for a DURATION exercise: a passthrough of the exercise's
 * own seconds range. Duration ranges must NEVER be routed through
 * calculateRepRange — its final bounds check clamps into rep-count territory
 * (≤25), which would destroy a 30–60s time target.
 */
export function durationRepRangeConfig(exercise: {
  defaultRepRange?: [number, number];
  defaultRir?: number;
}): RepRangeConfig {
  const [min, max] = exercise.defaultRepRange ?? [30, 60];
  return {
    min,
    max,
    targetRIR: exercise.defaultRir ?? 2,
    tempoRecommendation: 'Steady, braced hold — no sagging or shifting',
    notes: 'Timed exercise — range is seconds, not reps',
  };
}

/**
 * Format rep range as string. Pass isDuration for timed exercises (the range
 * is seconds).
 */
export function formatRepRange(config: RepRangeConfig, isDuration = false): string {
  const rirText = config.targetRIR === 0
    ? 'to failure'
    : `${config.targetRIR} RIR (RPE ${10 - config.targetRIR})`;

  return isDuration
    ? `${config.min}-${config.max}s hold @ ${rirText}`
    : `${config.min}-${config.max} reps @ ${rirText}`;
}

/**
 * Build load guidance string. Pass isDuration for timed exercises.
 */
export function buildLoadGuidance(
  reps: RepRangeConfig,
  weekFocus?: string,
  isDuration = false
): string {
  const rirText = reps.targetRIR === 0
    ? 'to failure'
    : `${reps.targetRIR} RIR (RPE ${10 - reps.targetRIR})`;

  const tempoText = reps.tempoRecommendation
    ? `Tempo: ${reps.tempoRecommendation}`
    : '';

  const rangeText = isDuration ? `${reps.min}-${reps.max}s hold` : `${reps.min}-${reps.max} reps`;
  return `${rangeText} @ ${rirText}. ${tempoText}`.trim();
}

