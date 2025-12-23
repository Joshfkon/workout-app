/**
 * P-Ratio (Partitioning Ratio) Calculation
 * 
 * Predicts how weight loss/gain is partitioned between fat and muscle.
 * Based on research from Lyle McDonald, Alan Aragon, and others.
 * 
 * P-ratio = proportion of weight change that is fat loss/gain
 * Higher P-ratio = more fat loss, less muscle loss (better for cuts)
 * Lower P-ratio = more muscle loss, less fat loss (worse for cuts)
 */

import { calculateFFMI } from '@/services/bodyCompEngine';

export interface PRatioInputs {
  /** Average daily protein intake in grams */
  avgDailyProteinGrams: number;
  /** Average daily protein per kg bodyweight */
  avgDailyProteinPerKgBW: number;
  /** 
   * Average weekly TOTAL working sets across all muscles
   * (not per-muscle volume)
   */
  avgWeeklyTrainingSets: number;
  /** Average daily calorie deficit (negative) or surplus (positive) */
  avgDailyDeficitCals: number;
  /** 
   * Energy balance as percentage of TDEE
   * Negative = deficit (e.g., -20 means 20% deficit)
   * Positive = surplus (e.g., +15 means 15% surplus)
   */
  energyBalancePercent: number;
  /** Current body fat percentage */
  currentBodyFatPercent: number;
  /** Current lean mass in kg */
  currentLeanMassKg: number;
  /** Training age/experience level */
  trainingAge: 'beginner' | 'intermediate' | 'advanced';
  /** Whether user is enhanced (PEDs) */
  isEnhanced: boolean;
  /** Biological sex */
  biologicalSex: 'male' | 'female';
  /** Chronological age (for anabolic resistance adjustments) */
  chronologicalAge?: number;
  /** Personal P-ratio learned from DEXA scan history (if available) */
  personalPRatioHistory?: number[];
}

export interface PRatioResult {
  /** Final calculated P-ratio (0-1, where 1 = all fat loss) */
  finalPRatio: number;
  /** Confidence range [low, high] */
  confidenceRange: [number, number];
  /** Factors that influenced the calculation */
  factors: string[];
}

export interface BodyCompProjection {
  ffmi: {
    pessimistic: number;
    expected: number;
    optimistic: number;
  };
  bodyFatPercent: {
    pessimistic: number;
    expected: number;
    optimistic: number;
  };
  pRatioUsed: number;
  confidenceLevel: 'low' | 'reasonable' | 'high';
  factors: string[];
}

/**
 * Calculate P-ratio for weight loss
 * 
 * P-ratio typically ranges from 0.5 to 0.9
 * - 0.5 = 50% fat loss, 50% muscle loss (terrible)
 * - 0.9 = 90% fat loss, 10% muscle loss (excellent)
 */
export function calculatePRatio(inputs: PRatioInputs): PRatioResult {
  const factors: string[] = [];
  let pRatio = 0.75; // Base P-ratio (75% fat loss, 25% muscle loss)

  // 1. Body fat % effect (leaner = worse P-ratio)
  // At very low body fat, body protects fat more
  if (inputs.currentBodyFatPercent < 10) {
    pRatio -= 0.15;
    factors.push('Very low body fat (body protects fat stores)');
  } else if (inputs.currentBodyFatPercent < 15) {
    pRatio -= 0.10;
    factors.push('Low body fat');
  } else if (inputs.currentBodyFatPercent > 25) {
    pRatio += 0.05;
    factors.push('Higher body fat (easier fat loss)');
  }

  // 2. Protein intake effect
  if (inputs.avgDailyProteinPerKgBW >= 2.2) {
    pRatio += 0.08;
    factors.push('High protein intake (≥2.2g/kg)');
  } else if (inputs.avgDailyProteinPerKgBW >= 1.8) {
    pRatio += 0.05;
    factors.push('Good protein intake (1.8-2.2g/kg)');
  } else if (inputs.avgDailyProteinPerKgBW >= 1.4) {
    // No change
  } else {
    pRatio -= 0.10;
    factors.push('Low protein intake (<1.4g/kg)');
  }

  // 3. Training volume effect
  if (inputs.avgWeeklyTrainingSets >= 20) {
    pRatio += 0.05;
    factors.push('High training volume (≥20 sets/week)');
  } else if (inputs.avgWeeklyTrainingSets >= 12) {
    // No change
  } else if (inputs.avgWeeklyTrainingSets >= 8) {
    pRatio -= 0.03;
    factors.push('Moderate training volume (8-12 sets/week)');
  } else {
    pRatio -= 0.08;
    factors.push('Low training volume (<8 sets/week)');
  }

  // 4. Energy balance effect (larger deficit = worse P-ratio, larger surplus = more fat gain)
  const balanceMagnitude = Math.abs(inputs.energyBalancePercent);
  const isDeficit = inputs.energyBalancePercent < 0;
  
  if (isDeficit) {
    // Weight loss: larger deficit = worse P-ratio
    if (balanceMagnitude > 30) {
      pRatio -= 0.12;
      factors.push('Very large deficit (>30%)');
    } else if (balanceMagnitude > 20) {
      pRatio -= 0.08;
      factors.push('Large deficit (20-30%)');
    } else if (balanceMagnitude > 15) {
      pRatio -= 0.04;
      factors.push('Moderate deficit (15-20%)');
    } else if (balanceMagnitude < 10) {
      pRatio += 0.03;
      factors.push('Small deficit (<10%)');
    }
  } else {
    // Weight gain: larger surplus = more fat gain (handled in weight gain function)
    // This is mainly for reference, actual gain logic is separate
  }

  // 5. Training age effect
  if (inputs.trainingAge === 'beginner') {
    pRatio += 0.05; // Beginners can lose weight while gaining muscle
    factors.push('Beginner (better body composition changes)');
  } else if (inputs.trainingAge === 'advanced') {
    pRatio -= 0.03;
    factors.push('Advanced (harder to preserve muscle)');
  }

  // 6. Enhanced status
  if (inputs.isEnhanced) {
    pRatio += 0.10;
    factors.push('Enhanced (better muscle preservation)');
  }

  // 7. Age effect (older individuals have worse partitioning due to anabolic resistance)
  if (inputs.chronologicalAge) {
    if (inputs.chronologicalAge >= 50) {
      pRatio -= 0.05;
      factors.push('Age-related anabolic resistance (50+)');
    } else if (inputs.chronologicalAge >= 40) {
      pRatio -= 0.02;
      factors.push('Age-related anabolic resistance (40+)');
    }
  }

  // 8. Sex effect (females typically have slightly better P-ratio at same body fat)
  if (inputs.biologicalSex === 'female' && inputs.currentBodyFatPercent > 20) {
    pRatio += 0.02;
  }

  // 9. Personal P-ratio history (if available, use it with scaled trust)
  if (inputs.personalPRatioHistory && inputs.personalPRatioHistory.length > 0) {
    const avgPersonalPRatio = inputs.personalPRatioHistory.reduce((a, b) => a + b, 0) / inputs.personalPRatioHistory.length;
    
    // Scale trust based on data points
    // More data points = higher trust in personal history
    const dataPoints = inputs.personalPRatioHistory.length;
    const personalWeight = dataPoints >= 3 ? 0.75 : dataPoints === 2 ? 0.55 : 0.35;
    
    pRatio = pRatio * (1 - personalWeight) + avgPersonalPRatio * personalWeight;
    factors.push(`Using learned P-ratio from ${dataPoints} DEXA scan pair(s) (${Math.round(personalWeight * 100)}% weight)`);
  }

  // Clamp P-ratio to reasonable bounds
  pRatio = Math.max(0.40, Math.min(0.95, pRatio));

  // Calculate confidence range
  // Wider range if we don't have personal history
  const baseUncertainty = inputs.personalPRatioHistory && inputs.personalPRatioHistory.length > 0 ? 0.08 : 0.15;
  const energyBalanceMagnitude = Math.abs(inputs.energyBalancePercent);
  const uncertainty = baseUncertainty * (1 + (energyBalanceMagnitude / 100)); // Larger deficit/surplus = more uncertainty
  
  const confidenceRange: [number, number] = [
    Math.max(0.40, pRatio - uncertainty),
    Math.min(0.95, pRatio + uncertainty),
  ];

  return {
    finalPRatio: Math.round(pRatio * 100) / 100,
    confidenceRange,
    factors,
  };
}

/**
 * Predict body composition change for weight loss
 */
export function predictBodyComposition(
  currentWeightKg: number,
  predictedWeightKg: number,
  currentBodyFatPercent: number,
  heightCm: number,
  pRatioResult: PRatioResult
): BodyCompProjection {
  const weightChangeKg = predictedWeightKg - currentWeightKg;
  const isLosing = weightChangeKg < 0;
  
  if (isLosing) {
    return predictWeightLossComposition(
      currentWeightKg,
      predictedWeightKg,
      currentBodyFatPercent,
      heightCm,
      pRatioResult
    );
  } else {
    // Weight gain uses different logic (handled separately)
    throw new Error('Use projectWeightGain for weight gain scenarios');
  }
}

function predictWeightLossComposition(
  currentWeightKg: number,
  predictedWeightKg: number,
  currentBodyFatPercent: number,
  heightCm: number,
  pRatioResult: PRatioResult
): BodyCompProjection {
  const weightChangeKg = predictedWeightKg - currentWeightKg;
  const [pRatioLow, pRatioHigh] = pRatioResult.confidenceRange;
  const pRatioMid = pRatioResult.finalPRatio;

  const currentFatMassKg = currentWeightKg * (currentBodyFatPercent / 100);
  const currentLeanMassKg = currentWeightKg - currentFatMassKg;

  // Pessimistic (low P-ratio = more muscle loss)
  const pessimisticFatLoss = weightChangeKg * pRatioLow;
  const pessimisticLeanLoss = weightChangeKg * (1 - pRatioLow);
  const pessimisticFatMass = currentFatMassKg + pessimisticFatLoss;
  const pessimisticLeanMass = currentLeanMassKg + pessimisticLeanLoss;
  const pessimisticBF = (pessimisticFatMass / predictedWeightKg) * 100;

  // Expected (mid P-ratio)
  const expectedFatLoss = weightChangeKg * pRatioMid;
  const expectedLeanLoss = weightChangeKg * (1 - pRatioMid);
  const expectedFatMass = currentFatMassKg + expectedFatLoss;
  const expectedLeanMass = currentLeanMassKg + expectedLeanLoss;
  const expectedBF = (expectedFatMass / predictedWeightKg) * 100;

  // Optimistic (high P-ratio = mostly fat loss)
  const optimisticFatLoss = weightChangeKg * pRatioHigh;
  const optimisticLeanLoss = weightChangeKg * (1 - pRatioHigh);
  const optimisticFatMass = currentFatMassKg + optimisticFatLoss;
  const optimisticLeanMass = currentLeanMassKg + optimisticLeanLoss;
  const optimisticBF = (optimisticFatMass / predictedWeightKg) * 100;

  // Calculate FFMI for each scenario
  const pessimisticFFMI = calculateFFMI(pessimisticLeanMass, heightCm);
  const expectedFFMI = calculateFFMI(expectedLeanMass, heightCm);
  const optimisticFFMI = calculateFFMI(optimisticLeanMass, heightCm);

  const rangeSpread = pRatioResult.confidenceRange[1] - pRatioResult.confidenceRange[0];
  const confidenceLevel = rangeSpread < 0.12
    ? 'high'      // Very narrow range, have DEXA calibration
    : rangeSpread < 0.18
    ? 'reasonable'
    : 'low';

  return {
    ffmi: {
      pessimistic: pessimisticFFMI.normalizedFfmi,
      expected: expectedFFMI.normalizedFfmi,
      optimistic: optimisticFFMI.normalizedFfmi,
    },
    bodyFatPercent: {
      pessimistic: pessimisticBF,
      expected: expectedBF,
      optimistic: optimisticBF,
    },
    pRatioUsed: pRatioMid,
    confidenceLevel,
    factors: pRatioResult.factors,
  };
}

/**
 * Predict body composition change for weight gain
 */
export function predictWeightGainComposition(
  currentWeightKg: number,
  predictedWeightKg: number,
  currentBodyFatPercent: number,
  heightCm: number,
  inputs: PRatioInputs
): BodyCompProjection {
  const weightGainKg = predictedWeightKg - currentWeightKg;
  
  // Weight gain partitioning is different from loss
  // Natural lifters: 30-50% muscle in surplus (if training + protein)
  // Beginners: Can be higher (50-70%)
  // Advanced: Lower (20-40%)
  // Enhanced: 50-80%
  
  let muscleGainRatio = 0.4; // Base (40% muscle, 60% fat)
  
  if (inputs.trainingAge === 'beginner') {
    muscleGainRatio = 0.55;
  } else if (inputs.trainingAge === 'advanced') {
    muscleGainRatio = 0.30;
  }
  
  if (inputs.isEnhanced) {
    muscleGainRatio = Math.min(0.75, muscleGainRatio * 1.5);
  }
  
  // Protein matters for partitioning
  if (inputs.avgDailyProteinPerKgBW >= 2.0) {
    muscleGainRatio *= 1.1;
  } else if (inputs.avgDailyProteinPerKgBW < 1.4) {
    muscleGainRatio *= 0.85;
  }
  
  // Training matters
  if (inputs.avgWeeklyTrainingSets < 5) {
    muscleGainRatio *= 0.5; // Barely training = mostly fat gain
  } else if (inputs.avgWeeklyTrainingSets >= 20) {
    muscleGainRatio *= 1.1;
  }
  
  // Surplus size matters (larger surplus = more fat)
  const balanceMagnitude = Math.abs(inputs.energyBalancePercent);
  if (balanceMagnitude > 15) {
    muscleGainRatio *= 0.85;
  } else if (balanceMagnitude < 5) {
    muscleGainRatio *= 1.1;
  }
  
  // Clamp to reasonable range
  muscleGainRatio = Math.max(0.2, Math.min(0.8, muscleGainRatio));
  
  // Calculate ranges (wider uncertainty for gains)
  const muscleGainLow = muscleGainRatio * 0.7;
  const muscleGainHigh = Math.min(0.85, muscleGainRatio * 1.3);
  
  const currentFatMassKg = currentWeightKg * (currentBodyFatPercent / 100);
  const currentLeanMassKg = currentWeightKg - currentFatMassKg;
  
  // Expected
  const expectedMuscleGain = weightGainKg * muscleGainRatio;
  const expectedFatGain = weightGainKg * (1 - muscleGainRatio);
  const expectedLeanMass = currentLeanMassKg + expectedMuscleGain;
  const expectedFatMass = currentFatMassKg + expectedFatGain;
  const expectedBF = (expectedFatMass / predictedWeightKg) * 100;
  
  // Optimistic (more muscle)
  const optimisticMuscleGain = weightGainKg * muscleGainHigh;
  const optimisticFatGain = weightGainKg * (1 - muscleGainHigh);
  const optimisticLeanMass = currentLeanMassKg + optimisticMuscleGain;
  const optimisticFatMass = currentFatMassKg + optimisticFatGain;
  const optimisticBF = (optimisticFatMass / predictedWeightKg) * 100;
  
  // Pessimistic (more fat)
  const pessimisticMuscleGain = weightGainKg * muscleGainLow;
  const pessimisticFatGain = weightGainKg * (1 - muscleGainLow);
  const pessimisticLeanMass = currentLeanMassKg + pessimisticMuscleGain;
  const pessimisticFatMass = currentFatMassKg + pessimisticFatGain;
  const pessimisticBF = (pessimisticFatMass / predictedWeightKg) * 100;
  
  // Calculate FFMI for each scenario
  const expectedFFMI = calculateFFMI(expectedLeanMass, heightCm);
  const optimisticFFMI = calculateFFMI(optimisticLeanMass, heightCm);
  const pessimisticFFMI = calculateFFMI(pessimisticLeanMass, heightCm);
  
  return {
    ffmi: {
      pessimistic: pessimisticFFMI.normalizedFfmi,
      expected: expectedFFMI.normalizedFfmi,
      optimistic: optimisticFFMI.normalizedFfmi,
    },
    bodyFatPercent: {
      pessimistic: pessimisticBF,
      expected: expectedBF,
      optimistic: optimisticBF,
    },
    pRatioUsed: muscleGainRatio,
    confidenceLevel: 'low', // Weight gain composition is harder to predict
    factors: ['Weight gain partitioning has high individual variance'],
  };
}

