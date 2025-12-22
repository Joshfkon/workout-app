/**
 * P-Ratio (Partition Ratio) Calculation
 *
 * P-ratio describes how the body partitions weight loss between fat and lean tissue.
 * - P-ratio of 0.80 = 80% of weight lost is fat, 20% is lean mass
 * - P-ratio of 0.95 = 95% fat loss, 5% lean loss (excellent)
 * - P-ratio of 0.60 = 60% fat loss, 40% lean loss (poor - crash diet territory)
 *
 * Research on trained individuals doing moderate deficits with adequate protein
 * shows typical P-ratios of 0.75-0.85.
 */

import type {
  PartitionRatioFactors,
  PRatioInputs,
  ScanConditions,
  ScanConfidence,
} from './types';

// Research-based baseline for moderate deficit + training
export const BASE_P_RATIO = 0.80;

// Base uncertainty in P-ratio predictions (±12% is typical variance)
const BASE_UNCERTAINTY = 0.12;

/**
 * Calculate scan confidence based on conditions
 */
export function calculateScanConfidence(conditions: ScanConditions): ScanConfidence {
  let score = 0;

  // Fasted morning scan is most reliable
  if (conditions.timeOfDay === 'morning_fasted') score += 3;
  else if (conditions.timeOfDay === 'morning_fed') score += 2;
  else score += 1;

  // Hydration affects readings
  if (conditions.hydrationStatus === 'normal') score += 2;
  else if (conditions.hydrationStatus === 'unknown') score += 1;
  else score += 0; // Dehydrated/overhydrated reduces accuracy

  // Recent workout causes fluid shifts
  if (!conditions.recentWorkout) score += 1;

  // Same provider reduces inter-machine variance
  if (conditions.sameProviderAsPrevious) score += 2;

  if (score >= 7) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

/**
 * Calculate P-ratio based on user inputs and conditions
 *
 * @param inputs - User's current training, nutrition, and body comp data
 * @returns P-ratio factors including individual components and final ratio
 */
export function calculatePRatio(inputs: PRatioInputs): PartitionRatioFactors {
  const baseRatio = BASE_P_RATIO;

  // ========================================
  // PROTEIN FACTOR
  // Research: >1.6g/kg preserves muscle well
  // ========================================
  let proteinFactor = 1.0;
  const proteinPerKg = inputs.avgDailyProteinPerKgBW;

  if (proteinPerKg >= 2.2) {
    proteinFactor = 1.08; // Optimal
  } else if (proteinPerKg >= 1.8) {
    proteinFactor = 1.04; // Good
  } else if (proteinPerKg >= 1.6) {
    proteinFactor = 1.0; // Adequate
  } else if (proteinPerKg >= 1.2) {
    proteinFactor = 0.95; // Suboptimal
  } else {
    proteinFactor = 0.88; // Poor - significant muscle risk
  }

  // ========================================
  // TRAINING FACTOR
  // Volume provides muscle preservation signal
  // ========================================
  let trainingFactor = 1.0;
  const weeklySets = inputs.avgWeeklyTrainingSets;

  if (weeklySets >= 15) {
    trainingFactor = 1.06; // Strong stimulus
  } else if (weeklySets >= 10) {
    trainingFactor = 1.02; // Adequate
  } else if (weeklySets >= 5) {
    trainingFactor = 0.96; // Minimal
  } else {
    trainingFactor = 0.88; // No training - significant muscle risk
  }

  // ========================================
  // DEFICIT FACTOR
  // Larger deficits = worse partitioning
  // ========================================
  let deficitFactor = 1.0;
  const deficitPercent = inputs.deficitPercent;

  if (deficitPercent <= 15) {
    deficitFactor = 1.04; // Conservative deficit
  } else if (deficitPercent <= 20) {
    deficitFactor = 1.0; // Moderate
  } else if (deficitPercent <= 25) {
    deficitFactor = 0.95; // Aggressive
  } else if (deficitPercent <= 30) {
    deficitFactor = 0.88; // Very aggressive
  } else {
    deficitFactor = 0.8; // Crash diet territory
  }

  // ========================================
  // BODY FAT FACTOR
  // Leaner = worse partitioning (body fights harder)
  // ========================================
  let bodyFatFactor = 1.0;
  const bf = inputs.currentBodyFatPercent;
  const isMale = inputs.biologicalSex === 'male';

  // Thresholds differ by sex
  if (isMale) {
    if (bf >= 20) {
      bodyFatFactor = 1.08; // Plenty of fat to lose
    } else if (bf >= 15) {
      bodyFatFactor = 1.02; // Good position
    } else if (bf >= 12) {
      bodyFatFactor = 0.95; // Getting lean
    } else if (bf >= 10) {
      bodyFatFactor = 0.85; // Very lean - partitioning worsens
    } else {
      bodyFatFactor = 0.72; // Competition lean - muscle loss likely
    }
  } else {
    if (bf >= 28) {
      bodyFatFactor = 1.08;
    } else if (bf >= 22) {
      bodyFatFactor = 1.02;
    } else if (bf >= 18) {
      bodyFatFactor = 0.95;
    } else if (bf >= 15) {
      bodyFatFactor = 0.85;
    } else {
      bodyFatFactor = 0.72;
    }
  }

  // ========================================
  // TRAINING AGE FACTOR
  // Beginners can sometimes recomp
  // ========================================
  let ageFactor = 1.0;

  if (inputs.trainingAge === 'beginner' && inputs.currentBodyFatPercent > 18) {
    ageFactor = 1.1; // Newbie gains possible
  } else if (inputs.trainingAge === 'beginner') {
    ageFactor = 1.05;
  } else if (inputs.trainingAge === 'advanced') {
    ageFactor = 0.98; // Harder to preserve at advanced level
  }

  // ========================================
  // ENHANCED FACTOR
  // PEDs significantly improve partitioning
  // ========================================
  let enhancedFactor = 1.0;

  if (inputs.isEnhanced) {
    enhancedFactor = 1.15; // Much better muscle preservation
  }

  // ========================================
  // CALCULATE FINAL P-RATIO
  // ========================================
  const rawPRatio =
    baseRatio *
    proteinFactor *
    trainingFactor *
    deficitFactor *
    bodyFatFactor *
    ageFactor *
    enhancedFactor;

  // Clamp to reasonable range (0.5 to 1.0)
  const finalPRatio = Math.min(1.0, Math.max(0.5, rawPRatio));

  // ========================================
  // CONFIDENCE RANGE
  // This is critical - P-ratio has high variance
  // ========================================
  let uncertaintyMultiplier = 1.0;

  // More uncertainty if no personal calibration data
  if (!inputs.personalPRatioHistory || inputs.personalPRatioHistory.length === 0) {
    uncertaintyMultiplier *= 1.3;
  }

  // More uncertainty in extreme conditions
  if (inputs.currentBodyFatPercent < 12 || inputs.deficitPercent > 25) {
    uncertaintyMultiplier *= 1.2;
  }

  // Beginners are less predictable
  if (inputs.trainingAge === 'beginner') {
    uncertaintyMultiplier *= 1.15;
  }

  const uncertainty = BASE_UNCERTAINTY * uncertaintyMultiplier;

  const confidenceRange: [number, number] = [
    Math.max(0.5, finalPRatio - uncertainty),
    Math.min(1.0, finalPRatio + uncertainty),
  ];

  return {
    baseRatio,
    proteinFactor,
    trainingFactor,
    deficitFactor,
    bodyFatFactor,
    ageFactor,
    enhancedFactor,
    finalPRatio,
    confidenceRange,
  };
}

/**
 * Get a text description of what the P-ratio means
 */
export function getPRatioDescription(pRatio: number): string {
  if (pRatio >= 0.9) {
    return 'Excellent - almost all weight loss is from fat';
  } else if (pRatio >= 0.8) {
    return 'Good - mostly fat loss with minimal muscle loss';
  } else if (pRatio >= 0.7) {
    return 'Fair - some muscle loss expected';
  } else if (pRatio >= 0.6) {
    return 'Poor - significant muscle loss expected';
  } else {
    return 'Very poor - high risk of muscle loss';
  }
}

/**
 * Get P-ratio quality rating
 */
export function getPRatioQuality(
  pRatio: number
): 'excellent' | 'good' | 'fair' | 'poor' {
  if (pRatio >= 0.85) return 'excellent';
  if (pRatio >= 0.75) return 'good';
  if (pRatio >= 0.65) return 'fair';
  return 'poor';
}

/**
 * Explain the factors affecting this P-ratio calculation
 */
export function explainPRatioFactors(factors: PartitionRatioFactors): string[] {
  const explanations: string[] = [];

  // Protein
  if (factors.proteinFactor >= 1.04) {
    explanations.push('High protein intake is optimizing muscle retention');
  } else if (factors.proteinFactor < 0.96) {
    explanations.push('Protein intake could be improved for better results');
  }

  // Training
  if (factors.trainingFactor >= 1.04) {
    explanations.push('Training volume is providing strong muscle preservation signal');
  } else if (factors.trainingFactor < 0.96) {
    explanations.push('More training volume would help preserve muscle');
  }

  // Deficit
  if (factors.deficitFactor >= 1.02) {
    explanations.push('Conservative deficit is favorable for body composition');
  } else if (factors.deficitFactor < 0.95) {
    explanations.push('Aggressive deficit may increase muscle loss');
  }

  // Body fat
  if (factors.bodyFatFactor < 0.9) {
    explanations.push('Lower body fat makes muscle preservation more challenging');
  }

  // Enhanced
  if (factors.enhancedFactor > 1.0) {
    explanations.push('Enhanced status significantly improves partitioning');
  }

  return explanations;
}
