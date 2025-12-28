// ============================================================
// BODY MEASUREMENT IMBALANCE DETECTION ENGINE
// Analyzes body measurements to identify:
// - Left/right asymmetries (bilateral measurements)
// - Proportionality imbalances (e.g., small arms vs large legs)
// - Sanity checks against lift performance
// - Lagging and dominant body parts
// ============================================================

import type { MuscleGroup } from '@/types/schema';

// ============================================================
// TYPES
// ============================================================

/**
 * Body measurements in centimeters (as stored in database)
 */
export interface BodyMeasurements {
  neck?: number;
  shoulders?: number;
  chest?: number;
  left_bicep?: number;
  right_bicep?: number;
  left_forearm?: number;
  right_forearm?: number;
  waist?: number;
  hips?: number;
  left_thigh?: number;
  right_thigh?: number;
  left_calf?: number;
  right_calf?: number;
}

/**
 * User's best lifts for sanity checking measurements
 */
export interface UserLifts {
  /** Bench press 1RM or E1RM in kg */
  benchPressKg?: number;
  /** Squat 1RM or E1RM in kg */
  squatKg?: number;
  /** Deadlift 1RM or E1RM in kg */
  deadliftKg?: number;
  /** Overhead press 1RM or E1RM in kg */
  overheadPressKg?: number;
  /** Barbell row 1RM or E1RM in kg */
  rowKg?: number;
  /** Barbell curl 1RM or E1RM in kg */
  curlKg?: number;
}

/**
 * Asymmetry between bilateral body parts
 */
export interface BilateralAsymmetry {
  bodyPart: 'biceps' | 'forearms' | 'thighs' | 'calves';
  leftCm: number;
  rightCm: number;
  /** Percentage difference (positive = right dominant) */
  asymmetryPercent: number;
  /** Absolute difference in cm */
  differenceCm: number;
  dominantSide: 'left' | 'right' | 'balanced';
  severity: 'none' | 'minor' | 'moderate' | 'significant';
  recommendation?: string;
}

/**
 * Proportionality analysis for a body part
 */
export interface ProportionalityAnalysis {
  bodyPart: string;
  /** Related muscle groups */
  muscleGroups: MuscleGroup[];
  /** Actual measurement in cm */
  actualCm: number;
  /** Ideal measurement based on proportions */
  idealCm: number;
  /** Percentage of ideal achieved */
  percentOfIdeal: number;
  status: 'underdeveloped' | 'balanced' | 'overdeveloped';
  recommendation?: string;
}

/**
 * Sanity check comparing measurements to lift performance
 */
export interface LiftMeasurementSanityCheck {
  lift: string;
  liftValueKg: number;
  relatedMeasurement: string;
  measurementCm: number;
  /** Expected measurement range based on lift */
  expectedRangeCm: [number, number];
  status: 'consistent' | 'measurement_high' | 'measurement_low';
  message: string;
}

/**
 * Complete imbalance analysis result
 */
export interface ImbalanceAnalysis {
  /** Left/right asymmetries */
  bilateralAsymmetries: BilateralAsymmetry[];
  /** Proportionality analysis per body part */
  proportionalityAnalysis: ProportionalityAnalysis[];
  /** Lift vs measurement sanity checks */
  liftSanityChecks: LiftMeasurementSanityCheck[];
  /** Overall lagging muscle groups (need more focus) */
  laggingMuscles: MuscleGroup[];
  /** Overall dominant muscle groups (well-developed) */
  dominantMuscles: MuscleGroup[];
  /** Prioritized recommendations */
  recommendations: string[];
  /** Overall balance score (0-100, higher = more balanced) */
  balanceScore: number;
}

/**
 * User muscle priority preference
 */
export interface MusclePriority {
  muscleGroup: MuscleGroup;
  /** Priority level: 1 = highest priority, 5 = lowest */
  priority: 1 | 2 | 3 | 4 | 5;
  /** Optional reason for this priority */
  reason?: string;
}

/**
 * Volume adjustment for exercise selection
 */
export interface VolumeAdjustment {
  muscleGroup: MuscleGroup;
  /** Multiplier for volume (1.0 = normal, 1.15 = 15% more, 0.85 = 15% less) */
  volumeMultiplier: number;
  /** Reason for adjustment */
  reason: 'lagging' | 'imbalance' | 'user_priority' | 'dominant';
}

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Asymmetry thresholds for bilateral measurements
 */
const ASYMMETRY_THRESHOLDS = {
  minor: 3,      // 3% difference - minor, monitor
  moderate: 5,   // 5% difference - worth addressing
  significant: 8 // 8%+ difference - priority to fix
};

/**
 * Ideal proportions based on classical physique ratios
 * Using wrist circumference as the base (Grecian ideal, McCallum formula)
 * These are multipliers of wrist circumference
 */
const IDEAL_PROPORTIONS = {
  // Upper body
  neck: 2.5,           // 2.5x wrist
  shoulders: 7.5,      // 7.5x wrist (biacromial)
  chest: 6.5,          // 6.5x wrist (at nipple line)
  bicep: 2.5,          // 2.5x wrist (flexed)
  forearm: 1.88,       // 1.88x wrist
  // Core
  waist: 4.5,          // 4.5x wrist (at navel)
  hips: 5.5,           // 5.5x wrist
  // Lower body
  thigh: 3.75,         // 3.75x wrist (upper thigh)
  calf: 2.5,           // Equal to flexed bicep ideally
};

/**
 * Alternative proportions based on height (for when wrist unavailable)
 * Percentages of height in cm
 */
const HEIGHT_PROPORTIONS = {
  neck: 0.22,          // 22% of height
  shoulders: 0.275,    // 27.5% of height
  chest: 0.58,         // 58% of height
  bicep: 0.2,          // 20% of height
  forearm: 0.17,       // 17% of height
  waist: 0.45,         // 45% of height
  hips: 0.5,           // 50% of height
  thigh: 0.35,         // 35% of height
  calf: 0.22,          // 22% of height
};

/**
 * Mapping from body measurements to muscle groups
 */
const MEASUREMENT_TO_MUSCLES: Record<string, MuscleGroup[]> = {
  neck: ['traps'],
  shoulders: ['shoulders'],
  chest: ['chest'],
  bicep: ['biceps'],
  forearm: ['forearms'],
  waist: ['abs'],
  hips: ['glutes'],
  thigh: ['quads', 'hamstrings', 'adductors'],
  calf: ['calves'],
};

/**
 * Expected measurement ranges based on lift performance
 * Format: { lift: { measurement: [minRatio, maxRatio] } }
 * Ratios are measurement(cm) / lift(kg)
 */
const LIFT_MEASUREMENT_RATIOS = {
  benchPressKg: {
    chest: [0.6, 0.9],      // ~90-120cm chest for 100-150kg bench
    bicep: [0.25, 0.4],     // ~35-45cm bicep
  },
  squatKg: {
    thigh: [0.3, 0.5],      // ~50-65cm thigh for 150-200kg squat
    calf: [0.2, 0.35],      // ~35-45cm calf
  },
  deadliftKg: {
    thigh: [0.25, 0.45],    // Deadlift correlates with thigh size
  },
  curlKg: {
    bicep: [0.5, 0.8],      // ~35-45cm bicep for 50-60kg curl
  },
};

// ============================================================
// CORE ANALYSIS FUNCTIONS
// ============================================================

/**
 * Analyze bilateral asymmetries (left vs right)
 */
export function analyzeBilateralAsymmetries(
  measurements: BodyMeasurements
): BilateralAsymmetry[] {
  const asymmetries: BilateralAsymmetry[] = [];

  // Check each bilateral measurement pair
  const pairs: Array<{
    part: 'biceps' | 'forearms' | 'thighs' | 'calves';
    left: keyof BodyMeasurements;
    right: keyof BodyMeasurements;
  }> = [
    { part: 'biceps', left: 'left_bicep', right: 'right_bicep' },
    { part: 'forearms', left: 'left_forearm', right: 'right_forearm' },
    { part: 'thighs', left: 'left_thigh', right: 'right_thigh' },
    { part: 'calves', left: 'left_calf', right: 'right_calf' },
  ];

  for (const { part, left, right } of pairs) {
    const leftVal = measurements[left];
    const rightVal = measurements[right];

    if (leftVal !== undefined && rightVal !== undefined && leftVal > 0 && rightVal > 0) {
      const average = (leftVal + rightVal) / 2;
      const asymmetryPercent = ((rightVal - leftVal) / average) * 100;
      const differenceCm = Math.abs(rightVal - leftVal);

      let severity: 'none' | 'minor' | 'moderate' | 'significant';
      const absAsymmetry = Math.abs(asymmetryPercent);

      if (absAsymmetry < ASYMMETRY_THRESHOLDS.minor) {
        severity = 'none';
      } else if (absAsymmetry < ASYMMETRY_THRESHOLDS.moderate) {
        severity = 'minor';
      } else if (absAsymmetry < ASYMMETRY_THRESHOLDS.significant) {
        severity = 'moderate';
      } else {
        severity = 'significant';
      }

      let dominantSide: 'left' | 'right' | 'balanced';
      if (absAsymmetry < ASYMMETRY_THRESHOLDS.minor) {
        dominantSide = 'balanced';
      } else {
        dominantSide = asymmetryPercent > 0 ? 'right' : 'left';
      }

      let recommendation: string | undefined;
      const weakSide = dominantSide === 'left' ? 'right' : 'left';

      if (severity === 'moderate') {
        recommendation = `Start ${part} exercises with your ${weakSide} side. Use unilateral exercises to ensure equal work.`;
      } else if (severity === 'significant') {
        recommendation = `Significant ${part} imbalance detected. Add 1-2 extra sets for your ${weakSide} side using unilateral exercises.`;
      }

      asymmetries.push({
        bodyPart: part,
        leftCm: leftVal,
        rightCm: rightVal,
        asymmetryPercent: Math.round(asymmetryPercent * 10) / 10,
        differenceCm: Math.round(differenceCm * 10) / 10,
        dominantSide,
        severity,
        recommendation,
      });
    }
  }

  return asymmetries;
}

/**
 * Calculate ideal proportions based on wrist or height
 */
export function calculateIdealProportions(
  heightCm?: number,
  wristCm?: number
): Record<string, number> {
  const ideals: Record<string, number> = {};

  if (wristCm && wristCm > 0) {
    // Use wrist-based proportions (more accurate for individual frame)
    ideals.neck = wristCm * IDEAL_PROPORTIONS.neck;
    ideals.shoulders = wristCm * IDEAL_PROPORTIONS.shoulders;
    ideals.chest = wristCm * IDEAL_PROPORTIONS.chest;
    ideals.bicep = wristCm * IDEAL_PROPORTIONS.bicep;
    ideals.forearm = wristCm * IDEAL_PROPORTIONS.forearm;
    ideals.waist = wristCm * IDEAL_PROPORTIONS.waist;
    ideals.hips = wristCm * IDEAL_PROPORTIONS.hips;
    ideals.thigh = wristCm * IDEAL_PROPORTIONS.thigh;
    ideals.calf = wristCm * IDEAL_PROPORTIONS.calf;
  } else if (heightCm && heightCm > 0) {
    // Fallback to height-based proportions
    ideals.neck = heightCm * HEIGHT_PROPORTIONS.neck;
    ideals.shoulders = heightCm * HEIGHT_PROPORTIONS.shoulders;
    ideals.chest = heightCm * HEIGHT_PROPORTIONS.chest;
    ideals.bicep = heightCm * HEIGHT_PROPORTIONS.bicep;
    ideals.forearm = heightCm * HEIGHT_PROPORTIONS.forearm;
    ideals.waist = heightCm * HEIGHT_PROPORTIONS.waist;
    ideals.hips = heightCm * HEIGHT_PROPORTIONS.hips;
    ideals.thigh = heightCm * HEIGHT_PROPORTIONS.thigh;
    ideals.calf = heightCm * HEIGHT_PROPORTIONS.calf;
  }

  return ideals;
}

/**
 * Analyze proportionality of body parts against ideals
 */
export function analyzeProportionality(
  measurements: BodyMeasurements,
  heightCm?: number,
  wristCm?: number
): ProportionalityAnalysis[] {
  const ideals = calculateIdealProportions(heightCm, wristCm);

  if (Object.keys(ideals).length === 0) {
    return []; // Can't calculate without reference measurements
  }

  const analysis: ProportionalityAnalysis[] = [];

  // Average bilateral measurements for analysis
  const effectiveMeasurements: Record<string, number> = {};

  if (measurements.neck) effectiveMeasurements.neck = measurements.neck;
  if (measurements.shoulders) effectiveMeasurements.shoulders = measurements.shoulders;
  if (measurements.chest) effectiveMeasurements.chest = measurements.chest;
  if (measurements.left_bicep && measurements.right_bicep) {
    effectiveMeasurements.bicep = (measurements.left_bicep + measurements.right_bicep) / 2;
  }
  if (measurements.left_forearm && measurements.right_forearm) {
    effectiveMeasurements.forearm = (measurements.left_forearm + measurements.right_forearm) / 2;
  }
  if (measurements.waist) effectiveMeasurements.waist = measurements.waist;
  if (measurements.hips) effectiveMeasurements.hips = measurements.hips;
  if (measurements.left_thigh && measurements.right_thigh) {
    effectiveMeasurements.thigh = (measurements.left_thigh + measurements.right_thigh) / 2;
  }
  if (measurements.left_calf && measurements.right_calf) {
    effectiveMeasurements.calf = (measurements.left_calf + measurements.right_calf) / 2;
  }

  for (const [part, actualCm] of Object.entries(effectiveMeasurements)) {
    const idealCm = ideals[part];
    if (!idealCm) continue;

    const percentOfIdeal = (actualCm / idealCm) * 100;

    let status: 'underdeveloped' | 'balanced' | 'overdeveloped';
    let recommendation: string | undefined;

    // Waist is inverted - smaller is better
    if (part === 'waist') {
      if (percentOfIdeal > 110) {
        status = 'overdeveloped'; // Waist too big
        recommendation = 'Consider focusing on core stability and nutrition to reduce waist size.';
      } else if (percentOfIdeal < 90) {
        status = 'balanced'; // Small waist is good
      } else {
        status = 'balanced';
      }
    } else {
      if (percentOfIdeal < 85) {
        status = 'underdeveloped';
        recommendation = getProportionalityRecommendation(part, 'underdeveloped');
      } else if (percentOfIdeal > 115) {
        status = 'overdeveloped';
        recommendation = getProportionalityRecommendation(part, 'overdeveloped');
      } else {
        status = 'balanced';
      }
    }

    const muscleGroups = MEASUREMENT_TO_MUSCLES[part] || [];

    analysis.push({
      bodyPart: formatBodyPartName(part),
      muscleGroups: muscleGroups as MuscleGroup[],
      actualCm: Math.round(actualCm * 10) / 10,
      idealCm: Math.round(idealCm * 10) / 10,
      percentOfIdeal: Math.round(percentOfIdeal),
      status,
      recommendation,
    });
  }

  return analysis;
}

/**
 * Check if measurements are consistent with lift performance
 */
export function checkLiftMeasurementConsistency(
  measurements: BodyMeasurements,
  lifts: UserLifts
): LiftMeasurementSanityCheck[] {
  const checks: LiftMeasurementSanityCheck[] = [];

  // Bench press vs chest/bicep
  if (lifts.benchPressKg && lifts.benchPressKg > 0) {
    if (measurements.chest) {
      const expectedMin = lifts.benchPressKg * LIFT_MEASUREMENT_RATIOS.benchPressKg.chest[0];
      const expectedMax = lifts.benchPressKg * LIFT_MEASUREMENT_RATIOS.benchPressKg.chest[1];

      checks.push(createSanityCheck(
        'Bench Press',
        lifts.benchPressKg,
        'Chest',
        measurements.chest,
        [expectedMin, expectedMax]
      ));
    }

    const avgBicep = getAverageBilateral(measurements.left_bicep, measurements.right_bicep);
    if (avgBicep) {
      const expectedMin = lifts.benchPressKg * LIFT_MEASUREMENT_RATIOS.benchPressKg.bicep[0];
      const expectedMax = lifts.benchPressKg * LIFT_MEASUREMENT_RATIOS.benchPressKg.bicep[1];

      checks.push(createSanityCheck(
        'Bench Press',
        lifts.benchPressKg,
        'Biceps',
        avgBicep,
        [expectedMin, expectedMax]
      ));
    }
  }

  // Squat vs thigh/calf
  if (lifts.squatKg && lifts.squatKg > 0) {
    const avgThigh = getAverageBilateral(measurements.left_thigh, measurements.right_thigh);
    if (avgThigh) {
      const expectedMin = lifts.squatKg * LIFT_MEASUREMENT_RATIOS.squatKg.thigh[0];
      const expectedMax = lifts.squatKg * LIFT_MEASUREMENT_RATIOS.squatKg.thigh[1];

      checks.push(createSanityCheck(
        'Squat',
        lifts.squatKg,
        'Thighs',
        avgThigh,
        [expectedMin, expectedMax]
      ));
    }

    const avgCalf = getAverageBilateral(measurements.left_calf, measurements.right_calf);
    if (avgCalf) {
      const expectedMin = lifts.squatKg * LIFT_MEASUREMENT_RATIOS.squatKg.calf[0];
      const expectedMax = lifts.squatKg * LIFT_MEASUREMENT_RATIOS.squatKg.calf[1];

      checks.push(createSanityCheck(
        'Squat',
        lifts.squatKg,
        'Calves',
        avgCalf,
        [expectedMin, expectedMax]
      ));
    }
  }

  // Curl vs bicep
  if (lifts.curlKg && lifts.curlKg > 0) {
    const avgBicep = getAverageBilateral(measurements.left_bicep, measurements.right_bicep);
    if (avgBicep) {
      const expectedMin = lifts.curlKg * LIFT_MEASUREMENT_RATIOS.curlKg.bicep[0];
      const expectedMax = lifts.curlKg * LIFT_MEASUREMENT_RATIOS.curlKg.bicep[1];

      checks.push(createSanityCheck(
        'Barbell Curl',
        lifts.curlKg,
        'Biceps',
        avgBicep,
        [expectedMin, expectedMax]
      ));
    }
  }

  return checks;
}

/**
 * Complete imbalance analysis combining all checks
 */
export function analyzeImbalances(
  measurements: BodyMeasurements,
  lifts?: UserLifts,
  heightCm?: number,
  wristCm?: number
): ImbalanceAnalysis {
  // Run all analyses
  const bilateralAsymmetries = analyzeBilateralAsymmetries(measurements);
  const proportionalityAnalysis = analyzeProportionality(measurements, heightCm, wristCm);
  const liftSanityChecks = lifts ? checkLiftMeasurementConsistency(measurements, lifts) : [];

  // Identify lagging and dominant muscles
  const laggingMuscles: Set<MuscleGroup> = new Set();
  const dominantMuscles: Set<MuscleGroup> = new Set();

  // From proportionality analysis
  for (const analysis of proportionalityAnalysis) {
    if (analysis.status === 'underdeveloped') {
      for (const muscle of analysis.muscleGroups) {
        laggingMuscles.add(muscle);
      }
    } else if (analysis.status === 'overdeveloped' && analysis.bodyPart !== 'Waist') {
      for (const muscle of analysis.muscleGroups) {
        dominantMuscles.add(muscle);
      }
    }
  }

  // From bilateral asymmetries (add the weaker side's muscles)
  for (const asymmetry of bilateralAsymmetries) {
    if (asymmetry.severity === 'moderate' || asymmetry.severity === 'significant') {
      const muscles = MEASUREMENT_TO_MUSCLES[asymmetry.bodyPart.slice(0, -1)] || // Remove 's' from plural
        MEASUREMENT_TO_MUSCLES[asymmetry.bodyPart];
      if (muscles) {
        for (const muscle of muscles) {
          // Asymmetry indicates the muscle needs attention
          laggingMuscles.add(muscle as MuscleGroup);
        }
      }
    }
  }

  // From lift sanity checks
  for (const check of liftSanityChecks) {
    if (check.status === 'measurement_low') {
      // Measurement is low relative to strength - might need more hypertrophy focus
      const measurementKey = check.relatedMeasurement.toLowerCase();
      const muscles = MEASUREMENT_TO_MUSCLES[measurementKey];
      if (muscles) {
        for (const muscle of muscles) {
          laggingMuscles.add(muscle as MuscleGroup);
        }
      }
    }
  }

  // Generate recommendations
  const recommendations = generateRecommendations(
    bilateralAsymmetries,
    proportionalityAnalysis,
    liftSanityChecks
  );

  // Calculate balance score
  const balanceScore = calculateBalanceScore(bilateralAsymmetries, proportionalityAnalysis);

  return {
    bilateralAsymmetries,
    proportionalityAnalysis,
    liftSanityChecks,
    laggingMuscles: Array.from(laggingMuscles),
    dominantMuscles: Array.from(dominantMuscles),
    recommendations,
    balanceScore,
  };
}

/**
 * Calculate volume adjustments based on imbalances and user priorities
 */
export function calculateVolumeAdjustments(
  imbalanceAnalysis: ImbalanceAnalysis,
  userPriorities: MusclePriority[] = []
): VolumeAdjustment[] {
  const adjustments: Map<MuscleGroup, VolumeAdjustment> = new Map();

  // Apply imbalance-based adjustments (15% boost for lagging)
  for (const muscle of imbalanceAnalysis.laggingMuscles) {
    adjustments.set(muscle, {
      muscleGroup: muscle,
      volumeMultiplier: 1.15,
      reason: 'lagging',
    });
  }

  // Apply asymmetry-based adjustments (10% boost for moderate, 15% for significant)
  for (const asymmetry of imbalanceAnalysis.bilateralAsymmetries) {
    if (asymmetry.severity === 'moderate' || asymmetry.severity === 'significant') {
      const muscleKey = asymmetry.bodyPart.slice(0, -1); // Remove 's'
      const muscles = MEASUREMENT_TO_MUSCLES[muscleKey];
      if (muscles) {
        for (const muscle of muscles) {
          const existing = adjustments.get(muscle as MuscleGroup);
          const boost = asymmetry.severity === 'significant' ? 1.15 : 1.10;

          if (existing) {
            // Stack adjustments up to 1.25 max
            existing.volumeMultiplier = Math.min(1.25, existing.volumeMultiplier * boost);
            existing.reason = 'imbalance';
          } else {
            adjustments.set(muscle as MuscleGroup, {
              muscleGroup: muscle as MuscleGroup,
              volumeMultiplier: boost,
              reason: 'imbalance',
            });
          }
        }
      }
    }
  }

  // Apply user priority adjustments
  for (const priority of userPriorities) {
    const existing = adjustments.get(priority.muscleGroup);

    // Priority 1 = +20%, Priority 2 = +10%, Priority 3 = 0%, Priority 4 = -5%, Priority 5 = -10%
    const priorityMultiplier =
      priority.priority === 1 ? 1.20 :
      priority.priority === 2 ? 1.10 :
      priority.priority === 3 ? 1.00 :
      priority.priority === 4 ? 0.95 :
      0.90;

    if (existing) {
      // Combine adjustments (multiplicative, capped at 1.35 and minimum 0.75)
      existing.volumeMultiplier = Math.min(1.35, Math.max(0.75,
        existing.volumeMultiplier * priorityMultiplier));
      if (priority.priority <= 2) {
        existing.reason = 'user_priority';
      }
    } else if (priorityMultiplier !== 1.0) {
      adjustments.set(priority.muscleGroup, {
        muscleGroup: priority.muscleGroup,
        volumeMultiplier: priorityMultiplier,
        reason: priority.priority <= 2 ? 'user_priority' : 'dominant',
      });
    }
  }

  // Reduce volume for dominant muscles if not prioritized by user
  for (const muscle of imbalanceAnalysis.dominantMuscles) {
    const userPriority = userPriorities.find(p => p.muscleGroup === muscle);
    if (!userPriority || userPriority.priority > 3) {
      const existing = adjustments.get(muscle);
      if (!existing) {
        adjustments.set(muscle, {
          muscleGroup: muscle,
          volumeMultiplier: 0.90,
          reason: 'dominant',
        });
      }
    }
  }

  return Array.from(adjustments.values());
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getAverageBilateral(left?: number, right?: number): number | undefined {
  if (left && right && left > 0 && right > 0) {
    return (left + right) / 2;
  }
  return undefined;
}

function formatBodyPartName(part: string): string {
  return part.charAt(0).toUpperCase() + part.slice(1);
}

function getProportionalityRecommendation(
  part: string,
  status: 'underdeveloped' | 'overdeveloped'
): string {
  const recommendations: Record<string, Record<string, string>> = {
    neck: {
      underdeveloped: 'Consider adding neck curls and shrugs to develop trap/neck size.',
      overdeveloped: 'Neck is well-developed. Maintain current volume.',
    },
    shoulders: {
      underdeveloped: 'Add more shoulder volume: lateral raises, overhead press, and rear delt work.',
      overdeveloped: 'Shoulders are well-developed. Can reduce isolation volume.',
    },
    chest: {
      underdeveloped: 'Increase chest volume with incline and flat pressing movements.',
      overdeveloped: 'Chest is well-developed. Focus on other lagging areas.',
    },
    bicep: {
      underdeveloped: 'Add bicep isolation work: curls with variety of grips and angles.',
      overdeveloped: 'Biceps are well-developed. Maintain with compound pulling movements.',
    },
    forearm: {
      underdeveloped: 'Add forearm work: wrist curls, reverse curls, and farmer carries.',
      overdeveloped: 'Forearms are well-developed relative to frame.',
    },
    thigh: {
      underdeveloped: 'Increase leg volume: squats, leg press, and isolation work.',
      overdeveloped: 'Legs are well-developed. Consider maintenance volume.',
    },
    calf: {
      underdeveloped: 'Calves need more volume: standing and seated calf raises 3-4x per week.',
      overdeveloped: 'Calves are well-developed relative to frame.',
    },
    hips: {
      underdeveloped: 'Add glute-focused work: hip thrusts, Romanian deadlifts.',
      overdeveloped: 'Glutes are well-developed.',
    },
  };

  return recommendations[part]?.[status] || '';
}

function createSanityCheck(
  lift: string,
  liftValueKg: number,
  measurement: string,
  measurementCm: number,
  expectedRangeCm: [number, number]
): LiftMeasurementSanityCheck {
  let status: 'consistent' | 'measurement_high' | 'measurement_low';
  let message: string;

  if (measurementCm < expectedRangeCm[0]) {
    status = 'measurement_low';
    message = `Your ${measurement.toLowerCase()} (${measurementCm.toFixed(1)}cm) is smaller than expected for your ${lift} strength. Consider more hypertrophy-focused training for this area.`;
  } else if (measurementCm > expectedRangeCm[1]) {
    status = 'measurement_high';
    message = `Your ${measurement.toLowerCase()} (${measurementCm.toFixed(1)}cm) is larger than typical for your ${lift} strength. Great development! Consider focusing on strength for this area.`;
  } else {
    status = 'consistent';
    message = `Your ${measurement.toLowerCase()} development is consistent with your ${lift} strength.`;
  }

  return {
    lift,
    liftValueKg,
    relatedMeasurement: measurement,
    measurementCm,
    expectedRangeCm: [
      Math.round(expectedRangeCm[0] * 10) / 10,
      Math.round(expectedRangeCm[1] * 10) / 10
    ],
    status,
    message,
  };
}

function generateRecommendations(
  asymmetries: BilateralAsymmetry[],
  proportionality: ProportionalityAnalysis[],
  sanityChecks: LiftMeasurementSanityCheck[]
): string[] {
  const recommendations: string[] = [];

  // Priority 1: Significant asymmetries
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'significant' && asymmetry.recommendation) {
      recommendations.push(asymmetry.recommendation);
    }
  }

  // Priority 2: Underdeveloped body parts
  for (const analysis of proportionality) {
    if (analysis.status === 'underdeveloped' && analysis.recommendation) {
      recommendations.push(analysis.recommendation);
    }
  }

  // Priority 3: Moderate asymmetries
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'moderate' && asymmetry.recommendation) {
      recommendations.push(asymmetry.recommendation);
    }
  }

  // Priority 4: Lift consistency issues
  for (const check of sanityChecks) {
    if (check.status === 'measurement_low') {
      recommendations.push(check.message);
    }
  }

  // Limit to top 5 recommendations
  return recommendations.slice(0, 5);
}

function calculateBalanceScore(
  asymmetries: BilateralAsymmetry[],
  proportionality: ProportionalityAnalysis[]
): number {
  let score = 100;

  // Deduct for asymmetries
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'minor') score -= 5;
    if (asymmetry.severity === 'moderate') score -= 10;
    if (asymmetry.severity === 'significant') score -= 15;
  }

  // Deduct for proportionality issues
  for (const analysis of proportionality) {
    if (analysis.status === 'underdeveloped') {
      const deviation = 100 - analysis.percentOfIdeal;
      score -= Math.min(15, deviation / 2);
    } else if (analysis.status === 'overdeveloped' && analysis.bodyPart === 'Waist') {
      const deviation = analysis.percentOfIdeal - 100;
      score -= Math.min(10, deviation / 3);
    }
  }

  return Math.max(0, Math.round(score));
}
