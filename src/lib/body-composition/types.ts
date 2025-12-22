/**
 * Body Composition Prediction Types
 *
 * Models fat vs lean mass changes using P-ratio (partition ratio) based on
 * protein intake, training volume, deficit size, and starting body composition.
 * Calibrates predictions with DEXA scans over time.
 */

// ============ DEXA SCAN TYPES ============

/**
 * DEXA scan data with extended metadata for prediction calibration
 */
export interface DEXAScan {
  id: string;
  userId: string;
  scanDate: Date;
  provider?: string; // "DexaFit", "BodySpec", "Hospital", etc.

  // Core measurements (stored in kg)
  totalMassKg: number;
  fatMassKg: number;
  leanMassKg: number;
  boneMineralKg?: number;

  // Calculated
  bodyFatPercent: number;
  fatFreeMassKg: number; // Lean + bone

  // Regional (optional but valuable)
  regional?: DEXARegionalData;

  // Metadata
  notes?: string;
  scanImageUrl?: string; // User can upload scan report

  // Scan conditions (affects confidence)
  conditions: ScanConditions;

  // Validation
  isBaseline: boolean; // First scan in current phase
  confidence: ScanConfidence;

  createdAt: Date;
}

/**
 * Regional body composition data from DEXA scan
 */
export interface DEXARegionalData {
  trunk: { fatMass: number; leanMass: number };
  leftArm: { fatMass: number; leanMass: number };
  rightArm: { fatMass: number; leanMass: number };
  leftLeg: { fatMass: number; leanMass: number };
  rightLeg: { fatMass: number; leanMass: number };
}

/**
 * Scan conditions that affect measurement reliability
 */
export interface ScanConditions {
  timeOfDay: 'morning_fasted' | 'morning_fed' | 'afternoon' | 'evening';
  hydrationStatus: 'normal' | 'dehydrated' | 'overhydrated' | 'unknown';
  recentWorkout: boolean; // Worked out within 24h
  sameProviderAsPrevious: boolean;
}

export type ScanConfidence = 'high' | 'medium' | 'low';

// ============ DEXA INPUT TYPES ============

/**
 * User input for logging a new DEXA scan
 */
export interface DEXAScanInput {
  scanDate: Date;
  provider?: string;

  // User can enter these directly from report
  totalWeight: number;
  bodyFatPercent: number;

  // Or enter masses directly
  fatMass?: number;
  leanMass?: number;
  boneMass?: number;

  // Optional detailed entry
  regional?: DEXARegionalData;

  // Scan conditions (affects confidence)
  conditions: ScanConditions;

  notes?: string;
}

// ============ P-RATIO TYPES ============

/**
 * P-Ratio (Partition Ratio) = proportion of weight loss from fat
 *
 * P-ratio of 0.80 means: for every 10 lbs lost, 8 lbs is fat, 2 lbs is lean
 *
 * Research ranges:
 * - Well-designed cut: 0.75 - 0.90
 * - Crash diet, no training: 0.50 - 0.70
 * - Lean individual aggressive cut: 0.60 - 0.75
 * - Beginner recomp: can exceed 1.0 (gains muscle while losing fat)
 */
export interface PartitionRatioFactors {
  baseRatio: number; // Research baseline ~0.80
  proteinFactor: number; // 0.9 - 1.1 based on protein intake
  trainingFactor: number; // 0.9 - 1.1 based on volume
  deficitFactor: number; // 0.85 - 1.05 based on deficit size
  bodyFatFactor: number; // 0.7 - 1.1 based on starting BF%
  ageFactor: number; // 0.95 - 1.0 based on training age
  enhancedFactor: number; // 1.0 - 1.2 if enhanced

  // Combined
  finalPRatio: number;
  confidenceRange: [number, number]; // e.g., [0.70, 0.90]
}

/**
 * Inputs for calculating P-ratio
 */
export interface PRatioInputs {
  // From user's recent data (last 7-14 days avg)
  avgDailyProteinGrams: number;
  avgDailyProteinPerKgBW: number;
  avgWeeklyTrainingSets: number;
  avgDailyDeficitCals: number;
  deficitPercent: number; // Deficit as % of TDEE

  // From most recent DEXA or estimate
  currentBodyFatPercent: number;
  currentLeanMassKg: number;

  // User profile
  trainingAge: TrainingAge;
  isEnhanced: boolean;
  biologicalSex: 'male' | 'female';

  // Optional: learned from previous scans
  personalPRatioHistory?: number[];
}

export type TrainingAge = 'beginner' | 'intermediate' | 'advanced';

// ============ PREDICTION TYPES ============

/**
 * Body composition prediction with confidence intervals
 */
export interface BodyCompPrediction {
  targetDate: Date;
  targetWeight: number;

  // Point estimates
  predictedFatMass: number;
  predictedLeanMass: number;
  predictedBodyFatPercent: number;

  // Confidence intervals (THIS IS CRITICAL)
  fatMassRange: {
    optimistic: number; // Best case (high P-ratio)
    expected: number; // Most likely
    pessimistic: number; // Worst case (low P-ratio)
  };
  leanMassRange: {
    optimistic: number; // Minimal muscle loss / possible gain
    expected: number; // Most likely
    pessimistic: number; // More muscle loss
  };
  bodyFatPercentRange: {
    optimistic: number;
    expected: number;
    pessimistic: number;
  };

  // Confidence metadata
  confidenceLevel: PredictionConfidence;
  confidenceFactors: string[]; // Why confidence is what it is

  // Assumptions used
  assumptions: PredictionAssumptions;
}

/**
 * Never say "high" confidence for body comp predictions
 */
export type PredictionConfidence = 'low' | 'moderate' | 'reasonable';

export interface PredictionAssumptions {
  avgDailyDeficit: number;
  avgDailyProtein: number;
  avgWeeklyVolume: number;
  pRatioUsed: number;
}

// ============ USER PROFILE TYPES ============

/**
 * User's body composition tracking profile
 */
export interface UserBodyCompProfile {
  userId: string;

  // DEXA history
  scans: DEXAScan[];

  // Learned parameters (calibrated from actual scans)
  learnedPRatio: number | null; // Personal partition ratio
  pRatioConfidence: PRatioConfidence;
  pRatioDataPoints: number; // Number of scan pairs used

  // Modifiers learned from user's actual results
  proteinModifier: number; // Default 1.0
  trainingModifier: number; // Default 1.0
  deficitModifier: number; // Default 1.0

  // Context
  trainingAge: TrainingAge;
  isEnhanced: boolean;

  lastUpdated: Date;
}

export type PRatioConfidence = 'none' | 'low' | 'medium' | 'high';

// ============ RECOMMENDATION TYPES ============

/**
 * Actionable recommendation to improve body composition outcomes
 */
export interface BodyCompRecommendation {
  category: 'protein' | 'training' | 'deficit' | 'general';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string; // How much this could improve P-ratio
  currentValue?: string;
  targetValue?: string;
}

// ============ CALIBRATION TYPES ============

/**
 * Result of calibrating P-ratio from actual DEXA scan pairs
 */
export interface CalibrationResult {
  learnedPRatio: number;
  confidence: PRatioConfidence;
  dataPoints: number;
  scanPairs: ScanPairAnalysis[];
}

/**
 * Analysis of a consecutive scan pair
 */
export interface ScanPairAnalysis {
  startScan: DEXAScan;
  endScan: DEXAScan;
  weightChange: number;
  fatChange: number;
  leanChange: number;
  calculatedPRatio: number;
  durationDays: number;
  isValid: boolean;
  invalidReason?: string;
}

/**
 * Comparison of predicted vs actual results
 */
export interface PredictionAccuracyLog {
  userId: string;
  predictionDate: Date;
  actualDate: Date;

  // What we predicted
  predictedBodyFat: number;
  predictedLeanMass: number;
  predictedFatMass: number;

  // What actually happened
  actualBodyFat: number;
  actualLeanMass: number;
  actualFatMass: number;

  // Errors
  bodyFatError: number; // Actual - Predicted
  leanMassError: number;
  fatMassError: number;

  // Was prediction within the confidence range?
  withinRange: boolean;

  // What P-ratio was used vs actual
  predictedPRatio: number;
  actualPRatio: number;
}

// ============ DATABASE TYPES ============

/**
 * Database row for body_comp_profiles table
 */
export interface BodyCompProfileRow {
  id: string;
  user_id: string;
  learned_p_ratio: number | null;
  p_ratio_confidence: PRatioConfidence;
  p_ratio_data_points: number;
  protein_modifier: number;
  training_modifier: number;
  deficit_modifier: number;
  training_age: TrainingAge;
  is_enhanced: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Extended DEXA scan database row (extends existing dexa_scans table)
 */
export interface DEXAScanRow {
  id: string;
  user_id: string;
  scan_date: string;
  weight_kg: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
  body_fat_percent: number;
  bone_mass_kg: number | null;
  regional_data: DEXARegionalData | null;
  notes: string | null;
  provider: string | null;
  scan_image_url: string | null;
  conditions: ScanConditions | null;
  is_baseline: boolean;
  confidence: ScanConfidence;
  created_at: string;
}

/**
 * Prediction accuracy log database row
 */
export interface PredictionAccuracyRow {
  id: string;
  user_id: string;
  prediction_date: string;
  actual_date: string;
  predicted_body_fat: number;
  predicted_lean_mass: number;
  predicted_fat_mass: number;
  actual_body_fat: number;
  actual_lean_mass: number;
  actual_fat_mass: number;
  body_fat_error: number;
  lean_mass_error: number;
  fat_mass_error: number;
  within_range: boolean;
  predicted_p_ratio: number;
  actual_p_ratio: number;
  created_at: string;
}

// ============ HELPER TYPES ============

/**
 * Weight change scenario for projections
 */
export interface WeightChangeScenario {
  targetWeight: number;
  weeklyDeficit: number;
  estimatedWeeks: number;
}

/**
 * Body composition change summary
 */
export interface BodyCompChangeSummary {
  startDate: Date;
  endDate: Date;
  weightChange: number;
  fatChange: number;
  leanChange: number;
  bodyFatChange: number;
  calculatedPRatio: number;
  pRatioQuality: 'excellent' | 'good' | 'fair' | 'poor';
}
