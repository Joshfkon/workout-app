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
  mechanic: 'compound' | 'isolation';
  equipment_required?: string[];
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

export interface ExerciseHistoryData {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
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
