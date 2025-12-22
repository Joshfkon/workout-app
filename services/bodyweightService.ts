/**
 * Bodyweight Exercise Service
 *
 * Handles bodyweight-specific calculations, progression tracking,
 * and PR detection for bodyweight exercises.
 */

import type {
  BodyweightData,
  BodyweightModification,
  BodyweightPR,
  BodyweightProgressionMetrics,
  BodyweightProgressionSuggestion,
  BodyweightChangeContext,
  SetLog,
  BandAssistance,
} from '@/types/schema';
import {
  calculateEffectiveLoad,
  calculatePercentBodyweight,
  BAND_ASSISTANCE_PRESETS,
  getBandAssistanceKg,
} from '@/types/schema';
import { convertWeight } from '@/lib/utils';

// Re-export for convenience
export {
  calculateEffectiveLoad,
  calculatePercentBodyweight,
  BAND_ASSISTANCE_PRESETS,
  getBandAssistanceKg,
};

// ============================================
// BODYWEIGHT DATA CREATION
// ============================================

/**
 * Create bodyweight data for a set
 */
export function createBodyweightData(
  userBodyweightKg: number,
  modification: BodyweightModification,
  options?: {
    addedWeightKg?: number;
    assistanceWeightKg?: number;
    assistanceType?: 'machine' | 'band' | 'partner';
    bandColor?: BandAssistance['color'];
  }
): BodyweightData {
  const effectiveLoadKg = calculateEffectiveLoad(
    userBodyweightKg,
    modification,
    options?.addedWeightKg,
    options?.assistanceWeightKg
  );

  return {
    userBodyweightKg,
    modification,
    addedWeightKg: options?.addedWeightKg,
    assistanceWeightKg: options?.assistanceWeightKg,
    assistanceType: options?.assistanceType,
    bandColor: options?.bandColor,
    effectiveLoadKg,
  };
}

/**
 * Create pure bodyweight data (no modification)
 */
export function createPureBodyweightData(userBodyweightKg: number): BodyweightData {
  return createBodyweightData(userBodyweightKg, 'none');
}

/**
 * Create weighted bodyweight data
 */
export function createWeightedBodyweightData(
  userBodyweightKg: number,
  addedWeightKg: number
): BodyweightData {
  return createBodyweightData(userBodyweightKg, 'weighted', { addedWeightKg });
}

/**
 * Create assisted bodyweight data
 */
export function createAssistedBodyweightData(
  userBodyweightKg: number,
  assistanceWeightKg: number,
  assistanceType: 'machine' | 'band' | 'partner',
  bandColor?: BandAssistance['color']
): BodyweightData {
  return createBodyweightData(userBodyweightKg, 'assisted', {
    assistanceWeightKg,
    assistanceType,
    bandColor,
  });
}

// ============================================
// FORMATTING AND DISPLAY
// ============================================

/**
 * Format bodyweight display for compact set rows
 * Returns strings like "BW (176.6)", "BW+25", "BW-30"
 */
export function formatBodyweightCompact(
  bodyweightData: BodyweightData,
  unit: 'kg' | 'lb' = 'kg'
): string {
  const { userBodyweightKg, modification, addedWeightKg, assistanceWeightKg } = bodyweightData;
  const bw = convertWeight(userBodyweightKg, 'kg', unit);

  switch (modification) {
    case 'none':
      return `BW (${bw.toFixed(1)})`;
    case 'weighted': {
      const added = convertWeight(addedWeightKg || 0, 'kg', unit);
      return `BW+${added.toFixed(0)}`;
    }
    case 'assisted': {
      const assist = convertWeight(assistanceWeightKg || 0, 'kg', unit);
      return `BW-${assist.toFixed(0)}`;
    }
  }
}

/**
 * Format bodyweight display with total
 * Returns strings like "BW + 25 = 201.6"
 */
export function formatBodyweightWithTotal(
  bodyweightData: BodyweightData,
  unit: 'kg' | 'lb' = 'kg'
): string {
  const { userBodyweightKg, modification, addedWeightKg, assistanceWeightKg, effectiveLoadKg } = bodyweightData;
  const bw = convertWeight(userBodyweightKg, 'kg', unit);
  const effective = convertWeight(effectiveLoadKg, 'kg', unit);

  switch (modification) {
    case 'none':
      return `BW (${bw.toFixed(1)})`;
    case 'weighted': {
      const added = convertWeight(addedWeightKg || 0, 'kg', unit);
      return `BW + ${added.toFixed(0)} = ${effective.toFixed(1)}`;
    }
    case 'assisted': {
      const assist = convertWeight(assistanceWeightKg || 0, 'kg', unit);
      return `BW - ${assist.toFixed(0)} = ${effective.toFixed(1)}`;
    }
  }
}

/**
 * Get display breakdown for bodyweight exercise
 * Returns an array of label/value pairs for detailed display
 */
export function getBodyweightBreakdown(
  bodyweightData: BodyweightData,
  unit: 'kg' | 'lb' = 'kg'
): { label: string; value: string; type: 'bw' | 'add' | 'assist' | 'total' | 'percent' }[] {
  const { userBodyweightKg, modification, addedWeightKg, assistanceWeightKg, effectiveLoadKg } = bodyweightData;
  const breakdown: { label: string; value: string; type: 'bw' | 'add' | 'assist' | 'total' | 'percent' }[] = [];

  const bw = convertWeight(userBodyweightKg, 'kg', unit);
  breakdown.push({ label: 'BW', value: `${bw.toFixed(1)} ${unit}`, type: 'bw' });

  if (modification === 'weighted' && addedWeightKg) {
    const added = convertWeight(addedWeightKg, 'kg', unit);
    breakdown.push({ label: 'Added', value: `+ ${added.toFixed(1)} ${unit}`, type: 'add' });
  }

  if (modification === 'assisted' && assistanceWeightKg) {
    const assist = convertWeight(assistanceWeightKg, 'kg', unit);
    breakdown.push({ label: 'Assistance', value: `- ${assist.toFixed(1)} ${unit}`, type: 'assist' });
  }

  const effective = convertWeight(effectiveLoadKg, 'kg', unit);
  breakdown.push({ label: 'Total', value: `${effective.toFixed(1)} ${unit}`, type: 'total' });

  const percent = calculatePercentBodyweight(effectiveLoadKg, userBodyweightKg);
  breakdown.push({ label: 'Of BW', value: `${percent}%`, type: 'percent' });

  return breakdown;
}

// ============================================
// PROGRESSION TRACKING
// ============================================

/**
 * Analyze bodyweight exercise progression over time
 */
export function analyzeBodyweightProgression(
  setHistory: SetLog[]
): BodyweightProgressionMetrics {
  const setsWithData = setHistory.filter(s => s.bodyweightData);

  const weightedSets = setsWithData.filter(s => s.bodyweightData?.modification === 'weighted');
  const assistedSets = setsWithData.filter(s => s.bodyweightData?.modification === 'assisted');

  return {
    addedWeightProgression: weightedSets.map(s => s.bodyweightData!.addedWeightKg || 0),
    assistanceReduction: assistedSets.map(s => s.bodyweightData!.assistanceWeightKg || 0),
    effectiveLoadProgression: setsWithData.map(s => s.bodyweightData!.effectiveLoadKg),
    percentBodyweightProgression: setsWithData.map(s => {
      const bd = s.bodyweightData!;
      return calculatePercentBodyweight(bd.effectiveLoadKg, bd.userBodyweightKg);
    }),
  };
}

/**
 * Suggest next progression for bodyweight exercise
 */
export function suggestBodyweightProgression(
  recentSets: SetLog[],
  userBodyweightKg: number
): BodyweightProgressionSuggestion {
  if (recentSets.length === 0) {
    return {
      type: 'maintain',
      message: 'Start with bodyweight',
      suggestion: 'Begin with pure bodyweight to establish baseline',
    };
  }

  const lastSet = recentSets[recentSets.length - 1];
  const modification = lastSet.bodyweightData?.modification || 'none';
  const avgReps = recentSets.reduce((sum, s) => sum + s.reps, 0) / recentSets.length;

  // Assisted progression
  if (modification === 'assisted') {
    const currentAssistance = lastSet.bodyweightData?.assistanceWeightKg || 0;

    if (avgReps >= 10) {
      const newAssistance = Math.max(0, currentAssistance - 5);

      if (newAssistance === 0) {
        return {
          type: 'graduate',
          message: 'Ready to try unassisted!',
          suggestion: 'Try bodyweight only for your first set',
          suggestedValue: 0,
        };
      }

      return {
        type: 'reduce_assistance',
        message: `Reduce assistance to ${newAssistance} kg`,
        suggestion: `You've been hitting ${avgReps.toFixed(0)} reps consistently`,
        suggestedValue: newAssistance,
      };
    }
  }

  // Pure bodyweight progression
  if (modification === 'none') {
    if (avgReps >= 12) {
      return {
        type: 'add_weight',
        message: 'Ready to add weight!',
        suggestion: 'Try BW + 5 kg',
        suggestedValue: 5,
      };
    }
  }

  // Weighted progression
  if (modification === 'weighted') {
    const currentAdded = lastSet.bodyweightData?.addedWeightKg || 0;

    if (avgReps >= 8) {
      const newAdded = currentAdded + 2.5;
      return {
        type: 'increase_weight',
        message: `Increase to BW + ${newAdded} kg`,
        suggestion: 'Solid reps at current weight',
        suggestedValue: newAdded,
      };
    }
  }

  return {
    type: 'maintain',
    message: 'Keep current load',
    suggestion: 'Focus on adding reps',
  };
}

// ============================================
// PR TRACKING
// ============================================

/**
 * Calculate bodyweight PRs from set history
 */
export function calculateBodyweightPRs(setHistory: SetLog[]): BodyweightPR[] {
  const prs: BodyweightPR[] = [];
  const setsWithData = setHistory.filter(s => s.bodyweightData);

  // Weighted PR: highest added weight
  const weightedSets = setsWithData.filter(s => s.bodyweightData?.modification === 'weighted');
  if (weightedSets.length > 0) {
    const maxWeighted = weightedSets.reduce((max, s) =>
      (s.bodyweightData!.addedWeightKg || 0) > (max.bodyweightData?.addedWeightKg || 0) ? s : max
    );
    prs.push({
      type: 'weighted',
      maxAddedWeightKg: maxWeighted.bodyweightData!.addedWeightKg,
      maxAddedWeightReps: maxWeighted.reps,
      maxEffectiveLoadKg: maxWeighted.bodyweightData!.effectiveLoadKg,
      maxEffectiveLoadReps: maxWeighted.reps,
      bodyweightAtPRKg: maxWeighted.bodyweightData!.userBodyweightKg,
      date: maxWeighted.loggedAt,
    });
  }

  // Assisted PR: lowest assistance (most progress toward unassisted)
  const assistedSets = setsWithData.filter(s => s.bodyweightData?.modification === 'assisted');
  if (assistedSets.length > 0) {
    const minAssisted = assistedSets.reduce((min, s) =>
      (s.bodyweightData!.assistanceWeightKg || Infinity) < (min.bodyweightData?.assistanceWeightKg || Infinity)
        ? s
        : min
    );
    prs.push({
      type: 'assisted',
      minAssistanceWeightKg: minAssisted.bodyweightData!.assistanceWeightKg,
      minAssistanceReps: minAssisted.reps,
      maxEffectiveLoadKg: minAssisted.bodyweightData!.effectiveLoadKg,
      maxEffectiveLoadReps: minAssisted.reps,
      bodyweightAtPRKg: minAssisted.bodyweightData!.userBodyweightKg,
      date: minAssisted.loggedAt,
    });
  }

  // Pure BW PR: most reps
  const pureSets = setsWithData.filter(s => s.bodyweightData?.modification === 'none');
  if (pureSets.length > 0) {
    const maxReps = pureSets.reduce((max, s) => (s.reps > max.reps ? s : max));
    prs.push({
      type: 'pure_reps',
      maxReps: maxReps.reps,
      maxEffectiveLoadKg: maxReps.bodyweightData!.effectiveLoadKg,
      maxEffectiveLoadReps: maxReps.reps,
      bodyweightAtPRKg: maxReps.bodyweightData!.userBodyweightKg,
      date: maxReps.loggedAt,
    });
  }

  return prs;
}

/**
 * Check if a set is a new PR
 */
export function isBodyweightPR(
  newSet: SetLog,
  existingPRs: BodyweightPR[]
): { isPR: boolean; type?: 'weighted' | 'assisted' | 'pure_reps'; improvement?: number } {
  const bd = newSet.bodyweightData;
  if (!bd) return { isPR: false };

  if (bd.modification === 'weighted') {
    const existingWeightedPR = existingPRs.find(p => p.type === 'weighted');
    const currentAdded = bd.addedWeightKg || 0;
    const previousAdded = existingWeightedPR?.maxAddedWeightKg || 0;

    if (currentAdded > previousAdded) {
      return {
        isPR: true,
        type: 'weighted',
        improvement: currentAdded - previousAdded,
      };
    }
  }

  if (bd.modification === 'assisted') {
    const existingAssistedPR = existingPRs.find(p => p.type === 'assisted');
    const currentAssist = bd.assistanceWeightKg || Infinity;
    const previousAssist = existingAssistedPR?.minAssistanceWeightKg || Infinity;

    if (currentAssist < previousAssist) {
      return {
        isPR: true,
        type: 'assisted',
        improvement: previousAssist - currentAssist,
      };
    }
  }

  if (bd.modification === 'none') {
    const existingPureRepsPR = existingPRs.find(p => p.type === 'pure_reps');
    const previousReps = existingPureRepsPR?.maxReps || 0;

    if (newSet.reps > previousReps) {
      return {
        isPR: true,
        type: 'pure_reps',
        improvement: newSet.reps - previousReps,
      };
    }
  }

  return { isPR: false };
}

// ============================================
// E1RM CALCULATIONS
// ============================================

/**
 * Calculate E1RM for bodyweight exercises using effective load
 */
export function calculateBodyweightE1RM(set: SetLog): number {
  const effectiveLoad = set.bodyweightData?.effectiveLoadKg || set.weightKg;
  const reps = set.reps;

  if (reps === 1) return effectiveLoad;
  if (reps > 12) return effectiveLoad * (1 + reps / 40);

  // Epley formula
  return effectiveLoad * (1 + reps / 30);
}

/**
 * Calculate relative strength (strength-to-weight ratio)
 */
export function calculateRelativeStrength(set: SetLog): number {
  const effectiveLoad = set.bodyweightData?.effectiveLoadKg || set.weightKg;
  const bodyweight = set.bodyweightData?.userBodyweightKg || effectiveLoad;

  if (bodyweight <= 0) return 1;
  return effectiveLoad / bodyweight;
}

// ============================================
// BODYWEIGHT CHANGE DETECTION
// ============================================

/**
 * Handle bodyweight changes between sessions
 */
export function handleBodyweightChange(
  currentBWKg: number,
  previousBWKg: number,
  previousSet?: SetLog
): BodyweightChangeContext | null {
  const change = currentBWKg - previousBWKg;
  const changePercent = (change / previousBWKg) * 100;

  // Only show context if BW changed > 2%
  if (Math.abs(changePercent) <= 2) return null;

  if (!previousSet?.bodyweightData) {
    const direction = change > 0 ? 'gained' : 'lost';
    return {
      message: `You've ${direction} ${Math.abs(change).toFixed(1)} kg since last session.`,
      previousTotalKg: previousBWKg,
      newTotalKg: currentBWKg,
      suggestedAdjustment: change > 0
        ? 'Bodyweight exercises may feel slightly harder'
        : 'Bodyweight exercises may feel slightly easier',
    };
  }

  const previousTotal = previousSet.bodyweightData.effectiveLoadKg;
  const previousMod = previousSet.bodyweightData.modification;

  if (previousMod === 'weighted') {
    const addedWeight = previousSet.bodyweightData.addedWeightKg || 0;
    const newTotalSameAdded = currentBWKg + addedWeight;

    return {
      message: change > 0
        ? `You've gained ${change.toFixed(1)} kg since last session. Same added weight will feel slightly harder.`
        : `You've lost ${Math.abs(change).toFixed(1)} kg since last session. Same added weight will feel slightly easier.`,
      previousTotalKg: previousTotal,
      newTotalKg: newTotalSameAdded,
      suggestedAdjustment: change > 0
        ? 'Consider same or slightly less added weight'
        : 'Same added weight or try adding more',
    };
  }

  if (previousMod === 'assisted') {
    const assistWeight = previousSet.bodyweightData.assistanceWeightKg || 0;
    const newTotalSameAssist = currentBWKg - assistWeight;

    return {
      message: change > 0
        ? `You've gained ${change.toFixed(1)} kg. Same assistance will feel slightly harder.`
        : `You've lost ${Math.abs(change).toFixed(1)} kg. Same assistance will feel slightly easier.`,
      previousTotalKg: previousTotal,
      newTotalKg: newTotalSameAssist,
      suggestedAdjustment: change > 0
        ? 'May need slightly more assistance'
        : 'May be ready to reduce assistance',
    };
  }

  return {
    message: change > 0
      ? `You've gained ${change.toFixed(1)} kg since your last session.`
      : `You've lost ${Math.abs(change).toFixed(1)} kg since your last session.`,
    previousTotalKg: previousBWKg,
    newTotalKg: currentBWKg,
    suggestedAdjustment: change > 0
      ? 'Bodyweight exercises will feel slightly harder'
      : 'Bodyweight exercises will feel slightly easier',
  };
}
