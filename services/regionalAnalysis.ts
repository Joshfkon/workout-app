// ============================================================
// REGIONAL BODY COMPOSITION ANALYSIS
// Analyzes DEXA regional data to identify:
// - Weak/lagging body parts
// - Left/right asymmetries
// - Areas needing more training focus
// ============================================================

import type { 
  DexaRegionalData, 
  RegionalAnalysis, 
  BodyPartAnalysis 
} from '@/types/schema';

// Population norms for regional lean mass distribution
// Based on research averages for trained individuals
const POPULATION_NORMS = {
  arms: { min: 13, max: 17, ideal: 15 },      // % of total lean mass
  legs: { min: 38, max: 45, ideal: 41 },
  trunk: { min: 42, max: 48, ideal: 44 },
};

// Asymmetry thresholds
const ASYMMETRY_THRESHOLDS = {
  minor: 3,      // 3% difference - barely noticeable
  moderate: 5,   // 5% difference - worth addressing
  significant: 8 // 8%+ difference - priority to fix
};

/**
 * Analyze regional body composition from DEXA data
 */
export function analyzeRegionalComposition(
  regional: DexaRegionalData,
  totalLeanMassKg: number
): RegionalAnalysis {
  // Calculate regional lean masses in kg
  const leftArmLean = regional.left_arm.lean_g / 1000;
  const rightArmLean = regional.right_arm.lean_g / 1000;
  const leftLegLean = regional.left_leg.lean_g / 1000;
  const rightLegLean = regional.right_leg.lean_g / 1000;
  const trunkLean = regional.trunk.lean_g / 1000;

  const totalArmsLean = leftArmLean + rightArmLean;
  const totalLegsLean = leftLegLean + rightLegLean;

  // Calculate fat masses
  const totalArmsFat = (regional.left_arm.fat_g + regional.right_arm.fat_g) / 1000;
  const totalLegsFat = (regional.left_leg.fat_g + regional.right_leg.fat_g) / 1000;
  const trunkFat = regional.trunk.fat_g / 1000;

  // Calculate percentages of total lean mass
  const armsPercent = (totalArmsLean / totalLeanMassKg) * 100;
  const legsPercent = (totalLegsLean / totalLeanMassKg) * 100;
  const trunkPercent = (trunkLean / totalLeanMassKg) * 100;

  // Calculate asymmetries (positive = right side dominant)
  const armAsymmetry = calculateAsymmetry(rightArmLean, leftArmLean);
  const legAsymmetry = calculateAsymmetry(rightLegLean, leftLegLean);

  // Calculate ratios
  const upperLowerRatio = totalArmsLean / totalLegsLean;
  const androidGynoidRatio = regional.android.fat_g / regional.gynoid.fat_g;

  // Build body part analyses
  const parts: BodyPartAnalysis[] = [
    buildPartAnalysis('Arms', totalArmsLean, totalArmsFat, armsPercent, 100 - Math.abs(armAsymmetry), POPULATION_NORMS.arms),
    buildPartAnalysis('Legs', totalLegsLean, totalLegsFat, legsPercent, 100 - Math.abs(legAsymmetry), POPULATION_NORMS.legs),
    buildPartAnalysis('Trunk', trunkLean, trunkFat, trunkPercent, undefined, POPULATION_NORMS.trunk),
  ];

  // Identify lagging and dominant areas
  const laggingAreas: string[] = [];
  const dominantAreas: string[] = [];

  for (const part of parts) {
    if (part.status === 'lagging') laggingAreas.push(part.name);
    if (part.status === 'dominant') dominantAreas.push(part.name);
  }

  // Add specific limb asymmetry notes
  if (Math.abs(armAsymmetry) >= ASYMMETRY_THRESHOLDS.moderate) {
    const weakSide = armAsymmetry > 0 ? 'Left' : 'Right';
    laggingAreas.push(`${weakSide} arm (${Math.abs(armAsymmetry).toFixed(1)}% smaller)`);
  }

  if (Math.abs(legAsymmetry) >= ASYMMETRY_THRESHOLDS.moderate) {
    const weakSide = legAsymmetry > 0 ? 'Left' : 'Right';
    laggingAreas.push(`${weakSide} leg (${Math.abs(legAsymmetry).toFixed(1)}% smaller)`);
  }

  return {
    parts,
    asymmetries: { arms: armAsymmetry, legs: legAsymmetry },
    upperLowerRatio,
    androidGynoidRatio,
    laggingAreas,
    dominantAreas,
  };
}

/**
 * Calculate percentage difference between two values
 * Positive = right/second value is larger
 */
function calculateAsymmetry(right: number, left: number): number {
  const average = (right + left) / 2;
  return ((right - left) / average) * 100;
}

/**
 * Build analysis for a body part
 */
function buildPartAnalysis(
  name: string,
  leanMassKg: number,
  fatMassKg: number,
  percentOfTotal: number,
  symmetryScore: number | undefined,
  norms: { min: number; max: number; ideal: number }
): BodyPartAnalysis {
  let status: 'lagging' | 'balanced' | 'dominant';
  let recommendation: string | undefined;

  if (percentOfTotal < norms.min) {
    status = 'lagging';
    recommendation = getRecommendation(name, 'lagging');
  } else if (percentOfTotal > norms.max) {
    status = 'dominant';
    recommendation = getRecommendation(name, 'dominant');
  } else {
    status = 'balanced';
  }

  return {
    name,
    leanMassKg: Math.round(leanMassKg * 100) / 100,
    fatMassKg: Math.round(fatMassKg * 100) / 100,
    percentOfTotal: Math.round(percentOfTotal * 10) / 10,
    symmetryScore: symmetryScore ? Math.round(symmetryScore * 10) / 10 : undefined,
    status,
    recommendation,
  };
}

/**
 * Get training recommendation based on status
 */
function getRecommendation(part: string, status: 'lagging' | 'dominant'): string {
  const recommendations: Record<string, Record<string, string>> = {
    Arms: {
      lagging: 'Consider adding 2-4 extra arm sets per week or an arm specialization day',
      dominant: 'Arms are well-developed. You can reduce arm isolation volume if desired',
    },
    Legs: {
      lagging: 'Increase leg training frequency to 2-3x/week with focus on compound movements',
      dominant: 'Strong lower body development. Maintain current leg volume',
    },
    Trunk: {
      lagging: 'Add more horizontal pulling (rows) and direct core work',
      dominant: 'Trunk is well-developed relative to limbs',
    },
  };

  return recommendations[part]?.[status] || '';
}

/**
 * Get asymmetry severity level
 */
export function getAsymmetrySeverity(asymmetryPercent: number): 'none' | 'minor' | 'moderate' | 'significant' {
  const abs = Math.abs(asymmetryPercent);
  if (abs < ASYMMETRY_THRESHOLDS.minor) return 'none';
  if (abs < ASYMMETRY_THRESHOLDS.moderate) return 'minor';
  if (abs < ASYMMETRY_THRESHOLDS.significant) return 'moderate';
  return 'significant';
}

/**
 * Generate unilateral training recommendations based on asymmetry
 */
export function getAsymmetryRecommendations(
  asymmetries: { arms: number; legs: number }
): string[] {
  const recommendations: string[] = [];

  const armSeverity = getAsymmetrySeverity(asymmetries.arms);
  const legSeverity = getAsymmetrySeverity(asymmetries.legs);

  if (armSeverity === 'moderate' || armSeverity === 'significant') {
    const weakSide = asymmetries.arms > 0 ? 'left' : 'right';
    recommendations.push(
      `Start arm exercises with your ${weakSide} arm to ensure equal effort`
    );
    if (armSeverity === 'significant') {
      recommendations.push(
        `Consider adding 1-2 extra sets for ${weakSide} arm on isolation exercises`
      );
    }
  }

  if (legSeverity === 'moderate' || legSeverity === 'significant') {
    const weakSide = asymmetries.legs > 0 ? 'left' : 'right';
    recommendations.push(
      `Prioritize unilateral leg exercises (lunges, split squats) starting with ${weakSide} leg`
    );
    if (legSeverity === 'significant') {
      recommendations.push(
        `Add ${weakSide} leg-only work: single-leg press or Bulgarian split squats`
      );
    }
  }

  return recommendations;
}

/**
 * Calculate health indicators from regional fat distribution
 */
export function analyzeRegionalFatDistribution(regional: DexaRegionalData): {
  androidGynoidRatio: number;
  healthRisk: 'low' | 'moderate' | 'elevated' | 'high';
  interpretation: string;
} {
  const agRatio = regional.android.fat_g / regional.gynoid.fat_g;
  
  let healthRisk: 'low' | 'moderate' | 'elevated' | 'high';
  let interpretation: string;

  // Android/Gynoid ratio interpretation
  // Lower is generally better for metabolic health
  // Males typically have higher ratios than females
  if (agRatio < 0.8) {
    healthRisk = 'low';
    interpretation = 'Favorable fat distribution pattern. Lower visceral fat risk.';
  } else if (agRatio < 1.0) {
    healthRisk = 'moderate';
    interpretation = 'Average fat distribution. Monitor android (belly) fat during bulk phases.';
  } else if (agRatio < 1.2) {
    healthRisk = 'elevated';
    interpretation = 'Higher android fat ratio. Consider prioritizing fat loss or slower bulk.';
  } else {
    healthRisk = 'high';
    interpretation = 'High visceral fat pattern. Recommend focusing on recomposition or cut.';
  }

  return {
    androidGynoidRatio: Math.round(agRatio * 100) / 100,
    healthRisk,
    interpretation,
  };
}

/**
 * Compare current regional data to previous scan
 */
export function compareRegionalProgress(
  current: DexaRegionalData,
  previous: DexaRegionalData
): {
  region: string;
  leanChange: number;
  fatChange: number;
  trend: 'improving' | 'stable' | 'declining';
}[] {
  const regions = [
    { name: 'Left Arm', curr: current.left_arm, prev: previous.left_arm },
    { name: 'Right Arm', curr: current.right_arm, prev: previous.right_arm },
    { name: 'Left Leg', curr: current.left_leg, prev: previous.left_leg },
    { name: 'Right Leg', curr: current.right_leg, prev: previous.right_leg },
    { name: 'Trunk', curr: current.trunk, prev: previous.trunk },
  ];

  return regions.map(({ name, curr, prev }) => {
    const leanChange = (curr.lean_g - prev.lean_g) / 1000;
    const fatChange = (curr.fat_g - prev.fat_g) / 1000;

    let trend: 'improving' | 'stable' | 'declining';
    if (leanChange > 0.1 && fatChange <= 0.1) {
      trend = 'improving';
    } else if (leanChange < -0.1 || fatChange > 0.2) {
      trend = 'declining';
    } else {
      trend = 'stable';
    }

    return {
      region: name,
      leanChange: Math.round(leanChange * 100) / 100,
      fatChange: Math.round(fatChange * 100) / 100,
      trend,
    };
  });
}

/**
 * Get average lean mass for a region (for weight estimation)
 * These are rough population averages for trained individuals
 */
export function getAverageRegionalLeanMass(
  totalLeanMassKg: number
): { arms: number; legs: number; trunk: number } {
  return {
    arms: totalLeanMassKg * 0.15,   // ~15% of lean mass
    legs: totalLeanMassKg * 0.41,   // ~41% of lean mass
    trunk: totalLeanMassKg * 0.44,  // ~44% of lean mass
  };
}

