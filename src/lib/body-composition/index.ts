/**
 * Body Composition Prediction Module
 *
 * Model fat vs lean mass changes using P-ratio (partition ratio) based on
 * protein intake, training volume, deficit size, and starting body composition.
 * Calibrate predictions with DEXA scans over time.
 */

// Types
export * from './types';

// P-ratio calculation
export {
  BASE_P_RATIO,
  calculateScanConfidence,
  calculatePRatio,
  getPRatioDescription,
  getPRatioQuality,
  explainPRatioFactors,
} from './p-ratio';

// Prediction
export {
  predictBodyComposition,
  explainWeightLossBreakdown,
  generateWeightScenarios,
  estimateTimeToTarget,
  calculateRequiredDeficit,
  calculateProjectionDate,
  createEmptyProfile,
} from './prediction';

// Calibration
export {
  analyzeScanPair,
  calibratePRatioFromScans,
  getBodyCompChangeSummary,
  comparePredictionVsActual,
  processNewDEXAScan,
  formatPRatioAsPercentage,
  explainPRatioResult,
  getScansNeededForConfidence,
} from './calibration';

// Recommendations
export {
  generateBodyCompRecommendations,
  getTopRecommendation,
  getRecommendationIcon,
  getRecommendationPriorityColor,
  getRecommendationPriorityBg,
  generateRecommendationSummary,
  hasHighPriorityRecommendations,
  estimateImprovementPotential,
} from './recommendations';
