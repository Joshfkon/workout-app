/**
 * Types for Supabase database query results
 *
 * These interfaces represent the shape of data returned from common
 * database queries, especially those with joins.
 */

import type { SetQuality, SetFeedback, VolumeStatus, MuscleGroup } from './schema';

// ============ SET LOG QUERY RESULTS ============

/**
 * Set log as returned from database queries
 */
export interface SetLogRow {
  id: string;
  exercise_block_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number;
  rest_seconds: number | null;
  is_warmup: boolean;
  set_type: 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';
  parent_set_id: string | null;
  quality: SetQuality;
  quality_reason: string;
  note: string | null;
  logged_at: string;
  feedback?: SetFeedback | null;
  bodyweight_data?: Record<string, unknown> | null;
}

// ============ EXERCISE QUERY RESULTS ============

/**
 * Exercise as returned from database queries
 */
export interface ExerciseRow {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  mechanic: 'compound' | 'isolation';
  default_rep_range: number[];
  default_rir: number;
  min_weight_increment_kg: number;
  form_cues: string[];
  common_mistakes: string[];
  setup_note: string;
  movement_pattern: string;
  equipment_required: string[];
  is_bodyweight?: boolean;
  bodyweight_type?: string | null;
  assistance_type?: string | null;
  hypertrophy_tier?: string | null;
  spinal_loading?: string | null;
  difficulty?: string | null;
  pattern?: string | null;
}

// ============ WORKOUT SESSION QUERY RESULTS ============

/**
 * Workout session as returned from database queries
 */
export interface WorkoutSessionRow {
  id: string;
  user_id: string;
  mesocycle_id: string | null;
  state: 'planned' | 'in_progress' | 'completed' | 'skipped';
  planned_date: string;
  started_at: string | null;
  completed_at: string | null;
  pre_workout_check_in: Record<string, unknown> | null;
  session_rpe: number | null;
  pump_rating: number | null;
  session_notes: string | null;
  completion_percent: number;
}

// ============ EXERCISE BLOCK QUERY RESULTS ============

/**
 * Exercise block as returned from database queries
 */
export interface ExerciseBlockRow {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  order: number;
  superset_group_id: string | null;
  superset_order: number | null;
  target_sets: number;
  target_rep_range: number[];
  target_rir: number;
  target_weight_kg: number;
  target_rest_seconds: number;
  progression_type: 'load' | 'reps' | 'sets' | 'technique' | null;
  suggestion_reason: string;
  warmup_protocol: Record<string, unknown>[];
  note: string | null;
  dropsets_per_set: number;
  drop_percentage: number;
  exercise_name?: string;
}

/**
 * Exercise block with joined exercise data
 */
export interface ExerciseBlockWithExercise extends ExerciseBlockRow {
  exercises: ExerciseRow | null;
}

/**
 * Exercise block with joined session data
 */
export interface ExerciseBlockWithSession extends ExerciseBlockRow {
  workout_sessions: WorkoutSessionRow | null;
}

/**
 * Exercise block with joined set logs
 */
export interface ExerciseBlockWithSetLogs extends ExerciseBlockRow {
  set_logs: SetLogRow[];
}

/**
 * Full exercise block with all joins (exercises, sessions, set_logs)
 */
export interface ExerciseBlockFull extends ExerciseBlockRow {
  exercises: ExerciseRow | null;
  workout_sessions: WorkoutSessionRow | null;
  set_logs: SetLogRow[];
}

// ============ VOLUME QUERY RESULTS ============

/**
 * Weekly muscle volume as returned from database
 */
export interface WeeklyMuscleVolumeRow {
  id?: string;
  user_id: string;
  week_start: string;
  muscle_group: string;
  total_sets: number;
  effective_sets?: number;
  average_rir?: number;
  average_form_score?: number;
  mesocycle_id?: string;
  status: VolumeStatus;
}

// ============ EXERCISE PERFORMANCE QUERY RESULTS ============

/**
 * Exercise performance snapshot as returned from database
 */
export interface ExercisePerformanceSnapshotRow {
  id: string;
  user_id: string;
  exercise_id: string;
  session_date: string;
  top_set_weight_kg: number;
  top_set_reps: number;
  top_set_rpe: number;
  total_working_sets: number;
  estimated_e1rm: number;
}

// ============ USER QUERY RESULTS ============

/**
 * User as returned from database queries
 */
export interface UserRow {
  id: string;
  email: string;
  created_at: string;
  goal: 'bulk' | 'cut' | 'maintenance';
  experience: 'novice' | 'intermediate' | 'advanced';
  preferences: Record<string, unknown>;
  volume_landmarks: Record<string, unknown>;
  birth_date?: string | null;
  sex?: 'male' | 'female' | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  training_age_years?: number | null;
}

// ============ BODYWEIGHT QUERY RESULTS ============

/**
 * Bodyweight entry as returned from database
 */
export interface BodyweightEntryRow {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  source: 'manual' | 'pre_workout';
}

// ============ MESOCYCLE QUERY RESULTS ============

/**
 * Mesocycle as returned from database
 */
export interface MesocycleRow {
  id: string;
  user_id: string;
  name: string;
  state: 'planned' | 'active' | 'completed';
  total_weeks: number;
  current_week: number;
  deload_week: number;
  days_per_week: number;
  split_type: string;
  fatigue_score: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  is_active?: boolean;
}

// ============ DEXA SCAN QUERY RESULTS ============

/**
 * DEXA scan as returned from database
 */
export interface DexaScanRow {
  id: string;
  user_id: string;
  scan_date: string;
  weight_kg: number;
  lean_mass_kg: number;
  fat_mass_kg: number;
  body_fat_percent: number;
  bone_mass_kg: number | null;
  regional_data: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

// ============ TRAINING PHASE QUERY RESULTS ============

/**
 * Training phase as returned from database
 */
export interface TrainingPhaseRow {
  id: string;
  user_id: string;
  phase_type: 'bulk' | 'cut' | 'maintenance';
  is_active: boolean;
  current_week: number;
  start_weight_kg: number;
  target_weight_kg: number | null;
  started_at: string;
  ended_at: string | null;
}

// ============ CALIBRATED LIFTS QUERY RESULTS ============

/**
 * Calibrated lift as returned from database
 */
export interface CalibratedLiftRow {
  id: string;
  user_id: string;
  lift_name: string;
  estimated_1rm: number;
  tested_weight_kg: number;
  tested_reps: number;
  percentile_vs_trained: number | null;
  strength_level: string | null;
  tested_at: string;
}

// ============ DAILY CHECK-IN QUERY RESULTS ============

/**
 * Daily check-in as returned from database
 */
export interface DailyCheckInRow {
  id: string;
  user_id: string;
  date: string;
  sleep_hours?: number | null;
  sleep_quality?: number | null;
  energy_level?: number | null;
  focus_rating?: number | null;
  libido_rating?: number | null;
  mood_rating?: number | null;
  stress_level?: number | null;
  soreness_level?: number | null;
  hunger_level?: number | null;
  notes?: string | null;
  created_at: string;
}

// ============ CARDIO LOG QUERY RESULTS ============

/**
 * Cardio log as returned from database
 */
export interface CardioLogRow {
  id: string;
  user_id: string;
  logged_at: string;
  activity_type: string;
  minutes: number;
  intensity?: string | null;
  notes?: string | null;
  created_at: string;
}

// ============ HYDRATION LOG QUERY RESULTS ============

/**
 * Hydration log as returned from database
 */
export interface HydrationLogRow {
  id: string;
  user_id: string;
  logged_at: string;
  amount_ml: number;
  created_at: string;
}

// ============ PROGRESS PHOTO QUERY RESULTS ============

/**
 * Progress photo as returned from database
 */
export interface ProgressPhotoRow {
  id: string;
  user_id: string;
  photo_date: string;
  photo_url: string;
  weight_kg: number | null;
  body_fat_percent: number | null;
  notes: string | null;
  created_at: string;
}

// ============ COACHING CONVERSATION QUERY RESULTS ============

/**
 * AI coaching conversation as returned from database
 */
export interface AICoachingConversationRow {
  id: string;
  user_id: string;
  messages: Array<{ role: string; content: string }>;
  created_at: string;
  updated_at: string;
}

// ============ NUTRITION QUERY RESULTS ============

/**
 * Nutrition target as returned from database
 */
export interface NutritionTargetRow {
  id: string;
  user_id: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  meals_per_day: number | null;
  meal_names: Record<string, string> | null;
  cardio_prescription: CardioPrescription | null;
  created_at: string;
  updated_at: string;
}

/**
 * Food log entry as returned from database
 */
export interface FoodLogRow {
  id: string;
  user_id: string;
  logged_at: string;
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  food_name: string;
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  source: string | null;
  food_id: string | null;
  nutritionix_id: string | null;
  created_at: string;
}

// ============ CARDIO PRESCRIPTION ============

/**
 * Cardio prescription structure for nutrition targets
 */
export interface CardioPrescription {
  type?: 'liss' | 'hiit' | 'mixed';
  frequency_per_week?: number;
  duration_minutes?: number;
  notes?: string;
}

// ============ WEIGHT ENTRY QUERY RESULTS ============

/**
 * Weight log entry as returned from database
 */
export interface WeightLogRow {
  id: string;
  user_id: string;
  logged_at: string;
  weight: number;
  unit?: string | null;
  notes: string | null;
  created_at: string;
}

// ============ RECHARTS TYPES ============

/**
 * Recharts tooltip props for custom tooltips
 */
export interface RechartsTooltipProps<T = Record<string, unknown>> {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    dataKey?: string;
    color?: string;
    payload?: T;
    unit?: string;
  }>;
  label?: string | number;
}

// ============ MINIMAL USER TYPE ============

/**
 * Minimal user type for auth fallback scenarios
 */
export interface MinimalUser {
  id: string;
  email?: string;
  experience?: 'novice' | 'intermediate' | 'advanced';
  goal?: 'bulk' | 'cut' | 'maintenance';
}
