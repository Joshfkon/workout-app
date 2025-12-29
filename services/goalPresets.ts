// ============================================================
// GOAL PRESETS AND VALIDATION SERVICE
// Provides preset goal configurations and validation for body composition targets
// ============================================================

import type { MeasurementTargets } from '@/types/schema';

// ============================================================
// TYPES
// ============================================================

/**
 * Goal preset configuration
 */
export interface GoalPreset {
  name: string;
  description: string;
  /** Weight change range as % of body weight */
  weightChangePercent: [number, number];
  /** Body fat change range (absolute percentage points) */
  bodyFatChangePercent: [number, number];
  /** Measurement multipliers (1.0 = maintain) */
  measurementMultipliers: {
    shoulders: number;
    chest: number;
    upperBack: number;
    waist: number;
    biceps: number;
    forearms: number;
    thighs: number;
    calves: number;
  };
}

/**
 * Generated goal targets from applying a preset
 */
export interface GeneratedGoals {
  targetWeightKg: number;
  targetBodyFatPercent: number;
  targetFfmi: number;
  measurementTargets: MeasurementTargets;
  warnings: ValidationWarning[];
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  severity: 'info' | 'warning' | 'error';
  field: string;
  message: string;
}

/**
 * Current body composition for reference
 */
export interface CurrentBodyComp {
  weightKg: number;
  bodyFatPercent: number;
  ffmi: number;
  leanMassKg: number;
  heightCm: number;
}

/**
 * Current measurements for reference
 */
export interface CurrentMeasurements {
  shoulders?: number;
  chest?: number;
  upperBack?: number;
  waist?: number;
  leftBicep?: number;
  rightBicep?: number;
  leftForearm?: number;
  rightForearm?: number;
  leftThigh?: number;
  rightThigh?: number;
  leftCalf?: number;
  rightCalf?: number;
}

// ============================================================
// PRESET DEFINITIONS
// ============================================================

export const GOAL_PRESETS: Record<string, GoalPreset> = {
  aggressive_cut: {
    name: 'Aggressive Cut',
    description: 'Rapid fat loss with some muscle preservation. Best for short durations.',
    weightChangePercent: [-8, -6], // Lose 6-8% body weight
    bodyFatChangePercent: [-4, -6],
    measurementMultipliers: {
      shoulders: 0.99,   // Slight loss acceptable
      chest: 0.98,
      upperBack: 0.99,
      waist: 0.94,       // Significant reduction
      biceps: 0.97,
      forearms: 0.99,
      thighs: 0.97,
      calves: 0.99,
    },
  },

  moderate_cut: {
    name: 'Moderate Cut',
    description: 'Steady fat loss while maintaining muscle. Sustainable approach.',
    weightChangePercent: [-4, -3], // Lose 3-4% body weight
    bodyFatChangePercent: [-2, -3],
    measurementMultipliers: {
      shoulders: 1.0,
      chest: 0.99,
      upperBack: 1.0,
      waist: 0.97,
      biceps: 0.99,
      forearms: 1.0,
      thighs: 0.99,
      calves: 1.0,
    },
  },

  recomp: {
    name: 'Recomp',
    description: 'Simultaneous fat loss and muscle gain. Maintain or slightly change weight.',
    weightChangePercent: [-1, 1], // Weight stays roughly the same
    bodyFatChangePercent: [-2, -3],
    measurementMultipliers: {
      shoulders: 1.03,
      chest: 1.02,
      upperBack: 1.04,
      waist: 0.98,
      biceps: 1.03,
      forearms: 1.02,
      thighs: 1.01,
      calves: 1.01,
    },
  },

  lean_bulk: {
    name: 'Lean Bulk',
    description: 'Gain muscle with minimal fat. Controlled caloric surplus.',
    weightChangePercent: [3, 5], // Gain 3-5% body weight
    bodyFatChangePercent: [1, 2],
    measurementMultipliers: {
      shoulders: 1.05,
      chest: 1.04,
      upperBack: 1.05,
      waist: 1.02,
      biceps: 1.05,
      forearms: 1.03,
      thighs: 1.03,
      calves: 1.02,
    },
  },

  aggressive_bulk: {
    name: 'Aggressive Bulk',
    description: 'Maximum muscle gain. Significant weight increase expected.',
    weightChangePercent: [6, 10], // Gain 6-10% body weight
    bodyFatChangePercent: [2, 4],
    measurementMultipliers: {
      shoulders: 1.08,
      chest: 1.06,
      upperBack: 1.07,
      waist: 1.04,
      biceps: 1.07,
      forearms: 1.04,
      thighs: 1.05,
      calves: 1.03,
    },
  },

  maintenance: {
    name: 'Maintenance',
    description: 'Maintain current physique. Focus on strength and skill work.',
    weightChangePercent: [-1, 1],
    bodyFatChangePercent: [-0.5, 0.5],
    measurementMultipliers: {
      shoulders: 1.0,
      chest: 1.0,
      upperBack: 1.0,
      waist: 1.0,
      biceps: 1.0,
      forearms: 1.0,
      thighs: 1.0,
      calves: 1.0,
    },
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculate FFMI from body composition
 */
export function calculateFFMI(
  weightKg: number,
  bodyFatPercent: number,
  heightCm: number
): number {
  const leanMassKg = weightKg * (1 - bodyFatPercent / 100);
  const heightM = heightCm / 100;
  // FFMI = lean mass / height^2
  const ffmi = leanMassKg / (heightM * heightM);
  // Normalized FFMI (height adjustment for comparison)
  return ffmi + (6.1 * (1.8 - heightM));
}

/**
 * Calculate implied changes from targets
 */
export function calculateImpliedChanges(
  current: CurrentBodyComp,
  targetWeightKg: number,
  targetBodyFatPercent: number
): {
  fatChange: number;
  muscleChange: number;
  totalWeightChange: number;
} {
  const currentLeanMass = current.leanMassKg;
  const currentFatMass = current.weightKg - currentLeanMass;

  const targetFatMass = targetWeightKg * (targetBodyFatPercent / 100);
  const targetLeanMass = targetWeightKg - targetFatMass;

  return {
    fatChange: targetFatMass - currentFatMass,
    muscleChange: targetLeanMass - currentLeanMass,
    totalWeightChange: targetWeightKg - current.weightKg,
  };
}

// ============================================================
// PRESET APPLICATION
// ============================================================

/**
 * Apply a goal preset to current body composition and measurements
 */
export function applyPreset(
  preset: GoalPreset,
  currentBodyComp: CurrentBodyComp,
  currentMeasurements: CurrentMeasurements,
  mesocycleDurationWeeks: number
): GeneratedGoals {
  // Scale factors based on mesocycle duration (8 weeks = full preset values)
  const durationFactor = mesocycleDurationWeeks / 8;

  // Calculate target weight
  const midpointWeightChange =
    (preset.weightChangePercent[0] + preset.weightChangePercent[1]) / 2;
  const scaledWeightChange = (midpointWeightChange / 100) * durationFactor;
  const targetWeightKg = currentBodyComp.weightKg * (1 + scaledWeightChange);

  // Calculate target body fat
  const midpointBFChange =
    (preset.bodyFatChangePercent[0] + preset.bodyFatChangePercent[1]) / 2;
  const scaledBFChange = midpointBFChange * durationFactor;
  const targetBodyFatPercent = Math.max(5, Math.min(40,
    currentBodyComp.bodyFatPercent + scaledBFChange
  ));

  // Calculate target FFMI
  const targetFfmi = calculateFFMI(
    targetWeightKg,
    targetBodyFatPercent,
    currentBodyComp.heightCm
  );

  // Calculate measurement targets
  const measurementTargets: MeasurementTargets = {};

  const applyMultiplier = (
    current: number | undefined,
    multiplier: number
  ): number | undefined => {
    if (current === undefined) return undefined;
    const scaledMultiplier = 1 + (multiplier - 1) * durationFactor;
    return current * scaledMultiplier;
  };

  if (currentMeasurements.shoulders) {
    measurementTargets.shoulders = applyMultiplier(
      currentMeasurements.shoulders,
      preset.measurementMultipliers.shoulders
    );
  }
  if (currentMeasurements.chest) {
    measurementTargets.chest = applyMultiplier(
      currentMeasurements.chest,
      preset.measurementMultipliers.chest
    );
  }
  if (currentMeasurements.upperBack) {
    measurementTargets.upper_back = applyMultiplier(
      currentMeasurements.upperBack,
      preset.measurementMultipliers.upperBack
    );
  }
  if (currentMeasurements.waist) {
    measurementTargets.waist = applyMultiplier(
      currentMeasurements.waist,
      preset.measurementMultipliers.waist
    );
  }
  if (currentMeasurements.leftBicep) {
    measurementTargets.left_bicep = applyMultiplier(
      currentMeasurements.leftBicep,
      preset.measurementMultipliers.biceps
    );
  }
  if (currentMeasurements.rightBicep) {
    measurementTargets.right_bicep = applyMultiplier(
      currentMeasurements.rightBicep,
      preset.measurementMultipliers.biceps
    );
  }
  if (currentMeasurements.leftForearm) {
    measurementTargets.left_forearm = applyMultiplier(
      currentMeasurements.leftForearm,
      preset.measurementMultipliers.forearms
    );
  }
  if (currentMeasurements.rightForearm) {
    measurementTargets.right_forearm = applyMultiplier(
      currentMeasurements.rightForearm,
      preset.measurementMultipliers.forearms
    );
  }
  if (currentMeasurements.leftThigh) {
    measurementTargets.left_thigh = applyMultiplier(
      currentMeasurements.leftThigh,
      preset.measurementMultipliers.thighs
    );
  }
  if (currentMeasurements.rightThigh) {
    measurementTargets.right_thigh = applyMultiplier(
      currentMeasurements.rightThigh,
      preset.measurementMultipliers.thighs
    );
  }
  if (currentMeasurements.leftCalf) {
    measurementTargets.left_calf = applyMultiplier(
      currentMeasurements.leftCalf,
      preset.measurementMultipliers.calves
    );
  }
  if (currentMeasurements.rightCalf) {
    measurementTargets.right_calf = applyMultiplier(
      currentMeasurements.rightCalf,
      preset.measurementMultipliers.calves
    );
  }

  // Validate and generate warnings
  const warnings = validateTargets(
    currentBodyComp,
    targetWeightKg,
    targetBodyFatPercent,
    targetFfmi,
    mesocycleDurationWeeks,
    currentMeasurements,
    measurementTargets
  );

  return {
    targetWeightKg,
    targetBodyFatPercent,
    targetFfmi,
    measurementTargets,
    warnings,
  };
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate target feasibility and generate warnings
 */
export function validateTargets(
  current: CurrentBodyComp,
  targetWeightKg: number,
  targetBodyFatPercent: number,
  targetFfmi: number,
  durationWeeks: number,
  currentMeasurements: CurrentMeasurements,
  targetMeasurements: MeasurementTargets
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Weight loss rate check (max 1-1.5 lbs/week recommended)
  const weeklyWeightChange = Math.abs(current.weightKg - targetWeightKg) / durationWeeks;
  const weeklyWeightChangeLbs = weeklyWeightChange * 2.20462;

  if (current.weightKg > targetWeightKg && weeklyWeightChangeLbs > 2) {
    warnings.push({
      severity: 'warning',
      field: 'weight',
      message: `Weight loss rate of ${weeklyWeightChangeLbs.toFixed(1)} lbs/week exceeds recommended maximum of 1-1.5 lbs/week. Consider extending the timeline.`,
    });
  }

  // Weight gain rate check (max 0.5-1 lb/week for lean gains)
  if (targetWeightKg > current.weightKg && weeklyWeightChangeLbs > 1.5) {
    warnings.push({
      severity: 'info',
      field: 'weight',
      message: `Weight gain rate of ${weeklyWeightChangeLbs.toFixed(1)} lbs/week may result in excess fat gain. Consider a slower approach.`,
    });
  }

  // FFMI jump check (realistic is ~0.2-0.3 points per month for intermediates)
  const ffmiChange = targetFfmi - current.ffmi;
  const monthlyFFMIChange = ffmiChange / (durationWeeks / 4);

  if (monthlyFFMIChange > 0.3) {
    warnings.push({
      severity: 'warning',
      field: 'ffmi',
      message: `Target FFMI gain of ${ffmiChange.toFixed(1)} in ${durationWeeks} weeks is ambitious. Natural muscle gain typically allows ~0.2-0.3 FFMI points per month.`,
    });
  }

  // Natural limit check
  if (targetFfmi > 25) {
    warnings.push({
      severity: 'info',
      field: 'ffmi',
      message: `Target FFMI of ${targetFfmi.toFixed(1)} approaches natural limits (~25). Progress may slow significantly.`,
    });
  }

  if (targetFfmi > 27) {
    warnings.push({
      severity: 'error',
      field: 'ffmi',
      message: `Target FFMI of ${targetFfmi.toFixed(1)} exceeds typical natural limits. This may not be achievable without pharmacological assistance.`,
    });
  }

  // Body fat too low check
  if (targetBodyFatPercent < 6) {
    warnings.push({
      severity: 'error',
      field: 'bodyFat',
      message: `Target body fat of ${targetBodyFatPercent}% is dangerously low. Essential body fat for men is 2-5%, for women 10-13%.`,
    });
  } else if (targetBodyFatPercent < 10) {
    warnings.push({
      severity: 'warning',
      field: 'bodyFat',
      message: `Target body fat of ${targetBodyFatPercent}% is very lean and may be difficult to maintain long-term.`,
    });
  }

  // Measurement vs weight consistency check
  // (gaining measurements while losing significant weight is challenging)
  const avgMeasurementGrowth = calculateAvgMeasurementGrowth(
    currentMeasurements,
    targetMeasurements
  );

  if (weeklyWeightChangeLbs > 0.5 && current.weightKg > targetWeightKg && avgMeasurementGrowth > 0.02) {
    warnings.push({
      severity: 'info',
      field: 'measurements',
      message: 'Growing measurements while in a deficit is possible but challenging. Consider prioritizing either fat loss or muscle gain.',
    });
  }

  return warnings;
}

/**
 * Calculate average measurement growth rate
 */
function calculateAvgMeasurementGrowth(
  current: CurrentMeasurements,
  target: MeasurementTargets
): number {
  const comparisons: number[] = [];

  const compare = (
    currentVal: number | undefined,
    targetVal: number | undefined
  ) => {
    if (currentVal && targetVal && currentVal > 0) {
      comparisons.push((targetVal - currentVal) / currentVal);
    }
  };

  compare(current.shoulders, target.shoulders);
  compare(current.chest, target.chest);
  compare(current.leftBicep, target.left_bicep);
  compare(current.rightBicep, target.right_bicep);
  compare(current.leftThigh, target.left_thigh);
  compare(current.rightThigh, target.right_thigh);

  if (comparisons.length === 0) return 0;
  return comparisons.reduce((sum, val) => sum + val, 0) / comparisons.length;
}

/**
 * Get preset recommendations based on current state and goals
 */
export function getRecommendedPresets(
  current: CurrentBodyComp,
  preferredDirection?: 'cut' | 'bulk' | 'maintain'
): Array<{ preset: GoalPreset; key: string; recommendation: string }> {
  const recommendations: Array<{
    preset: GoalPreset;
    key: string;
    recommendation: string;
  }> = [];

  // High body fat - recommend cut
  if (current.bodyFatPercent > 20) {
    recommendations.push({
      preset: GOAL_PRESETS.moderate_cut,
      key: 'moderate_cut',
      recommendation: 'Recommended based on current body fat level',
    });
  }

  // Low body fat - recommend bulk or recomp
  if (current.bodyFatPercent < 12) {
    recommendations.push({
      preset: GOAL_PRESETS.lean_bulk,
      key: 'lean_bulk',
      recommendation: 'Good for adding muscle at low body fat',
    });
  }

  // Mid range - recomp is effective
  if (current.bodyFatPercent >= 12 && current.bodyFatPercent <= 18) {
    recommendations.push({
      preset: GOAL_PRESETS.recomp,
      key: 'recomp',
      recommendation: 'Ideal body fat range for recomposition',
    });
  }

  // Based on preference
  if (preferredDirection === 'cut') {
    if (!recommendations.find((r) => r.key === 'moderate_cut')) {
      recommendations.push({
        preset: GOAL_PRESETS.moderate_cut,
        key: 'moderate_cut',
        recommendation: 'Matches your preferred direction',
      });
    }
  } else if (preferredDirection === 'bulk') {
    if (!recommendations.find((r) => r.key === 'lean_bulk')) {
      recommendations.push({
        preset: GOAL_PRESETS.lean_bulk,
        key: 'lean_bulk',
        recommendation: 'Matches your preferred direction',
      });
    }
  }

  return recommendations;
}

export default {
  GOAL_PRESETS,
  applyPreset,
  validateTargets,
  getRecommendedPresets,
  calculateFFMI,
  calculateImpliedChanges,
};
