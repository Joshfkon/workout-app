/**
 * Dynamic Calorie Targets
 *
 * Adjusts daily calorie targets based on activity data from wearables.
 *
 * Options:
 * 1. Fixed target (ignore activity variations)
 * 2. Activity-adjusted (eat more on active days, less on rest days)
 * 3. Deficit-locked (adjust to maintain consistent deficit)
 */

import type {
  CalorieAdjustmentMode,
  DailyCalorieTarget,
  DailyActivityData,
  EnhancedTDEEEstimate,
  ActivitySettings,
  DailyTDEEResult,
} from '@/types/wearable';
import { calculateDailyTDEE } from './enhanced-tdee';

// === TYPES ===

interface CalorieTargetOptions {
  /** User's base calorie target */
  baseCalorieTarget: number;
  /** Target daily deficit (for deficit-locked mode) */
  targetDeficitCals: number;
  /** Adjustment mode */
  adjustmentMode: CalorieAdjustmentMode;
  /** Maximum daily adjustment cap */
  maxDailyAdjustment: number;
}

interface AdjustmentResult {
  target: DailyCalorieTarget;
  explanation: string;
  warnings: string[];
}

// === MAIN FUNCTION ===

/**
 * Calculate daily calorie target with optional activity adjustments.
 */
export function calculateDailyCalorieTarget(
  settings: CalorieTargetOptions,
  tdeeEstimate: EnhancedTDEEEstimate,
  todayActivity: DailyActivityData,
  currentWeight: number
): DailyCalorieTarget {
  const {
    baseCalorieTarget,
    targetDeficitCals,
    adjustmentMode,
    maxDailyAdjustment,
  } = settings;

  // Fixed mode - no adjustments
  if (adjustmentMode === 'fixed') {
    return {
      baseTarget: baseCalorieTarget,
      adjustedTarget: baseCalorieTarget,
      adjustment: 0,
      reason: 'Fixed target (no activity adjustment)',
      tdeeEstimate: tdeeEstimate.estimatedTDEE,
      targetDeficit: tdeeEstimate.estimatedTDEE - baseCalorieTarget,
    };
  }

  // Calculate today's actual TDEE based on activity
  const dailyTDEE = calculateDailyTDEE(tdeeEstimate, todayActivity, currentWeight);
  const averageTDEE = tdeeEstimate.estimatedTDEE;

  // Activity-adjusted mode
  if (adjustmentMode === 'activity_adjusted') {
    return calculateActivityAdjusted(
      baseCalorieTarget,
      dailyTDEE,
      maxDailyAdjustment
    );
  }

  // Deficit-locked mode
  if (adjustmentMode === 'deficit_locked') {
    return calculateDeficitLocked(
      baseCalorieTarget,
      dailyTDEE,
      targetDeficitCals,
      maxDailyAdjustment
    );
  }

  // Fallback
  return {
    baseTarget: baseCalorieTarget,
    adjustedTarget: baseCalorieTarget,
    adjustment: 0,
    reason: 'Default',
    tdeeEstimate: averageTDEE,
    targetDeficit: averageTDEE - baseCalorieTarget,
  };
}

/**
 * Activity-adjusted mode: eat more on active days, less on rest days.
 * Keeps weekly average intake consistent.
 */
function calculateActivityAdjusted(
  baseCalorieTarget: number,
  dailyTDEE: DailyTDEEResult,
  maxAdjustment: number
): DailyCalorieTarget {
  // Raw adjustment is the difference from average
  const rawAdjustment = dailyTDEE.vsAverage;

  // Cap the adjustment
  const cappedAdjustment = Math.max(
    -maxAdjustment,
    Math.min(maxAdjustment, rawAdjustment)
  );

  const adjustedTarget = baseCalorieTarget + cappedAdjustment;

  let reason: string;
  if (cappedAdjustment > 50) {
    reason = `+${cappedAdjustment} cal (more active than average)`;
  } else if (cappedAdjustment < -50) {
    reason = `${cappedAdjustment} cal (less active than average)`;
  } else {
    reason = 'Activity close to average';
  }

  return {
    baseTarget: baseCalorieTarget,
    adjustedTarget: Math.round(adjustedTarget),
    adjustment: Math.round(cappedAdjustment),
    reason,
    tdeeEstimate: dailyTDEE.totalTDEE,
    targetDeficit: dailyTDEE.totalTDEE - adjustedTarget,
  };
}

/**
 * Deficit-locked mode: maintain consistent deficit regardless of activity.
 * If you burn more, you eat more to keep the same deficit.
 */
function calculateDeficitLocked(
  baseCalorieTarget: number,
  dailyTDEE: DailyTDEEResult,
  targetDeficitCals: number,
  maxAdjustment: number
): DailyCalorieTarget {
  // Calculate what we should eat to maintain exact deficit
  const idealTarget = dailyTDEE.totalTDEE - targetDeficitCals;

  // Calculate adjustment from base
  const rawAdjustment = idealTarget - baseCalorieTarget;

  // Cap the adjustment
  const cappedAdjustment = Math.max(
    -maxAdjustment,
    Math.min(maxAdjustment, rawAdjustment)
  );

  const adjustedTarget = baseCalorieTarget + cappedAdjustment;

  // Calculate actual deficit with the adjusted target
  const actualDeficit = dailyTDEE.totalTDEE - adjustedTarget;

  return {
    baseTarget: baseCalorieTarget,
    adjustedTarget: Math.round(adjustedTarget),
    adjustment: Math.round(cappedAdjustment),
    reason: `Adjusted to maintain ~${targetDeficitCals} cal deficit`,
    tdeeEstimate: dailyTDEE.totalTDEE,
    targetDeficit: Math.round(actualDeficit),
  };
}

// === ANALYSIS FUNCTIONS ===

/**
 * Analyze weekly calorie target adjustments
 */
export function analyzeWeeklyAdjustments(
  weeklyTargets: DailyCalorieTarget[]
): {
  averageAdjustment: number;
  maxAdjustment: number;
  minAdjustment: number;
  totalWeeklyCalories: number;
  weeklyDeficit: number;
  activeDays: number;
  restDays: number;
} {
  if (weeklyTargets.length === 0) {
    return {
      averageAdjustment: 0,
      maxAdjustment: 0,
      minAdjustment: 0,
      totalWeeklyCalories: 0,
      weeklyDeficit: 0,
      activeDays: 0,
      restDays: 0,
    };
  }

  const adjustments = weeklyTargets.map((t) => t.adjustment);
  const deficits = weeklyTargets.map((t) => t.targetDeficit);

  return {
    averageAdjustment: Math.round(
      adjustments.reduce((a, b) => a + b, 0) / adjustments.length
    ),
    maxAdjustment: Math.max(...adjustments),
    minAdjustment: Math.min(...adjustments),
    totalWeeklyCalories: weeklyTargets.reduce((sum, t) => sum + t.adjustedTarget, 0),
    weeklyDeficit: deficits.reduce((sum, d) => sum + d, 0),
    activeDays: adjustments.filter((a) => a > 50).length,
    restDays: adjustments.filter((a) => a < -50).length,
  };
}

/**
 * Get recommendation for calorie adjustment mode
 */
export function getAdjustmentModeRecommendation(
  userGoal: 'cut' | 'bulk' | 'maintain',
  activityVariance: number, // Standard deviation of daily steps
  averageSteps: number
): {
  recommendedMode: CalorieAdjustmentMode;
  reason: string;
} {
  // High activity variance + cutting = deficit-locked helps prevent binges
  if (userGoal === 'cut' && activityVariance > 3000) {
    return {
      recommendedMode: 'deficit_locked',
      reason:
        'Your activity varies significantly. Deficit-locked mode ensures consistent fat loss regardless of daily activity.',
    };
  }

  // Moderate activity variance = activity-adjusted works well
  if (activityVariance > 1500 && averageSteps > 5000) {
    return {
      recommendedMode: 'activity_adjusted',
      reason:
        'Your activity varies day-to-day. Activity-adjusted mode lets you eat more on active days while maintaining your weekly average.',
    };
  }

  // Low activity variance = fixed is simplest
  if (activityVariance < 1500) {
    return {
      recommendedMode: 'fixed',
      reason:
        'Your activity is consistent. A fixed target is simplest since your burn is predictable.',
    };
  }

  // Default to activity-adjusted for most users
  return {
    recommendedMode: 'activity_adjusted',
    reason:
      'Activity-adjusted mode balances simplicity with flexibility based on your daily movement.',
  };
}

// === DISPLAY HELPERS ===

/**
 * Format adjustment explanation for UI
 */
export function formatAdjustmentExplanation(target: DailyCalorieTarget): string {
  if (target.adjustment === 0) {
    return 'Your target is the same as your base goal.';
  }

  const absAdjustment = Math.abs(target.adjustment);
  const direction = target.adjustment > 0 ? 'higher' : 'lower';
  const reason =
    target.adjustment > 0
      ? "because you're more active today"
      : "because you're less active today";

  return `Your target is ${absAdjustment} calories ${direction} than your base goal ${reason}.`;
}

/**
 * Get activity-based meal suggestion
 */
export function getMealSuggestion(target: DailyCalorieTarget): string {
  if (target.adjustment > 150) {
    return 'Big activity day! Consider adding an extra snack or larger portions.';
  }

  if (target.adjustment < -150) {
    return 'Rest day! Stick to your base portions or have lighter meals.';
  }

  return 'Normal activity day. Follow your regular meal plan.';
}

/**
 * Calculate how much protein to prioritize based on target
 */
export function getProteinPriority(
  adjustedTarget: number,
  baseTarget: number,
  baseProtein: number
): {
  adjustedProtein: number;
  note: string;
} {
  const calorieRatio = adjustedTarget / baseTarget;

  // Protein stays relatively stable - don't scale 1:1 with calories
  // On high calorie days, extra calories come from carbs/fat
  // On low calorie days, protect protein
  let proteinMultiplier: number;
  let note: string;

  if (calorieRatio > 1.1) {
    // Active day - small protein increase, mostly carbs
    proteinMultiplier = 1 + (calorieRatio - 1) * 0.3;
    note = 'Extra calories should come primarily from carbs for energy.';
  } else if (calorieRatio < 0.9) {
    // Rest day - protect protein
    proteinMultiplier = Math.max(0.9, calorieRatio * 1.1);
    note = 'Keep protein high to protect muscle on lower calorie days.';
  } else {
    proteinMultiplier = 1;
    note = 'Follow your normal macro split.';
  }

  return {
    adjustedProtein: Math.round(baseProtein * proteinMultiplier),
    note,
  };
}

// === DEFAULTS ===

/**
 * Get default activity settings for a new user
 */
export function getDefaultActivitySettings(): Omit<ActivitySettings, 'userId' | 'createdAt' | 'updatedAt'> {
  return {
    adjustmentMode: 'fixed',
    maxDailyAdjustment: 300,
    targetDeficitCals: 500,
    useAppWorkoutEstimates: true,
    useWearableWorkoutCalories: false,
    preferredWearableSource: null,
  };
}

/**
 * Validate activity settings
 */
export function validateActivitySettings(settings: Partial<ActivitySettings>): string[] {
  const errors: string[] = [];

  if (settings.maxDailyAdjustment !== undefined) {
    if (settings.maxDailyAdjustment < 0) {
      errors.push('Maximum daily adjustment must be positive');
    }
    if (settings.maxDailyAdjustment > 1000) {
      errors.push('Maximum daily adjustment should not exceed 1000 calories');
    }
  }

  if (settings.targetDeficitCals !== undefined) {
    if (settings.targetDeficitCals < 0) {
      errors.push('Target deficit must be positive (or 0 for maintenance)');
    }
    if (settings.targetDeficitCals > 1500) {
      errors.push('Target deficit should not exceed 1500 calories for safety');
    }
  }

  return errors;
}
