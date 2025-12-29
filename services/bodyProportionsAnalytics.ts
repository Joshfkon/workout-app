// ============================================================
// ENHANCED BODY PROPORTIONS ANALYTICS ENGINE
// Provides comprehensive physique analysis including:
// - Classic/Adonis proportionality ratios (Golden Ratio, V-taper, etc.)
// - Height-scaled superhero physique benchmarks
// - Detailed asymmetry analysis with severity context
// - Decomposable score breakdown
// - Training priority surfacing
// ============================================================

import type { MuscleGroup } from '@/types/schema';
import type { BodyMeasurements, ImbalanceAnalysis, BilateralAsymmetry } from './measurementImbalanceEngine';

// ============================================================
// TYPES
// ============================================================

/**
 * Classic proportionality ratio analysis
 */
export interface ProportionalityRatio {
  name: string;
  description: string;
  /** The formula/calculation used */
  formula: string;
  /** Current user value */
  currentValue: number;
  /** Ideal target value */
  idealValue: number;
  /** Acceptable range [min, max] */
  acceptableRange: [number, number];
  /** Percentage towards ideal (0-100+) */
  percentOfIdeal: number;
  /** Status classification */
  status: 'far_below' | 'below' | 'optimal' | 'above' | 'far_above';
  /** Priority for improvement (1 = highest) */
  priority: number;
  /** Training recommendation */
  recommendation?: string;
}

/**
 * Superhero physique benchmark tier
 */
export type BenchmarkTier = 'attainable_natural' | 'elite_natural' | 'superhero';

/**
 * Individual measurement benchmark comparison
 */
export interface MeasurementBenchmark {
  measurement: string;
  /** User's current value in cm */
  currentCm: number;
  /** Tier benchmarks (scaled to user's height) */
  benchmarks: {
    attainable: { min: number; max: number };
    elite: { min: number; max: number };
    superhero: { min: number; max: number };
  };
  /** Current tier achieved */
  currentTier: BenchmarkTier | 'below_attainable';
  /** Percentage within current tier (0-100) */
  tierProgress: number;
  /** Associated muscle groups */
  muscleGroups: MuscleGroup[];
}

/**
 * Enhanced asymmetry with context and formatting
 */
export interface EnhancedAsymmetry {
  bodyPart: string;
  leftValueCm: number;
  rightValueCm: number;
  /** Percentage difference (positive = right larger) */
  percentDifference: number;
  /** Absolute difference in cm */
  differenceCm: number;
  /** Which side is dominant */
  dominantSide: 'left' | 'right' | 'balanced';
  /** Severity level with context */
  severity: 'normal' | 'minor' | 'moderate' | 'significant';
  /** Human-readable severity context */
  severityContext: string;
  /** Color indicator for UI */
  severityColor: 'green' | 'yellow' | 'orange' | 'red';
  /** Historical trend if available */
  trend?: 'improving' | 'stable' | 'worsening';
  /** Specific recommendation */
  recommendation: string;
}

/**
 * Training priority with explicit reasoning
 */
export interface TrainingPriority {
  muscleGroup: MuscleGroup | string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  /** The specific metric that drove this priority */
  sourceMetric: string;
  /** Specific value that triggered this */
  metricValue: string;
  /** Type of issue */
  issueType: 'ratio' | 'asymmetry' | 'benchmark' | 'balance';
}

/**
 * Decomposed score breakdown
 */
export interface ScoreBreakdown {
  /** Overall score 0-100 */
  overall: number;
  /** Individual component scores */
  components: {
    symmetry: number;      // L/R balance
    classicRatios: number; // Adonis proportions
    upperLower: number;    // Upper/lower body balance
    vsBenchmark: number;   // Progress toward target physique
  };
  /** Explanation for each component */
  explanations: {
    symmetry: string;
    classicRatios: string;
    upperLower: string;
    vsBenchmark: string;
  };
}

/**
 * Complete enhanced analytics result
 */
export interface EnhancedProportionsAnalysis {
  /** Classic proportionality ratios (Golden ratio, etc.) */
  proportionalityRatios: ProportionalityRatio[];
  /** Height-scaled benchmark comparisons */
  benchmarkComparisons: MeasurementBenchmark[];
  /** Enhanced asymmetry analysis */
  enhancedAsymmetries: EnhancedAsymmetry[];
  /** Surfaced training priorities */
  trainingPriorities: TrainingPriority[];
  /** Decomposed score breakdown */
  scoreBreakdown: ScoreBreakdown;
  /** User's height for context */
  userHeightCm: number;
  /** Scale factor applied to benchmarks */
  heightScaleFactor: number;
}

// ============================================================
// CONSTANTS
// ============================================================

/** Golden ratio constant */
const GOLDEN_RATIO = 1.618;

/**
 * Classic proportionality ratio definitions
 */
const RATIO_DEFINITIONS = {
  shoulderToWaist: {
    name: 'Shoulder-to-Waist Ratio',
    description: 'Primary V-taper metric - the "Adonis Index"',
    formula: 'Shoulders ÷ Waist',
    ideal: GOLDEN_RATIO, // 1.618
    range: [1.4, 1.8] as [number, number],
  },
  chestToWaist: {
    name: 'Chest-to-Waist Ratio',
    description: 'Classic chest proportion for aesthetic torso',
    formula: 'Chest ÷ Waist',
    ideal: 1.35,
    range: [1.2, 1.5] as [number, number],
  },
  armToNeck: {
    name: 'Arm-to-Neck Ratio',
    description: 'Classic arm development - arms should approximate neck',
    formula: 'Bicep ÷ Neck',
    ideal: 1.0,
    range: [0.9, 1.1] as [number, number],
  },
  thighToCalf: {
    name: 'Thigh-to-Calf Ratio',
    description: 'Lower body proportional development',
    formula: 'Thigh ÷ Calf',
    ideal: 1.625,
    range: [1.5, 1.75] as [number, number],
  },
  thighToWaist: {
    name: 'Thigh-to-Waist Ratio',
    description: 'Leg-to-core balance for overall symmetry',
    formula: 'Thigh ÷ Waist',
    ideal: 0.75,
    range: [0.65, 0.85] as [number, number],
  },
};

/**
 * Base superhero physique benchmarks at 72 inches (183 cm)
 * All values in inches for the base reference
 */
const BASE_BENCHMARKS_INCHES = {
  shoulders: {
    superhero: [52, 54],
    elite: [50, 52],
    attainable: [48, 50],
    muscleGroups: ['shoulders'] as MuscleGroup[],
  },
  chest: {
    superhero: [46, 50],
    elite: [44, 46],
    attainable: [42, 44],
    muscleGroups: ['chest'] as MuscleGroup[],
  },
  waist: {
    // Lower is better for waist
    superhero: [31, 33],
    elite: [32, 34],
    attainable: [33, 35],
    muscleGroups: ['abs'] as MuscleGroup[],
  },
  biceps: {
    superhero: [17, 18],
    elite: [16, 17],
    attainable: [15, 16],
    muscleGroups: ['biceps'] as MuscleGroup[],
  },
  neck: {
    superhero: [17, 18],
    elite: [16, 17],
    attainable: [15.5, 16],
    muscleGroups: ['traps'] as MuscleGroup[],
  },
  thighs: {
    superhero: [26, 28],
    elite: [25, 26],
    attainable: [24, 25],
    muscleGroups: ['quads', 'hamstrings'] as MuscleGroup[],
  },
  calves: {
    superhero: [17, 18],
    elite: [16, 17],
    attainable: [15, 16],
    muscleGroups: ['calves'] as MuscleGroup[],
  },
  forearms: {
    superhero: [14, 15],
    elite: [13, 14],
    attainable: [12.5, 13.5],
    muscleGroups: ['forearms'] as MuscleGroup[],
  },
};

const BASE_HEIGHT_INCHES = 72; // 6'0"
const BASE_HEIGHT_CM = 182.88; // 72 * 2.54

// ============================================================
// PROPORTIONALITY RATIO ANALYSIS
// ============================================================

/**
 * Calculate the classic proportionality ratios
 */
export function calculateProportionalityRatios(
  measurements: BodyMeasurements
): ProportionalityRatio[] {
  const ratios: ProportionalityRatio[] = [];

  // Get averaged measurements for bilateral parts
  const avgBicep = getAverage(measurements.left_bicep, measurements.right_bicep);
  const avgThigh = getAverage(measurements.left_thigh, measurements.right_thigh);
  const avgCalf = getAverage(measurements.left_calf, measurements.right_calf);

  // Shoulder-to-Waist Ratio (V-taper / Adonis Index)
  if (measurements.shoulders && measurements.waist) {
    const value = measurements.shoulders / measurements.waist;
    const def = RATIO_DEFINITIONS.shoulderToWaist;
    ratios.push(createRatioAnalysis(def, value, 1));
  }

  // Chest-to-Waist Ratio
  if (measurements.chest && measurements.waist) {
    const value = measurements.chest / measurements.waist;
    const def = RATIO_DEFINITIONS.chestToWaist;
    ratios.push(createRatioAnalysis(def, value, 2));
  }

  // Arm-to-Neck Ratio
  if (avgBicep && measurements.neck) {
    const value = avgBicep / measurements.neck;
    const def = RATIO_DEFINITIONS.armToNeck;
    ratios.push(createRatioAnalysis(def, value, 3));
  }

  // Thigh-to-Calf Ratio
  if (avgThigh && avgCalf) {
    const value = avgThigh / avgCalf;
    const def = RATIO_DEFINITIONS.thighToCalf;
    ratios.push(createRatioAnalysis(def, value, 4));
  }

  // Thigh-to-Waist Ratio
  if (avgThigh && measurements.waist) {
    const value = avgThigh / measurements.waist;
    const def = RATIO_DEFINITIONS.thighToWaist;
    ratios.push(createRatioAnalysis(def, value, 5));
  }

  return ratios;
}

function createRatioAnalysis(
  def: typeof RATIO_DEFINITIONS.shoulderToWaist,
  value: number,
  basePriority: number
): ProportionalityRatio {
  const percentOfIdeal = (value / def.ideal) * 100;
  const status = getRatioStatus(value, def.ideal, def.range);

  // Adjust priority based on how far from ideal
  const deviationFromIdeal = Math.abs(percentOfIdeal - 100);
  const priority = deviationFromIdeal > 15 ? basePriority : basePriority + 5;

  let recommendation: string | undefined;
  if (status === 'below' || status === 'far_below') {
    recommendation = getRatioRecommendation(def.name, 'increase');
  } else if (status === 'above' || status === 'far_above') {
    recommendation = getRatioRecommendation(def.name, 'maintain');
  }

  return {
    name: def.name,
    description: def.description,
    formula: def.formula,
    currentValue: Math.round(value * 100) / 100,
    idealValue: def.ideal,
    acceptableRange: def.range,
    percentOfIdeal: Math.round(percentOfIdeal),
    status,
    priority,
    recommendation,
  };
}

function getRatioStatus(
  value: number,
  ideal: number,
  range: [number, number]
): ProportionalityRatio['status'] {
  if (value >= range[0] && value <= range[1]) return 'optimal';

  const percentOfIdeal = (value / ideal) * 100;
  if (percentOfIdeal < 80) return 'far_below';
  if (percentOfIdeal < 95) return 'below';
  if (percentOfIdeal > 120) return 'far_above';
  if (percentOfIdeal > 105) return 'above';
  return 'optimal';
}

function getRatioRecommendation(ratioName: string, direction: 'increase' | 'maintain'): string {
  const recommendations: Record<string, Record<string, string>> = {
    'Shoulder-to-Waist Ratio': {
      increase: 'Focus on lateral deltoid development (lateral raises, upright rows) and maintain a lean waist through nutrition.',
      maintain: 'Great V-taper! Maintain with balanced shoulder work.',
    },
    'Chest-to-Waist Ratio': {
      increase: 'Prioritize chest development with incline and flat pressing. Consider waist management through diet.',
      maintain: 'Excellent chest proportion. Continue balanced chest training.',
    },
    'Arm-to-Neck Ratio': {
      increase: 'Add arm isolation volume: bicep curls, hammer curls, and tricep work.',
      maintain: 'Classic arm development achieved. Maintain with current approach.',
    },
    'Thigh-to-Calf Ratio': {
      increase: 'Balance leg development - if thighs lag, add squat/leg press volume. If calves lag, train them 3-4x/week.',
      maintain: 'Well-balanced leg proportions. Continue current training.',
    },
    'Thigh-to-Waist Ratio': {
      increase: 'Build quad and hamstring mass with squats, leg press, and Romanian deadlifts.',
      maintain: 'Good leg-to-core balance. Maintain current approach.',
    },
  };

  return recommendations[ratioName]?.[direction] || '';
}

// ============================================================
// SUPERHERO BENCHMARK ANALYSIS
// ============================================================

/**
 * Calculate height-scaled benchmark comparisons
 */
export function calculateBenchmarkComparisons(
  measurements: BodyMeasurements,
  heightCm: number
): MeasurementBenchmark[] {
  const scaleFactor = heightCm / BASE_HEIGHT_CM;
  const benchmarks: MeasurementBenchmark[] = [];

  // Get averaged measurements for bilateral parts
  const avgBicep = getAverage(measurements.left_bicep, measurements.right_bicep);
  const avgThigh = getAverage(measurements.left_thigh, measurements.right_thigh);
  const avgCalf = getAverage(measurements.left_calf, measurements.right_calf);
  const avgForearm = getAverage(measurements.left_forearm, measurements.right_forearm);

  // Map measurements to benchmark definitions
  const measurementMap: Record<string, { value?: number; def: typeof BASE_BENCHMARKS_INCHES.shoulders }> = {
    shoulders: { value: measurements.shoulders, def: BASE_BENCHMARKS_INCHES.shoulders },
    chest: { value: measurements.chest, def: BASE_BENCHMARKS_INCHES.chest },
    waist: { value: measurements.waist, def: BASE_BENCHMARKS_INCHES.waist },
    biceps: { value: avgBicep, def: BASE_BENCHMARKS_INCHES.biceps },
    neck: { value: measurements.neck, def: BASE_BENCHMARKS_INCHES.neck },
    thighs: { value: avgThigh, def: BASE_BENCHMARKS_INCHES.thighs },
    calves: { value: avgCalf, def: BASE_BENCHMARKS_INCHES.calves },
    forearms: { value: avgForearm, def: BASE_BENCHMARKS_INCHES.forearms },
  };

  for (const [name, { value, def }] of Object.entries(measurementMap)) {
    if (value === undefined) continue;

    // Scale benchmarks from inches to cm, then apply height scaling
    const scaledBenchmarks = {
      attainable: {
        min: def.attainable[0] * 2.54 * scaleFactor,
        max: def.attainable[1] * 2.54 * scaleFactor,
      },
      elite: {
        min: def.elite[0] * 2.54 * scaleFactor,
        max: def.elite[1] * 2.54 * scaleFactor,
      },
      superhero: {
        min: def.superhero[0] * 2.54 * scaleFactor,
        max: def.superhero[1] * 2.54 * scaleFactor,
      },
    };

    // Determine current tier and progress
    const { tier, progress } = determineBenchmarkTier(value, scaledBenchmarks, name === 'waist');

    benchmarks.push({
      measurement: formatMeasurementName(name),
      currentCm: value,
      benchmarks: scaledBenchmarks,
      currentTier: tier,
      tierProgress: progress,
      muscleGroups: def.muscleGroups,
    });
  }

  return benchmarks;
}

function determineBenchmarkTier(
  valueCm: number,
  benchmarks: MeasurementBenchmark['benchmarks'],
  isWaist: boolean
): { tier: MeasurementBenchmark['currentTier']; progress: number } {
  // For waist, lower is better, so tier logic is inverted
  if (isWaist) {
    if (valueCm <= benchmarks.superhero.max) {
      const range = benchmarks.superhero.max - benchmarks.superhero.min;
      const progress = Math.min(100, ((benchmarks.superhero.max - valueCm) / range) * 100);
      return { tier: 'superhero', progress: Math.max(0, progress) };
    }
    if (valueCm <= benchmarks.elite.max) {
      const range = benchmarks.elite.max - benchmarks.superhero.max;
      const progress = ((benchmarks.elite.max - valueCm) / range) * 100;
      return { tier: 'elite_natural', progress: Math.max(0, progress) };
    }
    if (valueCm <= benchmarks.attainable.max) {
      const range = benchmarks.attainable.max - benchmarks.elite.max;
      const progress = ((benchmarks.attainable.max - valueCm) / range) * 100;
      return { tier: 'attainable_natural', progress: Math.max(0, progress) };
    }
    return { tier: 'below_attainable', progress: 0 };
  }

  // For all other measurements, higher is better
  if (valueCm >= benchmarks.superhero.min) {
    const range = benchmarks.superhero.max - benchmarks.superhero.min;
    const progress = Math.min(100, ((valueCm - benchmarks.superhero.min) / range) * 100);
    return { tier: 'superhero', progress: Math.max(0, progress) };
  }
  if (valueCm >= benchmarks.elite.min) {
    const range = benchmarks.superhero.min - benchmarks.elite.min;
    const progress = ((valueCm - benchmarks.elite.min) / range) * 100;
    return { tier: 'elite_natural', progress: Math.max(0, progress) };
  }
  if (valueCm >= benchmarks.attainable.min) {
    const range = benchmarks.elite.min - benchmarks.attainable.min;
    const progress = ((valueCm - benchmarks.attainable.min) / range) * 100;
    return { tier: 'attainable_natural', progress: Math.max(0, progress) };
  }

  // Below attainable - show progress toward attainable
  const distanceToAttainable = benchmarks.attainable.min - valueCm;
  const progress = Math.max(0, 100 - (distanceToAttainable / benchmarks.attainable.min * 100));
  return { tier: 'below_attainable', progress };
}

// ============================================================
// ENHANCED ASYMMETRY ANALYSIS
// ============================================================

/**
 * Create enhanced asymmetry analysis with context
 */
export function createEnhancedAsymmetries(
  asymmetries: BilateralAsymmetry[]
): EnhancedAsymmetry[] {
  return asymmetries.map(a => {
    const absPercent = Math.abs(a.asymmetryPercent);

    let severity: EnhancedAsymmetry['severity'];
    let severityContext: string;
    let severityColor: EnhancedAsymmetry['severityColor'];

    if (absPercent < 3) {
      severity = 'normal';
      severityContext = 'Normal range - no action needed';
      severityColor = 'green';
    } else if (absPercent < 5) {
      severity = 'minor';
      severityContext = 'Minor difference - likely dominant side, monitor over time';
      severityColor = 'yellow';
    } else if (absPercent < 8) {
      severity = 'moderate';
      severityContext = 'Moderate imbalance - consider adding unilateral work';
      severityColor = 'orange';
    } else {
      severity = 'significant';
      severityContext = 'Significant imbalance - prioritize correction with unilateral exercises';
      severityColor = 'red';
    }

    const weakSide = a.dominantSide === 'left' ? 'right' : 'left';
    const recommendation = severity === 'normal'
      ? 'Maintain balanced training.'
      : `Start ${a.bodyPart} exercises with your ${weakSide} side. ${
          severity === 'significant'
            ? `Add 1-2 extra sets for ${weakSide} side using unilateral exercises.`
            : 'Use unilateral exercises to ensure equal work.'
        }`;

    return {
      bodyPart: formatMeasurementName(a.bodyPart),
      leftValueCm: a.leftCm,
      rightValueCm: a.rightCm,
      percentDifference: a.asymmetryPercent,
      differenceCm: a.differenceCm,
      dominantSide: a.dominantSide,
      severity,
      severityContext,
      severityColor,
      recommendation,
    };
  });
}

// ============================================================
// TRAINING PRIORITIES
// ============================================================

/**
 * Surface training priorities from analysis
 */
export function calculateTrainingPriorities(
  ratios: ProportionalityRatio[],
  asymmetries: EnhancedAsymmetry[],
  benchmarks: MeasurementBenchmark[],
  imbalanceAnalysis?: ImbalanceAnalysis
): TrainingPriority[] {
  const priorities: TrainingPriority[] = [];

  // From proportionality ratios (biggest deviations first)
  for (const ratio of ratios) {
    if (ratio.status === 'far_below' || ratio.status === 'below') {
      const priority: 'high' | 'medium' = ratio.status === 'far_below' ? 'high' : 'medium';
      priorities.push({
        muscleGroup: getMuscleGroupFromRatio(ratio.name),
        priority,
        reason: `Improve ${ratio.name.replace(' Ratio', '')}`,
        sourceMetric: ratio.name,
        metricValue: `${ratio.currentValue.toFixed(2)} (target: ${ratio.idealValue.toFixed(2)})`,
        issueType: 'ratio',
      });
    }
  }

  // From asymmetries
  for (const asym of asymmetries) {
    if (asym.severity === 'moderate' || asym.severity === 'significant') {
      const priority: 'high' | 'medium' = asym.severity === 'significant' ? 'high' : 'medium';
      const weakSide = asym.dominantSide === 'left' ? 'Right' : 'Left';
      priorities.push({
        muscleGroup: `${weakSide} ${asym.bodyPart}`,
        priority,
        reason: 'Balance asymmetry',
        sourceMetric: `${asym.bodyPart} symmetry`,
        metricValue: `${Math.abs(asym.percentDifference).toFixed(1)}% ${asym.dominantSide === 'balanced' ? 'balanced' : `larger on ${asym.dominantSide}`}`,
        issueType: 'asymmetry',
      });
    }
  }

  // From benchmark comparisons (below attainable)
  for (const bench of benchmarks) {
    if (bench.currentTier === 'below_attainable') {
      priorities.push({
        muscleGroup: bench.muscleGroups[0] || bench.measurement,
        priority: 'medium',
        reason: `Build toward ${bench.measurement.toLowerCase()} target`,
        sourceMetric: `${bench.measurement} vs benchmarks`,
        metricValue: 'Below attainable natural',
        issueType: 'benchmark',
      });
    }
  }

  // Sort by priority (high first) and limit
  priorities.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  return priorities.slice(0, 6); // Top 6 priorities
}

function getMuscleGroupFromRatio(ratioName: string): string {
  const mapping: Record<string, string> = {
    'Shoulder-to-Waist Ratio': 'Lateral Delts',
    'Chest-to-Waist Ratio': 'Chest',
    'Arm-to-Neck Ratio': 'Biceps/Triceps',
    'Thigh-to-Calf Ratio': 'Legs',
    'Thigh-to-Waist Ratio': 'Quads/Hamstrings',
  };
  return mapping[ratioName] || 'General';
}

// ============================================================
// SCORE BREAKDOWN
// ============================================================

/**
 * Calculate decomposed score breakdown
 */
export function calculateScoreBreakdown(
  asymmetries: EnhancedAsymmetry[],
  ratios: ProportionalityRatio[],
  benchmarks: MeasurementBenchmark[]
): ScoreBreakdown {
  // Symmetry score (L/R balance)
  let symmetryScore = 100;
  let symmetryDeductions = 0;
  for (const a of asymmetries) {
    if (a.severity === 'minor') symmetryDeductions += 3;
    if (a.severity === 'moderate') symmetryDeductions += 8;
    if (a.severity === 'significant') symmetryDeductions += 15;
  }
  symmetryScore = Math.max(0, 100 - symmetryDeductions);

  // Classic ratios score
  let ratiosScore = 100;
  let ratioDeductions = 0;
  for (const r of ratios) {
    const deviation = Math.abs(r.percentOfIdeal - 100);
    if (deviation > 20) ratioDeductions += 15;
    else if (deviation > 10) ratioDeductions += 8;
    else if (deviation > 5) ratioDeductions += 3;
  }
  ratiosScore = Math.max(0, 100 - ratioDeductions);

  // Upper/Lower balance (from ratios that compare upper to lower)
  let upperLowerScore = 100;
  const thighWaistRatio = ratios.find(r => r.name === 'Thigh-to-Waist Ratio');
  if (thighWaistRatio) {
    const deviation = Math.abs(thighWaistRatio.percentOfIdeal - 100);
    upperLowerScore = Math.max(0, 100 - deviation);
  }

  // Benchmark progress score
  let benchmarkScore = 0;
  if (benchmarks.length > 0) {
    const tierScores = benchmarks.map(b => {
      switch (b.currentTier) {
        case 'superhero': return 100;
        case 'elite_natural': return 80;
        case 'attainable_natural': return 60;
        default: return 30 + b.tierProgress * 0.3;
      }
    });
    benchmarkScore = tierScores.reduce((a, b) => a + b, 0) / tierScores.length;
  }

  // Overall score (weighted average)
  const overall = Math.round(
    symmetryScore * 0.25 +
    ratiosScore * 0.35 +
    upperLowerScore * 0.15 +
    benchmarkScore * 0.25
  );

  // Generate explanations
  const explanations = {
    symmetry: symmetryScore >= 90
      ? 'Excellent left/right balance across all measurements'
      : symmetryScore >= 70
      ? 'Good symmetry with minor imbalances to address'
      : 'Notable asymmetries detected - prioritize unilateral work',
    classicRatios: ratiosScore >= 90
      ? 'Near-ideal classic proportions'
      : ratiosScore >= 70
      ? 'Good proportions with room for optimization'
      : 'Some ratios need focused attention',
    upperLower: upperLowerScore >= 90
      ? 'Balanced upper and lower body development'
      : upperLowerScore >= 70
      ? 'Minor upper/lower imbalance'
      : 'Consider rebalancing upper vs lower body training volume',
    vsBenchmark: benchmarkScore >= 80
      ? 'Approaching elite/superhero measurements for your height'
      : benchmarkScore >= 60
      ? 'Solid progress toward target benchmarks'
      : 'Building toward attainable natural targets',
  };

  return {
    overall,
    components: {
      symmetry: Math.round(symmetryScore),
      classicRatios: Math.round(ratiosScore),
      upperLower: Math.round(upperLowerScore),
      vsBenchmark: Math.round(benchmarkScore),
    },
    explanations,
  };
}

// ============================================================
// MAIN ANALYSIS FUNCTION
// ============================================================

/**
 * Perform complete enhanced proportions analysis
 */
export function analyzeEnhancedProportions(
  measurements: BodyMeasurements,
  heightCm: number,
  existingAsymmetries: BilateralAsymmetry[],
  imbalanceAnalysis?: ImbalanceAnalysis
): EnhancedProportionsAnalysis {
  const scaleFactor = heightCm / BASE_HEIGHT_CM;

  // Calculate all analyses
  const proportionalityRatios = calculateProportionalityRatios(measurements);
  const benchmarkComparisons = calculateBenchmarkComparisons(measurements, heightCm);
  const enhancedAsymmetries = createEnhancedAsymmetries(existingAsymmetries);
  const trainingPriorities = calculateTrainingPriorities(
    proportionalityRatios,
    enhancedAsymmetries,
    benchmarkComparisons,
    imbalanceAnalysis
  );
  const scoreBreakdown = calculateScoreBreakdown(
    enhancedAsymmetries,
    proportionalityRatios,
    benchmarkComparisons
  );

  return {
    proportionalityRatios,
    benchmarkComparisons,
    enhancedAsymmetries,
    trainingPriorities,
    scoreBreakdown,
    userHeightCm: heightCm,
    heightScaleFactor: scaleFactor,
  };
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getAverage(left?: number, right?: number): number | undefined {
  if (left !== undefined && right !== undefined) {
    return (left + right) / 2;
  }
  return undefined;
}

function formatMeasurementName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
