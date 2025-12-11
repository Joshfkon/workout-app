// ============================================================
// TRAINING SCIENCE TYPES
// Comprehensive types for the program engine and coaching system
// ============================================================

import type { MuscleGroup } from './schema';

// ---- Enums & Basic Types ----

export type Sex = 'male' | 'female';
export type Experience = 'novice' | 'intermediate' | 'advanced';
export type Goal = 'bulk' | 'cut' | 'recomp' | 'maintain';
export type Split = 'Full Body' | 'Upper/Lower' | 'PPL' | 'Upper/Lower/PPL' | 'Arnold' | 'Bro Split';
export type PeriodizationModel = 'linear' | 'daily_undulating' | 'weekly_undulating' | 'block';
export type DeloadStrategy = 'proactive' | 'reactive' | 'none';
export type Equipment = 'barbell' | 'dumbbell' | 'cable' | 'machine' | 'bodyweight' | 'kettlebell';
export type MovementPattern = 'horizontal_push' | 'horizontal_pull' | 'vertical_push' | 'vertical_pull' 
  | 'hip_hinge' | 'squat' | 'lunge' | 'isolation' | 'carry';
export type StrengthLevel = 'untrained' | 'beginner' | 'novice' | 'intermediate' | 'advanced' | 'elite';
export type Confidence = 'high' | 'medium' | 'low' | 'extrapolated' | 'find_working_weight';
export type FiberType = 'fast' | 'slow' | 'mixed';

// ---- Database Row Types ----

export interface BodyCompositionRow {
  id: string;
  user_id: string;
  recorded_at: string;
  weight_kg: number;
  height_cm: number | null;
  body_fat_percent: number | null;
  lean_mass_kg: number | null;
  ffmi: number | null;
  source: string;
  notes: string | null;
}

export interface StrengthCalibrationRow {
  id: string;
  user_id: string;
  exercise_name: string;
  tested_weight_kg: number;
  tested_reps: number;
  tested_rpe: number | null;
  estimated_1rm_kg: number;
  confidence: Confidence;
  source: string;
  percentile_general: number | null;
  percentile_trained: number | null;
  strength_level: StrengthLevel | null;
  tested_at: string;
}

export interface UserTrainingProfileRow {
  user_id: string;
  sex: Sex;
  birth_date: string | null;
  training_age_years: number;
  experience_level: Experience;
  primary_goal: Goal;
  sleep_quality: number;
  stress_level: number;
  available_equipment: Equipment[];
  injury_history: MuscleGroup[];
  preferred_session_minutes: number;
  updated_at: string;
}

export interface ExerciseHistoryRow {
  id: string;
  user_id: string;
  workout_session_id: string | null;
  exercise_name: string;
  performed_at: string;
  sets: {
    weight: number;
    reps: number;
    rpe?: number;
    completed: boolean;
  }[];
  estimated_1rm_kg: number | null;
}

export interface WeeklyFatigueLogRow {
  id: string;
  user_id: string;
  mesocycle_id: string | null;
  week_number: number;
  logged_at: string;
  perceived_fatigue: number | null;
  sleep_quality: number | null;
  motivation_level: number | null;
  missed_reps: number;
  joint_pain: boolean;
  strength_decline: boolean;
  notes: string | null;
}

export interface CoachingSessionRow {
  id: string;
  user_id: string;
  status: 'not_started' | 'body_comp' | 'selecting_tests' | 'testing' | 'completed' | 'in_progress';
  selected_benchmarks: string[];
  completed_benchmarks: string[];
  strength_profile: StrengthProfileData | null;
  body_composition: BodyComposition | null;
  started_at: string;
  completed_at: string | null;
}

// ---- Core Training Types ----

export interface BodyComposition {
  totalWeightKg: number;
  heightCm: number;
  bodyFatPercentage: number;
  leanMassKg: number;
  ffmi: number;
}

export interface UserProfile {
  age: number;
  sex: Sex;
  experience: Experience;
  goal: Goal;
  sleepQuality: 1 | 2 | 3 | 4 | 5;
  stressLevel: 1 | 2 | 3 | 4 | 5;
  availableEquipment: Equipment[];
  injuryHistory: MuscleGroup[];
  trainingAge: number;
}

export interface RecoveryFactors {
  volumeMultiplier: number;
  frequencyMultiplier: number;
  deloadFrequencyWeeks: number;
  warnings: string[];
}

export interface FatigueBudgetConfig {
  systemicLimit: number;
  localLimit: number;
  minSFRThreshold: number;
  warningThreshold: number;
}

export interface RepRangeConfig {
  min: number;
  max: number;
  targetRIR: number;
  tempoRecommendation: string;
  notes: string;
}

export interface WeeklyProgression {
  week: number;
  intensityModifier: number;
  volumeModifier: number;
  rpeTarget: { min: number; max: number };
  focus: string;
}

export interface PeriodizationPlan {
  model: PeriodizationModel;
  mesocycleWeeks: number;
  weeklyProgression: WeeklyProgression[];
  deloadFrequency: number;
  deloadStrategy: DeloadStrategy;
}

export interface Exercise {
  id?: string;
  name: string;
  primaryMuscle: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  pattern: MovementPattern;
  equipment: Equipment;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  fatigueRating: 1 | 2 | 3;
  notes?: string;
}

export interface WarmupSet {
  percentOfWorking: number;
  reps: number;
  rest: number;
  notes: string;
}

export interface FindingWeightProtocol {
  startingWeight: number;
  incrementKg: number;
  targetRPE: number;
  maxAttempts: number;
  instructions: string;
}

export interface WorkingWeightRecommendation {
  exercise: string;
  targetReps: { min: number; max: number };
  targetRIR: number;
  recommendedWeight: number;
  weightRange: { low: number; high: number };
  confidence: Confidence;
  rationale: string;
  warmupProtocol?: WarmupSet[];
  findingWeightProtocol?: FindingWeightProtocol;
}

export interface FatigueProfile {
  systemicCost: number;
  localCost: Record<string, number>;
  sfr: number;
  efficiency: 'optimal' | 'acceptable' | 'suboptimal';
}

export interface DetailedExercise {
  exercise: Exercise;
  sets: number;
  reps: RepRangeConfig;
  restSeconds: number;
  loadGuidance: string;
  notes: string;
  weightRecommendation?: WorkingWeightRecommendation;
  fatigueProfile: FatigueProfile;
}

export interface FatigueSummary {
  systemicFatigueGenerated: number;
  systemicCapacityUsed: number;
  averageSFR: number;
  localFatigueByMuscle: Record<string, number>;
}

export interface DetailedSession {
  dayIndex: number;
  day: string;
  focus: string;
  exercises: DetailedExercise[];
  totalSets: number;
  estimatedMinutes: number;
  warmup: string[];
  fatigueSummary: FatigueSummary;
}

export interface MesocycleWeek {
  weekNumber: number;
  focus: string;
  intensityModifier: number;
  volumeModifier: number;
  rpeTarget: { min: number; max: number };
  sessions: DetailedSession[];
  isDeload: boolean;
}

export interface VolumePerMuscle {
  sets: number;
  frequency: number;
}

export interface FullProgramRecommendation {
  split: Split;
  schedule: string[];
  periodization: PeriodizationPlan;
  recoveryProfile: RecoveryFactors;
  fatigueBudget: FatigueBudgetConfig;
  volumePerMuscle: Record<MuscleGroup, VolumePerMuscle>;
  sessions: DetailedSession[];
  mesocycleWeeks: MesocycleWeek[];
  warnings: string[];
  programNotes: string[];
}

// ---- Calibration / Coaching Types ----

export interface PercentileScore {
  vsGeneralPopulation: number;
  vsTrainedPopulation: number;
  vsBodyComposition: number;
}

export interface CalibrationResult {
  lift: string;
  benchmarkId?: string;
  testedWeight: number;
  testedReps: number;
  testedRPE?: number;
  estimated1RM: number;
  percentileScore: PercentileScore;
  strengthLevel: StrengthLevel;
}

export interface StrengthImbalance {
  type: 'push_pull' | 'upper_lower' | 'anterior_posterior' | 'bilateral';
  description: string;
  severity: 'minor' | 'moderate' | 'significant';
  recommendation: string;
}

export interface StrengthProfileData {
  overallScore: number;
  strengthLevel: StrengthLevel;
  balanceScore: number;
  imbalances: StrengthImbalance[];
  calibratedLifts: CalibrationResult[];
  bodyComposition: BodyComposition;
  recommendations: string[];
}

export interface TestingProtocol {
  type: 'rpe_based' | 'rep_max' | 'amrap';
  targetReps?: number;
  targetRPE?: number;
  warmupProtocol: WarmupSet[];
  instructions: string;
  safetyWarnings: string[];
  estimationAccuracy: number;
}

export interface PercentileTable {
  male: Record<number, number>;
  female: Record<number, number>;
}

export interface BenchmarkLift {
  id: string;
  name: string;
  pattern: MovementPattern;
  equipment: Equipment;
  description: string;
  safetyNotes: string;
  alternatives: string[];
  derivesExercises: string[];
  testingProtocol: TestingProtocol;
  populationPercentiles: PercentileTable;
}

// ---- Deload Types ----

export interface DeloadTriggers {
  shouldDeload: boolean;
  reasons: string[];
  suggestedDeloadType: 'volume' | 'intensity' | 'full';
}

export interface PerformanceLog {
  weekNumber: number;
  missedReps: number;
  perceivedFatigue: 1 | 2 | 3 | 4 | 5;
  sleepQuality: 1 | 2 | 3 | 4 | 5;
  motivationLevel: 1 | 2 | 3 | 4 | 5;
  jointPain: boolean;
  strengthDecline: boolean;
}

// ---- Estimated Max Types ----

export interface EstimatedMax {
  exercise: string;
  estimated1RM: number;
  confidence: Confidence;
  source: 'direct_history' | 'related_exercise' | 'strength_standards' | 'bodyweight_ratio' | 'calibration';
  lastUpdated: Date;
}

// ---- Exercise Relationship Types ----

export interface ExerciseRelationship {
  parent: string;
  ratioToParent: number;
  notes?: string;
}

// ---- Strength Standards Types ----

export interface StrengthStandards {
  benchPress: number;
  squat: number;
  deadlift: number;
  overheadPress: number;
  barbellRow: number;
}

export type FFMIBracket = 'below_average' | 'average' | 'above_average' | 'excellent' | 'elite';

// ---- Program Generation Config ----

export interface ProgramGenerationConfig {
  daysPerWeek: number;
  sessionMinutes?: number;
  name?: string;
  priorityMuscles?: MuscleGroup[];
  excludeExercises?: string[];
}

export interface GeneratedMesocycle {
  mesocycleId: string;
  program: FullProgramRecommendation;
}

