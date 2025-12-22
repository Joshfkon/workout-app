/**
 * Body Composition Prediction
 *
 * Predicts fat vs lean mass changes based on P-ratio and weight targets.
 * Always presents predictions with prominent confidence intervals.
 */

import type {
  DEXAScan,
  BodyCompPrediction,
  PredictionConfidence,
  UserBodyCompProfile,
  PartitionRatioFactors,
} from './types';

/**
 * Predict body composition at a target weight
 *
 * @param currentScan - Most recent DEXA scan data
 * @param targetWeight - Target weight in kg
 * @param pRatioFactors - Calculated P-ratio factors
 * @param profile - User's body composition profile (for calibration)
 * @returns Prediction with confidence ranges
 */
export function predictBodyComposition(
  currentScan: DEXAScan,
  targetWeight: number,
  pRatioFactors: PartitionRatioFactors,
  profile: UserBodyCompProfile
): BodyCompPrediction {
  const currentWeight = currentScan.totalMassKg;
  const weightChange = targetWeight - currentWeight; // Negative if losing

  // Use personal P-ratio if calibrated, otherwise use calculated
  const pRatio =
    profile.learnedPRatio && profile.pRatioConfidence !== 'none'
      ? profile.learnedPRatio
      : pRatioFactors.finalPRatio;

  const [pRatioLow, pRatioHigh] = pRatioFactors.confidenceRange;

  // ========================================
  // EXPECTED CASE (point estimate)
  // ========================================
  const expectedFatChange = weightChange * pRatio;
  const expectedLeanChange = weightChange * (1 - pRatio);

  const expectedFatMass = currentScan.fatMassKg + expectedFatChange;
  const expectedLeanMass = currentScan.leanMassKg + expectedLeanChange;
  const expectedBfPercent = (expectedFatMass / targetWeight) * 100;

  // ========================================
  // OPTIMISTIC CASE (high P-ratio)
  // ========================================
  const optimisticFatChange = weightChange * pRatioHigh;
  const optimisticLeanChange = weightChange * (1 - pRatioHigh);

  const optimisticFatMass = currentScan.fatMassKg + optimisticFatChange;
  const optimisticLeanMass = currentScan.leanMassKg + optimisticLeanChange;
  const optimisticBfPercent = (optimisticFatMass / targetWeight) * 100;

  // ========================================
  // PESSIMISTIC CASE (low P-ratio)
  // ========================================
  const pessimisticFatChange = weightChange * pRatioLow;
  const pessimisticLeanChange = weightChange * (1 - pRatioLow);

  const pessimisticFatMass = currentScan.fatMassKg + pessimisticFatChange;
  const pessimisticLeanMass = currentScan.leanMassKg + pessimisticLeanChange;
  const pessimisticBfPercent = (pessimisticFatMass / targetWeight) * 100;

  // ========================================
  // CONFIDENCE ASSESSMENT
  // ========================================
  const confidenceLevel = determineConfidenceLevel(
    profile,
    pRatioFactors,
    Math.abs(weightChange)
  );

  const confidenceFactors = buildConfidenceFactors(profile, pRatioFactors);

  return {
    targetDate: new Date(), // Set by caller
    targetWeight,

    predictedFatMass: expectedFatMass,
    predictedLeanMass: expectedLeanMass,
    predictedBodyFatPercent: expectedBfPercent,

    fatMassRange: {
      optimistic: optimisticFatMass,
      expected: expectedFatMass,
      pessimistic: pessimisticFatMass,
    },
    leanMassRange: {
      optimistic: optimisticLeanMass,
      expected: expectedLeanMass,
      pessimistic: pessimisticLeanMass,
    },
    bodyFatPercentRange: {
      optimistic: optimisticBfPercent,
      expected: expectedBfPercent,
      pessimistic: pessimisticBfPercent,
    },

    confidenceLevel,
    confidenceFactors,

    assumptions: {
      avgDailyDeficit: 0, // Filled by caller
      avgDailyProtein: 0,
      avgWeeklyVolume: 0,
      pRatioUsed: pRatio,
    },
  };
}

/**
 * Determine confidence level for prediction
 * NEVER returns "high" - body comp predictions always have uncertainty
 */
function determineConfidenceLevel(
  profile: UserBodyCompProfile,
  factors: PartitionRatioFactors,
  weightChangeKg: number
): PredictionConfidence {
  const rangeSpread = factors.confidenceRange[1] - factors.confidenceRange[0];
  const hasPersonalData = profile.pRatioDataPoints >= 2;
  const isSmallChange = weightChangeKg < 5;

  if (hasPersonalData && isSmallChange && rangeSpread < 0.15) {
    return 'reasonable';
  }

  if (hasPersonalData || (isSmallChange && rangeSpread < 0.2)) {
    return 'moderate';
  }

  return 'low';
}

/**
 * Build explanatory factors for confidence level
 */
function buildConfidenceFactors(
  profile: UserBodyCompProfile,
  factors: PartitionRatioFactors
): string[] {
  const messages: string[] = [];

  // Always lead with uncertainty acknowledgment
  messages.push('Body composition predictions have inherent uncertainty');

  if (profile.pRatioDataPoints === 0) {
    messages.push('No personal DEXA history yet - using research averages');
  } else if (profile.pRatioDataPoints === 1) {
    messages.push('Limited personal data (1 scan pair) - predictions will improve');
  } else {
    messages.push(`Calibrated from ${profile.pRatioDataPoints} scan comparisons`);
  }

  if (factors.bodyFatFactor < 0.9) {
    messages.push('Already lean - partitioning typically worsens');
  }

  if (factors.deficitFactor < 0.92) {
    messages.push('Aggressive deficit may increase muscle loss');
  }

  if (factors.proteinFactor < 0.96) {
    messages.push('Higher protein intake may improve results');
  }

  if (factors.trainingFactor < 0.96) {
    messages.push('More training volume may preserve more muscle');
  }

  return messages;
}

/**
 * Calculate what the weight loss breakdown means in practical terms
 */
export function explainWeightLossBreakdown(
  prediction: BodyCompPrediction,
  currentScan: DEXAScan
): {
  bestCase: { fatLoss: number; leanLoss: number };
  expected: { fatLoss: number; leanLoss: number };
  worstCase: { fatLoss: number; leanLoss: number };
} {
  const totalLoss = currentScan.totalMassKg - prediction.targetWeight;

  return {
    bestCase: {
      fatLoss: currentScan.fatMassKg - prediction.fatMassRange.optimistic,
      leanLoss: currentScan.leanMassKg - prediction.leanMassRange.optimistic,
    },
    expected: {
      fatLoss: currentScan.fatMassKg - prediction.fatMassRange.expected,
      leanLoss: currentScan.leanMassKg - prediction.leanMassRange.expected,
    },
    worstCase: {
      fatLoss: currentScan.fatMassKg - prediction.fatMassRange.pessimistic,
      leanLoss: currentScan.leanMassKg - prediction.leanMassRange.pessimistic,
    },
  };
}

/**
 * Generate predictions for multiple weight targets
 */
export function generateWeightScenarios(
  currentScan: DEXAScan,
  pRatioFactors: PartitionRatioFactors,
  profile: UserBodyCompProfile,
  weightDeltas: number[] = [-2.5, -5, -7.5, -10]
): BodyCompPrediction[] {
  return weightDeltas.map((delta) => {
    const targetWeight = currentScan.totalMassKg + delta;
    return predictBodyComposition(currentScan, targetWeight, pRatioFactors, profile);
  });
}

/**
 * Calculate time to reach target weight given deficit
 */
export function estimateTimeToTarget(
  currentWeight: number,
  targetWeight: number,
  dailyDeficit: number
): { weeks: number; days: number } {
  const weightChangeKg = Math.abs(targetWeight - currentWeight);

  // 1 kg of body mass ≈ 7700 calories
  const caloriesToBurn = weightChangeKg * 7700;
  const totalDays = caloriesToBurn / dailyDeficit;

  return {
    weeks: Math.floor(totalDays / 7),
    days: Math.round(totalDays % 7),
  };
}

/**
 * Calculate what deficit is needed to reach target weight in time
 */
export function calculateRequiredDeficit(
  currentWeight: number,
  targetWeight: number,
  targetWeeks: number
): number {
  const weightChangeKg = Math.abs(targetWeight - currentWeight);
  const caloriesToBurn = weightChangeKg * 7700;
  const totalDays = targetWeeks * 7;

  return Math.round(caloriesToBurn / totalDays);
}

/**
 * Generate the projection date based on deficit
 */
export function calculateProjectionDate(
  currentWeight: number,
  targetWeight: number,
  dailyDeficit: number
): Date {
  const time = estimateTimeToTarget(currentWeight, targetWeight, dailyDeficit);
  const totalDays = time.weeks * 7 + time.days;

  const projectionDate = new Date();
  projectionDate.setDate(projectionDate.getDate() + totalDays);

  return projectionDate;
}

/**
 * Create a default empty profile for new users
 */
export function createEmptyProfile(userId: string): UserBodyCompProfile {
  return {
    userId,
    scans: [],
    learnedPRatio: null,
    pRatioConfidence: 'none',
    pRatioDataPoints: 0,
    proteinModifier: 1.0,
    trainingModifier: 1.0,
    deficitModifier: 1.0,
    trainingAge: 'intermediate',
    isEnhanced: false,
    lastUpdated: new Date(),
  };
}
