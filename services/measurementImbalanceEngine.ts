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
  upper_back?: number;  // Upper back/lats at widest point
  lower_back?: number;  // Lower back at narrowest point above hips
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
 * Strength imbalance detected from lift ratios
 */
export interface StrengthImbalance {
  type: 'upper_lower' | 'push_pull' | 'anterior_posterior' | 'horizontal_vertical';
  description: string;
  severity: 'minor' | 'moderate' | 'significant';
  recommendation: string;
  /** Related muscle groups that need attention */
  laggingMuscles: MuscleGroup[];
  /** Related muscle groups that are dominant */
  dominantMuscles: MuscleGroup[];
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
  /** Strength imbalances from lift ratios (works without measurements) */
  strengthImbalances: StrengthImbalance[];
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
  upper_back: 7.0,     // 7.0x wrist (lats at widest, slightly narrower than shoulders)
  bicep: 2.5,          // 2.5x wrist (flexed)
  forearm: 1.88,       // 1.88x wrist
  // Core
  waist: 4.5,          // 4.5x wrist (at navel)
  lower_back: 4.75,    // 4.75x wrist (slightly larger than waist for V-taper)
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
  upper_back: 0.56,    // 56% of height (lats at widest)
  bicep: 0.2,          // 20% of height
  forearm: 0.17,       // 17% of height
  waist: 0.45,         // 45% of height
  lower_back: 0.47,    // 47% of height (slightly larger than waist)
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
  upper_back: ['lats', 'traps', 'rhomboids'],
  lower_back: ['lower_back', 'lats'],
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
    upper_back: [0.5, 0.8], // ~100-130cm upper back for 200-250kg deadlift
    lower_back: [0.35, 0.55], // Lower back development
  },
  rowKg: {
    upper_back: [0.8, 1.2], // ~100-130cm upper back for 100-120kg row
  },
  curlKg: {
    bicep: [0.5, 0.8],      // ~35-45cm bicep for 50-60kg curl
  },
};

/**
 * Ideal lift ratios for balanced strength development
 */
const IDEAL_LIFT_RATIOS = {
  benchToSquat: 0.75,       // Bench should be ~75% of squat
  benchToDeadlift: 0.60,    // Bench should be ~60% of deadlift
  ohpToBench: 0.60,         // OHP should be ~60% of bench
  rowToBench: 0.75,         // Row should be ~75% of bench (push/pull balance)
  squatToDeadlift: 0.80,    // Squat should be ~80% of deadlift
};

const RATIO_TOLERANCE = 0.15; // 15% deviation is acceptable

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
 * Analyze strength imbalances from lift ratios (works without measurements)
 */
export function analyzeStrengthImbalances(lifts: UserLifts): StrengthImbalance[] {
  const imbalances: StrengthImbalance[] = [];

  // Check bench to squat ratio (upper/lower balance)
  if (lifts.benchPressKg && lifts.squatKg && lifts.benchPressKg > 0 && lifts.squatKg > 0) {
    const ratio = lifts.benchPressKg / lifts.squatKg;
    const deviation = (ratio - IDEAL_LIFT_RATIOS.benchToSquat) / IDEAL_LIFT_RATIOS.benchToSquat;

    if (Math.abs(deviation) > RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' :
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';

      if (deviation > 0) {
        imbalances.push({
          type: 'upper_lower',
          description: 'Upper body pushing is strong relative to lower body',
          severity,
          recommendation: 'Prioritize squat variations and leg development. Consider increasing squat frequency.',
          laggingMuscles: ['quads', 'hamstrings', 'glutes'],
          dominantMuscles: ['chest', 'triceps'],
        });
      } else {
        imbalances.push({
          type: 'upper_lower',
          description: 'Lower body is strong relative to upper body pushing',
          severity,
          recommendation: 'Increase pressing volume and frequency. Focus on bench press and overhead press.',
          laggingMuscles: ['chest', 'triceps', 'shoulders'],
          dominantMuscles: ['quads', 'hamstrings', 'glutes'],
        });
      }
    }
  }

  // Check row to bench ratio (push/pull balance)
  if (lifts.benchPressKg && lifts.rowKg && lifts.benchPressKg > 0 && lifts.rowKg > 0) {
    const ratio = lifts.rowKg / lifts.benchPressKg;
    const deviation = (ratio - IDEAL_LIFT_RATIOS.rowToBench) / IDEAL_LIFT_RATIOS.rowToBench;

    if (deviation < -RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' :
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      imbalances.push({
        type: 'push_pull',
        description: 'Pushing strength exceeds pulling strength',
        severity,
        recommendation: 'Add more rowing and pulling volume. Common issue that can lead to shoulder problems. Aim for 2:1 or 1:1 pull-to-push ratio.',
        laggingMuscles: ['back', 'biceps', 'traps'],
        dominantMuscles: ['chest', 'triceps'],
      });
    }
  }

  // Check squat to deadlift ratio (anterior/posterior balance)
  if (lifts.squatKg && lifts.deadliftKg && lifts.squatKg > 0 && lifts.deadliftKg > 0) {
    const ratio = lifts.squatKg / lifts.deadliftKg;
    const deviation = (ratio - IDEAL_LIFT_RATIOS.squatToDeadlift) / IDEAL_LIFT_RATIOS.squatToDeadlift;

    if (Math.abs(deviation) > RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' :
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';

      if (deviation > 0) {
        imbalances.push({
          type: 'anterior_posterior',
          description: 'Quad-dominant: squat is strong relative to deadlift',
          severity,
          recommendation: 'Add more hip hinge work (RDLs, good mornings) and posterior chain development. Focus on hamstring and glute strength.',
          laggingMuscles: ['hamstrings', 'glutes'],
          dominantMuscles: ['quads'],
        });
      } else {
        imbalances.push({
          type: 'anterior_posterior',
          description: 'Hip-dominant: deadlift is strong relative to squat',
          severity,
          recommendation: 'Focus on squat technique and quad-focused accessories. Consider front squats and leg press.',
          laggingMuscles: ['quads'],
          dominantMuscles: ['hamstrings', 'glutes'],
        });
      }
    }
  }

  // Check OHP to bench ratio (horizontal/vertical pressing)
  if (lifts.overheadPressKg && lifts.benchPressKg && lifts.overheadPressKg > 0 && lifts.benchPressKg > 0) {
    const ratio = lifts.overheadPressKg / lifts.benchPressKg;
    const deviation = (ratio - IDEAL_LIFT_RATIOS.ohpToBench) / IDEAL_LIFT_RATIOS.ohpToBench;

    if (deviation < -RATIO_TOLERANCE) {
      const severity = Math.abs(deviation) > 0.3 ? 'significant' :
                       Math.abs(deviation) > 0.2 ? 'moderate' : 'minor';
      imbalances.push({
        type: 'horizontal_vertical',
        description: 'Overhead pressing is weak relative to horizontal pressing',
        severity,
        recommendation: 'Increase overhead pressing frequency. Consider shoulder mobility work and strict press variations.',
        laggingMuscles: ['shoulders', 'triceps'],
        dominantMuscles: ['chest'],
      });
    }
  }

  return imbalances;
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
 * Works with just lifts (no measurements required) or with both
 */
export function analyzeImbalances(
  measurements?: BodyMeasurements,
  lifts?: UserLifts,
  heightCm?: number,
  wristCm?: number
): ImbalanceAnalysis {
  // Run measurement-based analyses (only if measurements provided)
  const bilateralAsymmetries = measurements ? analyzeBilateralAsymmetries(measurements) : [];
  const proportionalityAnalysis = measurements ? analyzeProportionality(measurements, heightCm, wristCm) : [];
  const liftSanityChecks = (measurements && lifts) ? checkLiftMeasurementConsistency(measurements, lifts) : [];

  // Run lift-based strength imbalance analysis (works without measurements)
  const strengthImbalances = lifts ? analyzeStrengthImbalances(lifts) : [];

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

  // From strength imbalances (lift ratios)
  for (const imbalance of strengthImbalances) {
    for (const muscle of imbalance.laggingMuscles) {
      laggingMuscles.add(muscle);
    }
    for (const muscle of imbalance.dominantMuscles) {
      dominantMuscles.add(muscle);
    }
  }

  // Generate recommendations
  const recommendations = generateRecommendations(
    bilateralAsymmetries,
    proportionalityAnalysis,
    liftSanityChecks,
    strengthImbalances
  );

  // Calculate balance score (includes strength imbalances if no measurements)
  const balanceScore = calculateBalanceScore(
    bilateralAsymmetries,
    proportionalityAnalysis,
    strengthImbalances
  );

  return {
    bilateralAsymmetries,
    proportionalityAnalysis,
    liftSanityChecks,
    strengthImbalances,
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
  sanityChecks: LiftMeasurementSanityCheck[],
  strengthImbalances: StrengthImbalance[] = []
): string[] {
  const recommendations: string[] = [];

  // Priority 1: Significant strength imbalances (from lifts)
  for (const imbalance of strengthImbalances) {
    if (imbalance.severity === 'significant') {
      recommendations.push(imbalance.recommendation);
    }
  }

  // Priority 2: Significant asymmetries (from measurements)
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'significant' && asymmetry.recommendation) {
      recommendations.push(asymmetry.recommendation);
    }
  }

  // Priority 3: Underdeveloped body parts (from measurements)
  for (const analysis of proportionality) {
    if (analysis.status === 'underdeveloped' && analysis.recommendation) {
      recommendations.push(analysis.recommendation);
    }
  }

  // Priority 4: Moderate strength imbalances
  for (const imbalance of strengthImbalances) {
    if (imbalance.severity === 'moderate') {
      recommendations.push(imbalance.recommendation);
    }
  }

  // Priority 5: Moderate asymmetries
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'moderate' && asymmetry.recommendation) {
      recommendations.push(asymmetry.recommendation);
    }
  }

  // Priority 6: Lift consistency issues
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
  proportionality: ProportionalityAnalysis[],
  strengthImbalances: StrengthImbalance[] = []
): number {
  let score = 100;

  // Deduct for strength imbalances (from lifts)
  for (const imbalance of strengthImbalances) {
    if (imbalance.severity === 'minor') score -= 8;
    if (imbalance.severity === 'moderate') score -= 12;
    if (imbalance.severity === 'significant') score -= 18;
  }

  // Deduct for asymmetries (from measurements)
  for (const asymmetry of asymmetries) {
    if (asymmetry.severity === 'minor') score -= 5;
    if (asymmetry.severity === 'moderate') score -= 10;
    if (asymmetry.severity === 'significant') score -= 15;
  }

  // Deduct for proportionality issues (from measurements)
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

// ============================================================
// TARGET-BASED VOLUME ADJUSTMENTS
// ============================================================

/**
 * Target measurements for comparison
 */
export interface MeasurementTargets {
  neck?: number;
  shoulders?: number;
  chest?: number;
  upper_back?: number;
  lower_back?: number;
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
 * Mapping from measurements to muscle groups for target adjustments
 */
const TARGET_MEASUREMENT_TO_MUSCLES: Record<string, MuscleGroup[]> = {
  neck: ['traps'],
  shoulders: ['shoulders'],
  chest: ['chest'],
  upper_back: ['lats', 'traps', 'rhomboids'],
  lower_back: ['lower_back'],
  bicep: ['biceps'],
  left_bicep: ['biceps'],
  right_bicep: ['biceps'],
  forearm: ['forearms'],
  left_forearm: ['forearms'],
  right_forearm: ['forearms'],
  waist: ['abs'],
  hips: ['glutes'],
  thigh: ['quads', 'hamstrings'],
  left_thigh: ['quads', 'hamstrings'],
  right_thigh: ['quads', 'hamstrings'],
  calf: ['calves'],
  left_calf: ['calves'],
  right_calf: ['calves'],
};

/**
 * Calculate volume adjustments based on body composition targets
 * Muscles that need to grow more to hit targets get a volume boost
 * Muscles that are already at or above target can be maintained
 *
 * @param currentMeasurements - Current body measurements
 * @param targetMeasurements - Target body measurements
 * @returns Volume adjustments for the mesocycle builder
 */
export function calculateTargetBasedVolumeAdjustments(
  currentMeasurements: BodyMeasurements,
  targetMeasurements: MeasurementTargets
): VolumeAdjustment[] {
  const adjustments: VolumeAdjustment[] = [];
  const muscleProgress: Record<MuscleGroup, { progress: number; count: number }> = {} as Record<MuscleGroup, { progress: number; count: number }>;

  // Calculate progress for each measurement toward target
  for (const [key, target] of Object.entries(targetMeasurements)) {
    if (!target) continue;

    // Get current value (handle bilateral measurements)
    let current: number | undefined;
    if (key.startsWith('left_') || key.startsWith('right_')) {
      current = currentMeasurements[key as keyof BodyMeasurements];
    } else if (key === 'bicep') {
      // Average of both biceps
      const left = currentMeasurements.left_bicep;
      const right = currentMeasurements.right_bicep;
      current = left && right ? (left + right) / 2 : left || right;
    } else if (key === 'forearm') {
      const left = currentMeasurements.left_forearm;
      const right = currentMeasurements.right_forearm;
      current = left && right ? (left + right) / 2 : left || right;
    } else if (key === 'thigh') {
      const left = currentMeasurements.left_thigh;
      const right = currentMeasurements.right_thigh;
      current = left && right ? (left + right) / 2 : left || right;
    } else if (key === 'calf') {
      const left = currentMeasurements.left_calf;
      const right = currentMeasurements.right_calf;
      current = left && right ? (left + right) / 2 : left || right;
    } else {
      current = currentMeasurements[key as keyof BodyMeasurements];
    }

    if (!current) continue;

    // Calculate progress percentage
    // For waist, less is better; for everything else, more is better
    let progress: number;
    if (key === 'waist') {
      progress = current <= target ? 100 : (target / current) * 100;
    } else {
      progress = current >= target ? 100 : (current / target) * 100;
    }

    // Map to muscle groups
    const muscles = TARGET_MEASUREMENT_TO_MUSCLES[key];
    if (muscles) {
      for (const muscle of muscles) {
        if (!muscleProgress[muscle]) {
          muscleProgress[muscle] = { progress: 0, count: 0 };
        }
        muscleProgress[muscle].progress += progress;
        muscleProgress[muscle].count++;
      }
    }
  }

  // Convert progress to volume adjustments
  for (const [muscle, data] of Object.entries(muscleProgress)) {
    const avgProgress = data.progress / data.count;

    let volumeMultiplier = 1.0;
    let reason: 'lagging' | 'imbalance' | 'user_priority' | 'dominant' = 'user_priority';

    if (avgProgress < 70) {
      // Far from target - significant volume boost
      volumeMultiplier = 1.2;
      reason = 'lagging';
    } else if (avgProgress < 85) {
      // Moderate progress - moderate boost
      volumeMultiplier = 1.1;
      reason = 'lagging';
    } else if (avgProgress < 100) {
      // Close to target - small boost
      volumeMultiplier = 1.05;
      reason = 'user_priority';
    } else {
      // At or above target - maintenance (slight reduction)
      volumeMultiplier = 0.9;
      reason = 'dominant';
    }

    adjustments.push({
      muscleGroup: muscle as MuscleGroup,
      volumeMultiplier,
      reason,
    });
  }

  return adjustments;
}

/**
 * Get a summary of target progress for display
 */
export interface TargetProgressSummary {
  muscleGroup: MuscleGroup;
  currentCm: number;
  targetCm: number;
  progress: number;
  status: 'far' | 'close' | 'achieved';
}

export function getTargetProgressSummary(
  currentMeasurements: BodyMeasurements,
  targetMeasurements: MeasurementTargets
): TargetProgressSummary[] {
  const summaries: TargetProgressSummary[] = [];

  const measurementPairs: Array<{
    key: keyof BodyMeasurements;
    targetKey: keyof MeasurementTargets;
    muscle: MuscleGroup;
  }> = [
    { key: 'chest', targetKey: 'chest', muscle: 'chest' },
    { key: 'shoulders', targetKey: 'shoulders', muscle: 'shoulders' },
    { key: 'upper_back', targetKey: 'upper_back', muscle: 'lats' },
    { key: 'left_bicep', targetKey: 'left_bicep', muscle: 'biceps' },
    { key: 'right_bicep', targetKey: 'right_bicep', muscle: 'biceps' },
    { key: 'left_thigh', targetKey: 'left_thigh', muscle: 'quads' },
    { key: 'right_thigh', targetKey: 'right_thigh', muscle: 'quads' },
    { key: 'left_calf', targetKey: 'left_calf', muscle: 'calves' },
    { key: 'right_calf', targetKey: 'right_calf', muscle: 'calves' },
    { key: 'waist', targetKey: 'waist', muscle: 'abs' },
  ];

  for (const { key, targetKey, muscle } of measurementPairs) {
    const current = currentMeasurements[key];
    const target = targetMeasurements[targetKey];

    if (current && target) {
      const isWaist = key === 'waist';
      const progress = isWaist
        ? (current <= target ? 100 : (target / current) * 100)
        : (current >= target ? 100 : (current / target) * 100);

      summaries.push({
        muscleGroup: muscle,
        currentCm: current,
        targetCm: target,
        progress: Math.round(progress),
        status: progress >= 100 ? 'achieved' : progress >= 85 ? 'close' : 'far',
      });
    }
  }

  return summaries;
}
