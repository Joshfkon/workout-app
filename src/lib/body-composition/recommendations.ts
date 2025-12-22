/**
 * Body Composition Recommendations
 *
 * Generate actionable recommendations based on P-ratio factors
 * to help users optimize their body composition results.
 */

import type {
  BodyCompRecommendation,
  PartitionRatioFactors,
  PRatioInputs,
} from './types';

/**
 * Generate body composition improvement recommendations
 */
export function generateBodyCompRecommendations(
  factors: PartitionRatioFactors,
  inputs: PRatioInputs
): BodyCompRecommendation[] {
  const recommendations: BodyCompRecommendation[] = [];

  // ========================================
  // PROTEIN RECOMMENDATIONS
  // ========================================
  if (factors.proteinFactor < 1.0) {
    const currentG = Math.round(inputs.avgDailyProteinGrams);
    const currentPerKg = inputs.avgDailyProteinPerKgBW;

    // Calculate target protein
    const targetPerKg = 2.0;
    const currentLeanKg = inputs.currentLeanMassKg;
    const estimatedBodyweight = currentLeanKg / (1 - inputs.currentBodyFatPercent / 100);
    const targetG = Math.round(estimatedBodyweight * targetPerKg);

    recommendations.push({
      category: 'protein',
      priority: factors.proteinFactor < 0.95 ? 'high' : 'medium',
      title: 'Increase Protein Intake',
      description:
        factors.proteinFactor < 0.92
          ? `You're averaging ${currentPerKg.toFixed(1)}g/kg. Research shows 1.8-2.2g/kg significantly improves muscle retention during a cut. This is your most impactful lever.`
          : `You're at ${currentPerKg.toFixed(1)}g/kg. Bumping to 2.0g/kg may provide additional muscle preservation.`,
      impact: 'Could shift 2-5% more weight loss toward fat',
      currentValue: `${currentG}g (${currentPerKg.toFixed(1)}g/kg)`,
      targetValue: `${targetG}g (${targetPerKg}g/kg)`,
    });
  }

  // ========================================
  // TRAINING RECOMMENDATIONS
  // ========================================
  if (factors.trainingFactor < 1.0) {
    const currentSets = inputs.avgWeeklyTrainingSets;

    recommendations.push({
      category: 'training',
      priority: factors.trainingFactor < 0.95 ? 'high' : 'medium',
      title: 'Maintain Training Volume',
      description:
        factors.trainingFactor < 0.92
          ? `You're averaging ${currentSets} sets/week. Training provides the signal to preserve muscle. Without it, your body is more likely to break down muscle tissue.`
          : `You're at ${currentSets} sets/week. Maintaining or slightly increasing volume while cutting helps preserve muscle mass.`,
      impact: 'Could improve muscle retention by 5-10%',
      currentValue: `${currentSets} sets/week`,
      targetValue: '15+ sets/muscle/week',
    });
  }

  // ========================================
  // DEFICIT RECOMMENDATIONS
  // ========================================
  if (factors.deficitFactor < 0.95) {
    const deficitPercent = inputs.deficitPercent;

    recommendations.push({
      category: 'deficit',
      priority: 'medium',
      title: 'Consider Reducing Deficit',
      description:
        factors.deficitFactor < 0.88
          ? `Your ${deficitPercent.toFixed(0)}% deficit is quite aggressive. While faster weight loss is tempting, larger deficits significantly increase muscle loss risk. Consider a more moderate approach.`
          : `Your ${deficitPercent.toFixed(0)}% deficit is aggressive. A more moderate deficit (15-20%) preserves more muscle even though weight loss is slower.`,
      impact: 'Slower loss but better composition',
      currentValue: `${deficitPercent.toFixed(0)}% deficit`,
      targetValue: '15-20% deficit',
    });
  }

  // ========================================
  // BODY FAT SPECIFIC RECOMMENDATIONS
  // ========================================
  if (factors.bodyFatFactor < 0.9) {
    const bf = inputs.currentBodyFatPercent;

    recommendations.push({
      category: 'general',
      priority: bf < 12 ? 'high' : 'medium',
      title: 'Expect Slower Progress',
      description:
        bf < 10
          ? `At ${bf.toFixed(1)}% body fat, you're approaching competition-level leanness. Your body will fight very hard to preserve remaining fat. Consider diet breaks, refeeds, and accepting slower progress.`
          : `At ${bf.toFixed(1)}% body fat, your body is fighting harder to preserve fat. This is normal. Consider smaller deficits, periodic diet breaks, or strategic refeeds to help sustainability.`,
      impact: 'Sustainability and muscle preservation',
    });
  }

  // ========================================
  // TRAINING AGE SPECIFIC
  // ========================================
  if (inputs.trainingAge === 'beginner' && inputs.currentBodyFatPercent > 18) {
    recommendations.push({
      category: 'general',
      priority: 'low',
      title: 'Leverage Beginner Advantage',
      description:
        'As a beginner with higher body fat, you have a unique opportunity. You may be able to gain muscle while losing fat (recomposition). Focus on progressive overload and adequate protein.',
      impact: 'Potential for simultaneous muscle gain and fat loss',
    });
  }

  // ========================================
  // CONSISTENCY RECOMMENDATIONS
  // ========================================
  if (factors.finalPRatio < 0.75) {
    recommendations.push({
      category: 'general',
      priority: 'medium',
      title: 'Focus on Consistency',
      description:
        'Multiple factors are affecting your body composition. Rather than trying to optimize everything at once, pick the highest-impact change (usually protein) and nail it consistently before adding more changes.',
      impact: 'Sustainable improvement over time',
    });
  }

  // Sort by priority
  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Get the single most impactful recommendation
 */
export function getTopRecommendation(
  factors: PartitionRatioFactors,
  inputs: PRatioInputs
): BodyCompRecommendation | null {
  const recommendations = generateBodyCompRecommendations(factors, inputs);
  return recommendations[0] || null;
}

/**
 * Get recommendation category icon
 */
export function getRecommendationIcon(category: BodyCompRecommendation['category']): string {
  switch (category) {
    case 'protein':
      return '🥩';
    case 'training':
      return '🏋️';
    case 'deficit':
      return '📉';
    case 'general':
      return '💡';
  }
}

/**
 * Get priority color class
 */
export function getRecommendationPriorityColor(
  priority: BodyCompRecommendation['priority']
): string {
  switch (priority) {
    case 'high':
      return 'text-danger-400';
    case 'medium':
      return 'text-warning-400';
    case 'low':
      return 'text-primary-400';
  }
}

/**
 * Get priority background class
 */
export function getRecommendationPriorityBg(
  priority: BodyCompRecommendation['priority']
): string {
  switch (priority) {
    case 'high':
      return 'bg-danger-500/10 border-danger-500/20';
    case 'medium':
      return 'bg-warning-500/10 border-warning-500/20';
    case 'low':
      return 'bg-primary-500/10 border-primary-500/20';
  }
}

/**
 * Generate a brief summary of recommendations for dashboard card
 */
export function generateRecommendationSummary(
  factors: PartitionRatioFactors,
  inputs: PRatioInputs
): string {
  const recommendations = generateBodyCompRecommendations(factors, inputs);

  if (recommendations.length === 0) {
    return 'Your current approach is well-optimized for body composition.';
  }

  const highPriority = recommendations.filter((r) => r.priority === 'high');
  const mediumPriority = recommendations.filter((r) => r.priority === 'medium');

  if (highPriority.length > 0) {
    const titles = highPriority.map((r) => r.title.toLowerCase()).slice(0, 2);
    return `Focus on: ${titles.join(' and ')}`;
  }

  if (mediumPriority.length > 0) {
    const title = mediumPriority[0].title.toLowerCase();
    return `Consider: ${title}`;
  }

  return 'Minor optimizations available';
}

/**
 * Check if any recommendations are high priority
 */
export function hasHighPriorityRecommendations(
  factors: PartitionRatioFactors,
  inputs: PRatioInputs
): boolean {
  const recommendations = generateBodyCompRecommendations(factors, inputs);
  return recommendations.some((r) => r.priority === 'high');
}

/**
 * Get improvement potential estimate
 */
export function estimateImprovementPotential(
  factors: PartitionRatioFactors,
  inputs: PRatioInputs
): {
  currentPRatio: number;
  potentialPRatio: number;
  improvementPercent: number;
} {
  // Calculate what P-ratio could be with optimal inputs
  const optimalFactors = {
    proteinFactor: 1.08,
    trainingFactor: 1.06,
    deficitFactor: 1.04,
  };

  // Current P-ratio
  const currentPRatio = factors.finalPRatio;

  // Potential P-ratio if suboptimal factors were optimized
  let potentialPRatio = currentPRatio;

  if (factors.proteinFactor < optimalFactors.proteinFactor) {
    potentialPRatio *= optimalFactors.proteinFactor / factors.proteinFactor;
  }

  if (factors.trainingFactor < optimalFactors.trainingFactor) {
    potentialPRatio *= optimalFactors.trainingFactor / factors.trainingFactor;
  }

  if (factors.deficitFactor < optimalFactors.deficitFactor) {
    potentialPRatio *= optimalFactors.deficitFactor / factors.deficitFactor;
  }

  // Cap at 1.0
  potentialPRatio = Math.min(1.0, potentialPRatio);

  const improvementPercent = ((potentialPRatio - currentPRatio) / currentPRatio) * 100;

  return {
    currentPRatio,
    potentialPRatio,
    improvementPercent: Math.round(improvementPercent),
  };
}
