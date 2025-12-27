/**
 * Set Prescription Engine
 *
 * Determines set types (AMRAP vs fixed reps), RIR targets, and display text
 * based on exercise safety tiers and mesocycle context.
 *
 * Pure functions - no database calls.
 */

import {
  type FailureSafetyTier,
  getFailureSafetyTier,
  getRIRFloor,
} from './exerciseSafety';

// ============================================
// TYPES
// ============================================

/**
 * Context for prescribing a set
 */
export interface SetPrescriptionContext {
  /** Which set number this is (1-indexed) */
  setNumber: number;
  /** Total planned sets for this exercise */
  totalSets: number;
  /** Is this the last week of the mesocycle? */
  isMesocycleEnd: boolean;
  /** Is this the first week after a deload? */
  isReturnFromDeload: boolean;
  /** Is this the first time doing this exercise? */
  isFirstTimeExercise: boolean;
  /** Had an AMRAP for this exercise in last 2 weeks */
  hasRecentAMRAP: boolean;
  /** Current week in mesocycle (1-indexed) */
  weekInMeso?: number;
  /** Total weeks in mesocycle */
  totalWeeksInMeso?: number;
}

/**
 * The result of prescribing a set
 */
export interface SetPrescription {
  /** Target rep range - max is null for AMRAP */
  targetReps: { min: number; max: number | null };
  /** Is this an AMRAP (As Many Reps As Possible) set? */
  isAMRAP: boolean;
  /** Minimum RIR floor for safety */
  rirFloor: number;
  /** Text to display to user (e.g., "8-12 reps @ 2 RIR") */
  displayText: string;
  /** Optional instructions for the user */
  instructions?: string;
  /** Safety tier of the exercise */
  safetyTier: FailureSafetyTier;
  /** Whether to show calibration prompt after this set */
  showCalibrationPrompt?: boolean;
}

/**
 * Base rep range input
 */
export interface RepRange {
  min: number;
  max: number;
}

// ============================================
// MAIN PRESCRIPTION LOGIC
// ============================================

/**
 * Prescribe the type and targets for a set
 *
 * Decision tree:
 * 1. Is this the last set? If not, use standard prescription
 * 2. If last set, check safety tier:
 *    - push_freely + no recent AMRAP = AMRAP
 *    - push_cautiously + (mesocycle end OR deload return) = AMRAP
 *    - protect = never AMRAP
 * 3. First time exercise on safe tiers = AMRAP (to establish baseline)
 */
export function prescribeSetType(
  exerciseName: string,
  baseRepRange: RepRange,
  baseRIR: number,
  context: SetPrescriptionContext
): SetPrescription {
  const tier = getFailureSafetyTier(exerciseName);
  const rirFloor = getRIRFloor(exerciseName);
  const isLastSet = context.setNumber === context.totalSets;

  // Determine if this should be AMRAP
  let shouldAMRAP = false;
  let amrapReason = '';

  if (isLastSet) {
    if (tier === 'push_freely' && !context.hasRecentAMRAP) {
      shouldAMRAP = true;
      amrapReason = 'calibration';
    } else if (tier === 'push_cautiously' && (context.isMesocycleEnd || context.isReturnFromDeload)) {
      shouldAMRAP = true;
      amrapReason = context.isMesocycleEnd ? 'mesocycle_end' : 'deload_return';
    } else if (context.isFirstTimeExercise && tier !== 'protect') {
      shouldAMRAP = true;
      amrapReason = 'first_time';
    }
  }

  // Calculate effective RIR (never go below floor)
  const effectiveRIR = Math.max(baseRIR, rirFloor);

  if (shouldAMRAP) {
    return createAMRAPPrescription(baseRepRange, tier, rirFloor, amrapReason);
  }

  return createStandardPrescription(baseRepRange, effectiveRIR, tier, rirFloor);
}

/**
 * Create an AMRAP set prescription
 */
function createAMRAPPrescription(
  baseRepRange: RepRange,
  tier: FailureSafetyTier,
  rirFloor: number,
  reason: string
): SetPrescription {
  const instructions = tier === 'push_freely'
    ? 'Push to true failure - stop when form breaks down. This calibrates your RPE.'
    : 'Push hard but keep 1 clean rep in the tank.';

  const displayText = `${baseRepRange.min}+ reps`;

  return {
    targetReps: { min: baseRepRange.min, max: null },
    isAMRAP: true,
    rirFloor,
    displayText,
    instructions,
    safetyTier: tier,
    showCalibrationPrompt: reason === 'calibration' || reason === 'first_time',
  };
}

/**
 * Create a standard (non-AMRAP) set prescription
 */
function createStandardPrescription(
  baseRepRange: RepRange,
  effectiveRIR: number,
  tier: FailureSafetyTier,
  rirFloor: number
): SetPrescription {
  const displayText = `${baseRepRange.min}-${baseRepRange.max} reps @ ${effectiveRIR} RIR`;

  const instructions = rirFloor >= 2
    ? `Keep ${rirFloor}+ reps in reserve. High injury risk at failure.`
    : undefined;

  return {
    targetReps: { min: baseRepRange.min, max: baseRepRange.max },
    isAMRAP: false,
    rirFloor,
    displayText,
    instructions,
    safetyTier: tier,
  };
}

// ============================================
// PRESCRIPTION HELPERS
// ============================================

/**
 * Determine if a set should use AMRAP based on calibration needs
 */
export function needsCalibration(
  exerciseName: string,
  daysSinceLastAMRAP: number | null,
  hasCalibrationData: boolean
): boolean {
  const tier = getFailureSafetyTier(exerciseName);

  // Protected exercises never need calibration via AMRAP
  if (tier === 'protect') return false;

  // No calibration data = needs calibration
  if (!hasCalibrationData) return true;

  // For safe exercises, recalibrate every 2 weeks
  if (tier === 'push_freely') {
    return daysSinceLastAMRAP === null || daysSinceLastAMRAP >= 14;
  }

  // For cautious exercises, recalibrate every 4 weeks
  if (tier === 'push_cautiously') {
    return daysSinceLastAMRAP === null || daysSinceLastAMRAP >= 28;
  }

  return false;
}

/**
 * Get the recommended AMRAP frequency for an exercise
 */
export function getAMRAPFrequency(exerciseName: string): {
  frequencyDays: number;
  description: string;
} {
  const tier = getFailureSafetyTier(exerciseName);

  switch (tier) {
    case 'push_freely':
      return {
        frequencyDays: 14,
        description: 'Every 2 weeks for calibration',
      };
    case 'push_cautiously':
      return {
        frequencyDays: 28,
        description: 'Once per mesocycle (usually at end)',
      };
    case 'protect':
      return {
        frequencyDays: Infinity,
        description: 'Never - use sub-maximal estimation',
      };
  }
}

/**
 * Calculate the target RIR for a set based on position and phase
 */
export function calculateTargetRIR(
  baseRIR: number,
  setNumber: number,
  totalSets: number,
  weekInMeso: number,
  totalWeeks: number
): number {
  // Progressive intensity within workout - last sets can be harder
  const setProgressionAdjustment = setNumber === totalSets ? -0.5 : 0;

  // Progressive intensity within mesocycle - later weeks push harder
  const weekProgress = (weekInMeso - 1) / Math.max(1, totalWeeks - 1);
  const weekProgressionAdjustment = -Math.floor(weekProgress * 1.5);

  const adjustedRIR = baseRIR + setProgressionAdjustment + weekProgressionAdjustment;

  // Clamp between 0 and 4
  return Math.max(0, Math.min(4, Math.round(adjustedRIR)));
}

/**
 * Format a rep range for display
 */
export function formatRepRange(repRange: { min: number; max: number | null }): string {
  if (repRange.max === null) {
    return `${repRange.min}+`;
  }
  if (repRange.min === repRange.max) {
    return `${repRange.min}`;
  }
  return `${repRange.min}-${repRange.max}`;
}

/**
 * Format a set prescription for display in the UI
 */
export function formatPrescriptionDisplay(prescription: SetPrescription): {
  repText: string;
  rirText: string;
  fullText: string;
} {
  const repText = formatRepRange(prescription.targetReps);

  const rirText = prescription.isAMRAP
    ? 'AMRAP'
    : `${prescription.rirFloor} RIR`;

  const fullText = prescription.displayText;

  return { repText, rirText, fullText };
}

// ============================================
// BATCH PRESCRIPTION
// ============================================

/**
 * Generate prescriptions for all sets in an exercise block
 */
export function prescribeExerciseBlock(
  exerciseName: string,
  totalSets: number,
  baseRepRange: RepRange,
  baseRIR: number,
  context: Omit<SetPrescriptionContext, 'setNumber' | 'totalSets'>
): SetPrescription[] {
  const prescriptions: SetPrescription[] = [];

  for (let i = 1; i <= totalSets; i++) {
    const prescription = prescribeSetType(exerciseName, baseRepRange, baseRIR, {
      ...context,
      setNumber: i,
      totalSets,
    });
    prescriptions.push(prescription);
  }

  return prescriptions;
}

/**
 * Check if any set in the block is AMRAP
 */
export function blockHasAMRAP(prescriptions: SetPrescription[]): boolean {
  return prescriptions.some(p => p.isAMRAP);
}

/**
 * Get summary statistics for a prescribed exercise block
 */
export function getBlockSummary(prescriptions: SetPrescription[]): {
  totalSets: number;
  amrapSets: number;
  standardSets: number;
  safetyTier: FailureSafetyTier;
  averageRIR: number;
} {
  const amrapSets = prescriptions.filter(p => p.isAMRAP).length;
  const standardSets = prescriptions.length - amrapSets;

  // Average RIR excludes AMRAP sets
  const standardPrescriptions = prescriptions.filter(p => !p.isAMRAP);
  const averageRIR = standardPrescriptions.length > 0
    ? standardPrescriptions.reduce((sum, p) => sum + p.rirFloor, 0) / standardPrescriptions.length
    : 0;

  return {
    totalSets: prescriptions.length,
    amrapSets,
    standardSets,
    safetyTier: prescriptions[0]?.safetyTier ?? 'push_freely',
    averageRIR,
  };
}
