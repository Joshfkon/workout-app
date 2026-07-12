/**
 * sessionMapping.ts
 *
 * Pure row → domain-object mapping for the workout page's session load.
 * Extracted verbatim from the `loadWorkout` effect in `page.tsx`
 * (Phase 0.2 decomposition). No DB calls here — callers pass raw rows.
 *
 * NOTE: mid-workout swap/add flows in the page intentionally build *smaller*
 * Exercise objects (no bodyweight/video fields); those mappings stay inline
 * in the page because they genuinely differ from this full load mapping.
 */

import type {
  Exercise,
  ExerciseType,
  HypertrophyRating,
  HypertrophyTier,
  PreWorkoutCheckIn,
  ProgressionType,
  SessionState,
  SetFeedback,
  SetLog,
  SetQuality,
  SetType,
  BodyweightData,
  WarmupSet,
  WorkoutSession,
} from '@/types/schema';
import type { ExerciseBlockWithExercise } from './types';

/**
 * Exercise plus the extra runtime fields the workout page has always attached
 * (read downstream via `exercise as any`, e.g. in ExerciseCard's bodyweight
 * handling). Kept as an extension instead of widening the schema type —
 * this is a pure refactor.
 */
export interface LoadedExercise extends Exercise {
  equipment?: string;
  isBodyweight?: boolean;
  bodyweightType?: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both';
  assistanceType?: 'machine' | 'band' | 'partner';
}

/** Raw workout_sessions row (fields used by the page). */
export interface WorkoutSessionRow {
  id: string;
  user_id: string;
  mesocycle_id: string | null;
  state: SessionState;
  planned_date: string;
  started_at: string | null;
  completed_at: string | null;
  duration_seconds: number | null;
  pre_workout_check_in: PreWorkoutCheckIn | null;
  session_rpe: number | null;
  pump_rating: number | null;
  session_notes: string | null;
  completion_percent: number;
  is_deload?: boolean | null;
}

/** Raw exercises row as joined in the exercise_blocks query. */
export interface LoadedExerciseRow {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[] | null;
  mechanic: 'compound' | 'isolation';
  default_rep_range: [number, number] | null;
  default_rir: number | null;
  min_weight_increment_kg: number | null;
  form_cues: string[] | null;
  common_mistakes: string[] | null;
  setup_note: string | null;
  movement_pattern: string | null;
  equipment_required: string[] | null;
  equipment: string | null;
  hypertrophy_tier: HypertrophyTier | null;
  stretch_under_load: HypertrophyRating | null;
  resistance_profile: HypertrophyRating | null;
  progression_ease: HypertrophyRating | null;
  is_bodyweight: boolean | null;
  bodyweight_type: 'pure' | 'weighted_possible' | 'assisted_possible' | 'both' | null;
  assistance_type: 'machine' | 'band' | 'partner' | null;
  demo_gif_url: string | null;
  demo_thumbnail_url: string | null;
  youtube_video_id: string | null;
  exercise_type: ExerciseType | null;
}

/** Raw exercise_blocks row (with joined exercises) from the session load. */
export interface LoadedBlockRow {
  id: string;
  workout_session_id: string;
  exercise_id: string;
  order: number;
  superset_group_id: string | null;
  superset_order: number | null;
  target_sets: number;
  target_rep_range: [number, number];
  target_rir: number;
  target_weight_kg: number;
  target_rest_seconds: number;
  progression_type: ProgressionType | null;
  suggestion_reason: string;
  warmup_protocol: { sets?: WarmupSet[] } | null;
  note: string | null;
  dropsets_per_set: number | null;
  drop_percentage: number | null;
  created_at?: string | null;
  exercises: LoadedExerciseRow | null;
}

/** Raw set_logs row from the session load. */
export interface SetLogRow {
  id: string;
  exercise_block_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number;
  rest_seconds: number | null;
  is_warmup: boolean;
  set_type: SetType | null;
  set_role?: 'working' | 'ramp' | null;
  suggestion_engine_version?: number | null;
  parent_set_id: string | null;
  quality: SetQuality;
  quality_reason: string | null;
  note: string | null;
  logged_at: string;
  feedback: string | SetFeedback | null;
  bodyweight_data: string | BodyweightData | null;
}

export function mapWorkoutSessionRow(sessionData: WorkoutSessionRow): WorkoutSession {
  return {
    id: sessionData.id,
    userId: sessionData.user_id,
    mesocycleId: sessionData.mesocycle_id,
    state: sessionData.state,
    plannedDate: sessionData.planned_date,
    startedAt: sessionData.started_at,
    completedAt: sessionData.completed_at,
    durationSeconds: sessionData.duration_seconds,
    preWorkoutCheckIn: sessionData.pre_workout_check_in,
    sessionRpe: sessionData.session_rpe,
    pumpRating: sessionData.pump_rating,
    sessionNotes: sessionData.session_notes,
    completionPercent: sessionData.completion_percent,
    isDeload: sessionData.is_deload ?? false,
  };
}

/**
 * Map a loaded exercise_blocks row (with joined exercises) into the page's
 * block-with-exercise shape. Caller must have filtered out rows without
 * a joined exercise.
 */
export function mapLoadedBlockRow(
  block: LoadedBlockRow & { exercises: LoadedExerciseRow }
): ExerciseBlockWithExercise {
  const exercise: LoadedExercise = {
    id: block.exercises.id,
    name: block.exercises.name,
    primaryMuscle: block.exercises.primary_muscle,
    secondaryMuscles: block.exercises.secondary_muscles || [],
    mechanic: block.exercises.mechanic,
    defaultRepRange: block.exercises.default_rep_range || [8, 12],
    defaultRir: block.exercises.default_rir || 2,
    minWeightIncrementKg: block.exercises.min_weight_increment_kg || 2.5,
    formCues: block.exercises.form_cues || [],
    commonMistakes: block.exercises.common_mistakes || [],
    setupNote: block.exercises.setup_note || '',
    movementPattern: block.exercises.movement_pattern || '',
    equipmentRequired: block.exercises.equipment_required || [],
    equipment: block.exercises.equipment || (block.exercises.equipment_required?.[0] || 'barbell'),
    // Include hypertrophy scoring for tier badges
    hypertrophyScore: block.exercises.hypertrophy_tier ? {
      tier: block.exercises.hypertrophy_tier,
      stretchUnderLoad: block.exercises.stretch_under_load || 3,
      resistanceProfile: block.exercises.resistance_profile || 3,
      progressionEase: block.exercises.progression_ease || 3,
    } : undefined,
    // Bodyweight exercise metadata
    // Check is_bodyweight column first, then fall back to equipment field, then equipment_required array
    isBodyweight: block.exercises.is_bodyweight ??
                 (block.exercises.equipment === 'bodyweight' ||
                  Boolean(block.exercises.equipment_required && block.exercises.equipment_required.includes('bodyweight'))),
    bodyweightType: block.exercises.bodyweight_type ?? undefined,
    assistanceType: block.exercises.assistance_type ?? undefined,
    // Video demonstration fields
    demoGifUrl: block.exercises.demo_gif_url ?? undefined,
    demoThumbnailUrl: block.exercises.demo_thumbnail_url ?? undefined,
    youtubeVideoId: block.exercises.youtube_video_id ?? undefined,
    // Exercise type for duration-based exercises (planks, holds)
    exerciseType: block.exercises.exercise_type ?? undefined,
  };

  return {
    id: block.id,
    workoutSessionId: block.workout_session_id,
    exerciseId: block.exercise_id,
    order: block.order,
    supersetGroupId: block.superset_group_id,
    supersetOrder: block.superset_order,
    targetSets: block.target_sets,
    targetRepRange: block.target_rep_range,
    targetRir: block.target_rir,
    targetWeightKg: block.target_weight_kg,
    targetRestSeconds: block.target_rest_seconds,
    progressionType: block.progression_type,
    suggestionReason: block.suggestion_reason,
    warmupProtocol: block.warmup_protocol?.sets || [],
    note: block.note,
    dropsetsPerSet: block.dropsets_per_set ?? 0,
    dropPercentage: block.drop_percentage ?? 0.25,
    // When the block's targets were computed — P1-3 stale-target detection
    // compares this against set_logs.edited_at.
    createdAt: block.created_at ?? undefined,
    exercise,
  };
}

export function mapSetLogRow(set: SetLogRow): SetLog {
  // Parse JSON fields
  let feedback: SetFeedback | undefined;
  if (set.feedback) {
    try {
      feedback = typeof set.feedback === 'string' ? JSON.parse(set.feedback) : set.feedback;
    } catch (e) {
      console.error('Failed to parse feedback JSON:', e);
    }
  }

  let bodyweightData: BodyweightData | undefined;
  if (set.bodyweight_data) {
    try {
      bodyweightData = typeof set.bodyweight_data === 'string'
        ? JSON.parse(set.bodyweight_data)
        : set.bodyweight_data;
    } catch (e) {
      console.error('Failed to parse bodyweight_data JSON:', e);
    }
  }

  return {
    id: set.id,
    exerciseBlockId: set.exercise_block_id,
    setNumber: set.set_number,
    weightKg: set.weight_kg,
    reps: set.reps,
    rpe: set.rpe,
    restSeconds: set.rest_seconds,
    isWarmup: set.is_warmup,
    setType: set.set_type || (set.is_warmup ? 'warmup' : 'normal'),
    setRole: set.set_role ?? undefined,
    suggestionEngineVersion: set.suggestion_engine_version ?? undefined,
    parentSetId: set.parent_set_id || null,
    quality: set.quality,
    qualityReason: set.quality_reason || '',
    note: set.note,
    loggedAt: set.logged_at,
    feedback,
    bodyweightData,
  };
}
