/**
 * Body Composition Engine
 * Handles FFMI calculations, body composition analysis, and coaching recommendations
 */

import type {
  DexaScan,
  FFMIResult,
  FFMIClassification,
  BodyCompTrend,
  BodyCompRecommendation,
  BodyCompTargets,
  Goal,
  Experience,
} from '@/types/schema';

// ============ FFMI CALCULATIONS ============

/**
 * Calculate FFMI (Fat-Free Mass Index) from lean mass and height
 * FFMI = lean mass (kg) / height (m)²
 * Normalized FFMI = FFMI + 6.1 × (1.8 - height in m)
 */
export function calculateFFMI(leanMassKg: number, heightCm: number): FFMIResult {
  const heightM = heightCm / 100;
  const ffmi = leanMassKg / (heightM * heightM);
  const normalizedFfmi = ffmi + 6.1 * (1.8 - heightM);
  
  const classification = classifyFFMI(normalizedFfmi);
  const naturalLimit = 25; // Generally accepted natural limit
  const percentOfLimit = Math.min((normalizedFfmi / naturalLimit) * 100, 100);
  
  return {
    ffmi: Math.round(ffmi * 10) / 10,
    normalizedFfmi: Math.round(normalizedFfmi * 10) / 10,
    classification,
    naturalLimit,
    percentOfLimit: Math.round(percentOfLimit),
  };
}

/**
 * Classify FFMI into categories
 */
function classifyFFMI(normalizedFfmi: number): FFMIClassification {
  if (normalizedFfmi < 18) return 'below_average';
  if (normalizedFfmi < 20) return 'average';
  if (normalizedFfmi < 22) return 'above_average';
  if (normalizedFfmi < 23) return 'excellent';
  if (normalizedFfmi < 25) return 'superior';
  return 'suspicious';
}

/**
 * Get natural FFMI limit based on experience level
 * These are rough estimates for natural lifters
 */
export function getNaturalFFMILimit(experience: Experience): number {
  switch (experience) {
    case 'novice':
      return 22; // Beginners have more room to grow
    case 'intermediate':
      return 24; // Getting closer to genetic potential
    case 'advanced':
      return 25; // Near genetic ceiling
    default:
      return 25;
  }
}

/**
 * Get FFMI classification label for display
 */
export function getFFMILabel(classification: FFMIClassification): string {
  switch (classification) {
    case 'below_average':
      return 'Below Average';
    case 'average':
      return 'Average';
    case 'above_average':
      return 'Above Average';
    case 'excellent':
      return 'Excellent';
    case 'superior':
      return 'Superior';
    case 'suspicious':
      return 'Elite (Near Genetic Limit)';
  }
}

// ============ TREND ANALYSIS ============

/**
 * Analyze body composition trends from multiple DEXA scans
 * Requires at least 2 scans to calculate trends
 */
export function analyzeBodyCompTrend(
  scans: DexaScan[],
  heightCm: number
): BodyCompTrend | null {
  if (scans.length < 2) return null;
  
  // Sort by date descending (most recent first)
  const sortedScans = [...scans].sort(
    (a, b) => new Date(b.scanDate).getTime() - new Date(a.scanDate).getTime()
  );
  
  const newest = sortedScans[0];
  const oldest = sortedScans[sortedScans.length - 1];
  
  // Calculate time difference in months
  const daysDiff = (new Date(newest.scanDate).getTime() - new Date(oldest.scanDate).getTime()) 
    / (1000 * 60 * 60 * 24);
  const monthsDiff = daysDiff / 30.44; // Average days per month
  
  if (monthsDiff < 0.5) {
    // Less than 2 weeks of data, not enough for trends
    return null;
  }
  
  // Calculate changes
  const leanMassChange = newest.leanMassKg - oldest.leanMassKg;
  const fatMassChange = newest.fatMassKg - oldest.fatMassKg;
  const bodyFatChange = newest.bodyFatPercent - oldest.bodyFatPercent;
  
  const newestFFMI = calculateFFMI(newest.leanMassKg, heightCm);
  const oldestFFMI = calculateFFMI(oldest.leanMassKg, heightCm);
  const ffmiChange = newestFFMI.normalizedFfmi - oldestFFMI.normalizedFfmi;
  
  // Monthly rates
  const leanMassChangeRate = leanMassChange / monthsDiff;
  const fatMassChangeRate = fatMassChange / monthsDiff;
  const bodyFatChangeRate = bodyFatChange / monthsDiff;
  const ffmiChangeRate = ffmiChange / monthsDiff;
  
  // Determine trend
  let trend: BodyCompTrend['trend'];
  const muscleThreshold = 0.1; // kg/month
  const fatThreshold = 0.2; // kg/month

  // Check recomping first since it's the most specific (both conditions must be true)
  if (leanMassChangeRate > muscleThreshold && fatMassChangeRate < -fatThreshold) {
    trend = 'recomping';
  } else if (leanMassChangeRate > muscleThreshold && fatMassChangeRate > fatThreshold) {
    trend = 'gaining_muscle'; // Bulk (gaining both but emphasize muscle)
  } else if (leanMassChangeRate < -muscleThreshold) {
    trend = 'losing_muscle';
  } else if (fatMassChangeRate > fatThreshold) {
    trend = 'gaining_fat';
  } else if (fatMassChangeRate < -fatThreshold) {
    trend = 'losing_fat';
  } else {
    trend = 'stable';
  }
  
  return {
    leanMassChangeRate: Math.round(leanMassChangeRate * 100) / 100,
    fatMassChangeRate: Math.round(fatMassChangeRate * 100) / 100,
    bodyFatChangeRate: Math.round(bodyFatChangeRate * 100) / 100,
    ffmiChangeRate: Math.round(ffmiChangeRate * 100) / 100,
    trend,
    dataPoints: scans.length,
  };
}

// ============ COACHING RECOMMENDATIONS ============

/**
 * Generate coaching recommendations based on body composition data
 */
export function generateCoachingRecommendations(
  scans: DexaScan[],
  heightCm: number,
  goal: Goal,
  experience: Experience
): BodyCompRecommendation[] {
  const recommendations: BodyCompRecommendation[] = [];
  
  if (scans.length === 0) {
    recommendations.push({
      type: 'info',
      title: 'Get Started',
      message: 'Add your first DEXA scan to start tracking your body composition and receive personalized recommendations.',
      priority: 1,
    });
    return recommendations;
  }
  
  const latestScan = scans[0];
  const ffmiResult = calculateFFMI(latestScan.leanMassKg, heightCm);
  const trend = analyzeBodyCompTrend(scans, heightCm);
  const naturalLimit = getNaturalFFMILimit(experience);
  
  // FFMI-based recommendations
  if (ffmiResult.normalizedFfmi >= naturalLimit - 1) {
    recommendations.push({
      type: 'achievement',
      title: 'Near Genetic Potential',
      message: `Your FFMI of ${ffmiResult.normalizedFfmi} is approaching the natural limit. Focus on maintaining your physique and making incremental improvements.`,
      priority: 3,
    });
  }
  
  // Body fat recommendations
  if (goal === 'bulk' && latestScan.bodyFatPercent > 20) {
    recommendations.push({
      type: 'warning',
      title: 'Consider a Mini-Cut',
      message: `At ${latestScan.bodyFatPercent}% body fat, you may want to do a short cut (4-6 weeks) before continuing your bulk. This improves insulin sensitivity and nutrient partitioning.`,
      priority: 5,
    });
  }
  
  if (goal === 'cut' && latestScan.bodyFatPercent < 10) {
    recommendations.push({
      type: 'warning',
      title: 'Risk of Muscle Loss',
      message: `At ${latestScan.bodyFatPercent}% body fat, the risk of muscle loss increases significantly. Consider transitioning to maintenance or a slower deficit.`,
      priority: 5,
    });
  }
  
  // Trend-based recommendations (need at least 2 scans)
  if (trend) {
    if (goal === 'bulk' && trend.fatMassChangeRate > 0.5) {
      recommendations.push({
        type: 'warning',
        title: 'Fat Gain Too Fast',
        message: `You're gaining ${trend.fatMassChangeRate.toFixed(1)} kg of fat per month. Consider reducing your caloric surplus by 200-300 calories to optimize muscle-to-fat ratio.`,
        priority: 4,
      });
    }
    
    if (goal === 'bulk' && trend.leanMassChangeRate < 0.2 && experience !== 'advanced') {
      recommendations.push({
        type: 'suggestion',
        title: 'Muscle Gain Below Expected',
        message: `You're gaining ${trend.leanMassChangeRate.toFixed(2)} kg of muscle per month. Consider increasing protein intake, training volume, or caloric surplus.`,
        priority: 3,
      });
    }
    
    if (goal === 'cut' && trend.leanMassChangeRate < -0.2) {
      recommendations.push({
        type: 'warning',
        title: 'Muscle Loss Detected',
        message: `You're losing ${Math.abs(trend.leanMassChangeRate).toFixed(2)} kg of muscle per month. Consider reducing your deficit, increasing protein to 2.3-3.1g/kg, or increasing training volume.`,
        priority: 5,
      });
    }
    
    if (trend.trend === 'recomping') {
      recommendations.push({
        type: 'achievement',
        title: 'Successful Recomp',
        message: `Great progress! You're simultaneously gaining muscle and losing fat. Keep up the consistent training and nutrition.`,
        priority: 2,
      });
    }
  }
  
  // Sort by priority (higher = show first)
  recommendations.sort((a, b) => b.priority - a.priority);
  
  return recommendations;
}

// ============ TARGET CALCULATIONS ============

/**
 * Calculate body composition targets based on current status and goal
 */
export function calculateBodyCompTargets(
  currentScan: DexaScan,
  heightCm: number,
  goal: Goal,
  experience: Experience
): BodyCompTargets {
  const currentFFMI = calculateFFMI(currentScan.leanMassKg, heightCm);
  const naturalLimit = getNaturalFFMILimit(experience);
  
  let targetBodyFat: number;
  let targetFfmi: number;
  let direction: BodyCompTargets['direction'];
  
  switch (goal) {
    case 'bulk':
      // Target: Gain muscle while keeping body fat reasonable
      targetBodyFat = Math.min(currentScan.bodyFatPercent + 3, 18); // Don't go above 18%
      targetFfmi = Math.min(currentFFMI.normalizedFfmi + 1, naturalLimit);
      direction = 'bulk';
      break;
      
    case 'cut':
      // Target: Lose fat while preserving muscle
      targetBodyFat = Math.max(currentScan.bodyFatPercent - 5, 10); // Don't go below 10%
      targetFfmi = currentFFMI.normalizedFfmi; // Maintain FFMI
      direction = 'cut';
      break;
      
    case 'maintenance':
    default:
      // Target: Maintain current composition
      targetBodyFat = currentScan.bodyFatPercent;
      targetFfmi = currentFFMI.normalizedFfmi;
      direction = 'maintain';
      break;
  }
  
  // Calculate estimated weeks based on typical rates
  let estimatedWeeks: number;
  let calorieAdjustment: number;
  
  if (direction === 'bulk') {
    // Expect ~0.25 FFMI per month for intermediates
    const ffmiToGain = targetFfmi - currentFFMI.normalizedFfmi;
    estimatedWeeks = Math.ceil((ffmiToGain / 0.25) * 4);
    calorieAdjustment = 300; // 300 cal surplus
  } else if (direction === 'cut') {
    // Expect ~0.5% body fat loss per week at moderate deficit
    const bfToLose = currentScan.bodyFatPercent - targetBodyFat;
    estimatedWeeks = Math.ceil(bfToLose / 0.5);
    calorieAdjustment = -500; // 500 cal deficit
  } else {
    estimatedWeeks = 0;
    calorieAdjustment = 0;
  }
  
  return {
    targetBodyFat: Math.round(targetBodyFat * 10) / 10,
    targetFfmi: Math.round(targetFfmi * 10) / 10,
    estimatedWeeks: Math.max(estimatedWeeks, 0),
    calorieAdjustment,
    direction,
  };
}

// ============ UTILITY FUNCTIONS ============

/**
 * Calculate lean mass from total weight and body fat percentage
 */
export function calculateLeanMass(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (1 - bodyFatPercent / 100);
}

/**
 * Calculate fat mass from total weight and body fat percentage
 */
export function calculateFatMass(weightKg: number, bodyFatPercent: number): number {
  return weightKg * (bodyFatPercent / 100);
}

/**
 * Format FFMI for display
 */
export function formatFFMI(ffmi: number): string {
  return ffmi.toFixed(1);
}

/**
 * Get color for FFMI classification
 */
export function getFFMIColor(classification: FFMIClassification): string {
  switch (classification) {
    case 'below_average':
      return 'text-surface-400';
    case 'average':
      return 'text-primary-400';
    case 'above_average':
      return 'text-primary-300';
    case 'excellent':
      return 'text-success-400';
    case 'superior':
      return 'text-accent-400';
    case 'suspicious':
      return 'text-warning-400';
  }
}

/**
 * Get trend icon/indicator
 */
export function getTrendIndicator(rate: number): { icon: string; color: string } {
  if (rate > 0.1) {
    return { icon: '↑', color: 'text-success-400' };
  } else if (rate < -0.1) {
    return { icon: '↓', color: 'text-danger-400' };
  }
  return { icon: '→', color: 'text-surface-400' };
}

