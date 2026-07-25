import type { Exercise, ExerciseBlock, DexaRegionalData } from '@/types/schema';

export type WorkoutPhase = 'loading' | 'checkin' | 'workout' | 'summary' | 'error';

export interface ExerciseBlockWithExercise extends ExerciseBlock {
  exercise: Exercise;
  /** exercise_blocks.created_at — when the block's targets were computed (P1-3 stale detection). */
  createdAt?: string;
}

export interface AvailableExercise {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles?: string[];
  movement_pattern?: string;
  mechanic: 'compound' | 'isolation';
  equipment_required?: string[];
  /**
   * Normalized equipment class (exercises.equipment_class). May be null on
   * older rows; the picker derives it on read via services/equipmentClass.ts.
   */
  equipment_class?: string | null;
  default_rep_range?: [number, number];
  default_rir?: number;
  is_bodyweight?: boolean;
  hypertrophy_tier?: string | null;
}

export interface GymLocation {
  id: string;
  name: string;
  is_default: boolean;
}

export interface CalibratedLift {
  lift_name: string;
  estimated_1rm: number;
  tested_at: string;
}

export interface UserProfileForWeights {
  weightKg: number;
  heightCm: number;
  bodyFatPercent: number;
  experience: 'novice' | 'intermediate' | 'advanced';
  regionalData?: DexaRegionalData;
  calibratedLifts?: CalibratedLift[];
}

export interface UserContext {
  goal?: 'bulk' | 'cut' | 'recomp' | 'maintain';
  laggingAreas?: string[];  // From regional DEXA analysis
  recentPlateaus?: string[];  // Exercise names with recent plateaus
  weekInMesocycle?: number;
  mesocycleName?: string;
}

/**
 * Bodyweight composition of a logged set, when recorded. `weightKg` on the
 * set stays the EFFECTIVE load (BW ± modification) — the engine's number;
 * this is how displays break it out as "BW+25" instead of the blended value.
 */
export interface HistorySetBodyweight {
  modification: 'none' | 'weighted' | 'assisted';
  addedWeightKg?: number;
  assistanceWeightKg?: number;
}

export interface ExerciseHistoryData {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number; bw?: HistorySetBodyweight }[];
  /**
   * Working sets from the session BEFORE last (same shape/filtering as
   * lastWorkoutSets). Feeds the regression path (Fix 4): two consecutive
   * below-floor sessions confirm a load decrement. [] when there is only one
   * session of history; undefined on legacy shapes.
   */
  priorWorkoutSets?: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
  /**
   * Estimability of the recent NORMAL working sets under the canonical e1RM
   * estimator (ADD 2): sets with a valid estimate vs sets beyond the
   * 15-effective-rep domain. Drives rep_total auto-classification
   * (services/suggestionEngine/repTotalPolicy.resolveProgressionModel) for
   * exercises without an explicit progression_model.
   */
  estimableSetCount?: number;
  inestimableSetCount?: number;
  /**
   * Location-scoped calibration (services/progressionScope). `global` exercises
   * read full cross-location history; `local` exercises read history filtered to
   * the current location. Undefined when history wasn't location-scoped.
   */
  progressionScope?: 'global' | 'local';
  /**
   * True when a local-scope exercise had no history at the current location and
   * this data was seeded (softened) from another location — a starting point.
   */
  estimatedFromOtherLocation?: boolean;
  /** Rationale shown to the user when estimatedFromOtherLocation. */
  calibrationNote?: string;
}
