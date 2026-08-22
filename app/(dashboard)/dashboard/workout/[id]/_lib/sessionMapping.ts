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
import { resolveIsBodyweight } from '@/services/bodyweightClassification';

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
  available_increments_kg?: number[] | null;
  progression_model?: 'e1rm' | 'rep_total' | null;
  rep_boundary?: 'crisp' | 'drifting' | null;
  form_cues: string[] | null;
  common_mistakes: string[] | null;
  setup_note: string | null;
  movement_pattern: string | null;
  rom_demands: string[] | null;
  equipment_required: string[] | null;
  equipment: string | null;
  /** Hand-correctable normalized implement; wins over tag/name derivation. */
  equipment_class?: string | null;
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
  pump?: number | null;
  workload?: number | null;
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
 * Map a raw `exercises` row into the page's exercise shape.
 *
 * EVERY path that puts an exercise into the page's block state must go through
 * this — the session load, and equally the mid-workout add and swap flows,
 * which fetch the same `exercises` row. Hand-rolling a smaller object at those
 * call sites drops `is_bodyweight` / `bodyweight_type` / `equipment`, and the
 * card then has to guess "is this bodyweight?" from the equipment tags alone:
 * a pull-up added mid-workout rendered a plain weight stepper with no
 * Bodyweight/Weighted/Assisted control until the page was reloaded and this
 * mapping finally ran.
 */
export function mapLoadedExerciseRow(row: LoadedExerciseRow): LoadedExercise {
  return {
    id: row.id,
    name: row.name,
    primaryMuscle: row.primary_muscle,
    secondaryMuscles: row.secondary_muscles || [],
    mechanic: row.mechanic,
    defaultRepRange: row.default_rep_range || [8, 12],
    defaultRir: row.default_rir || 2,
    minWeightIncrementKg: row.min_weight_increment_kg || 2.5,
    availableIncrementsKg: row.available_increments_kg ?? null,
    progressionModel: row.progression_model ?? null,
    repBoundary: row.rep_boundary ?? 'crisp',
    formCues: row.form_cues || [],
    commonMistakes: row.common_mistakes || [],
    setupNote: row.setup_note || '',
    movementPattern: row.movement_pattern || '',
    romDemands: row.rom_demands || [],
    equipmentRequired: row.equipment_required || [],
    equipment: row.equipment || (row.equipment_required?.[0] || 'barbell'),
    // Include hypertrophy scoring for tier badges
    hypertrophyScore: row.hypertrophy_tier ? {
      tier: row.hypertrophy_tier,
      stretchUnderLoad: row.stretch_under_load || 3,
      resistanceProfile: row.resistance_profile || 3,
      progressionEase: row.progression_ease || 3,
    } : undefined,
    // Bodyweight exercise metadata. `is_bodyweight` is a positive signal only:
    // the column is NOT NULL DEFAULT false, so the old `??` fallback to the
    // equipment fields never fired and station movements (dead hang, pull-up,
    // dip) whose flag was never set read as externally loaded. The shared
    // classifier falls through to the equipment signals — see
    // services/bodyweightClassification#resolveIsBodyweight. The stored
    // equipment_class is the hand-correctable override and wins over the
    // signals derived from tags and name.
    isBodyweight: resolveIsBodyweight({
      isBodyweight: row.is_bodyweight,
      equipment: row.equipment,
      equipmentRequired: row.equipment_required,
      equipment_class: row.equipment_class,
      name: row.name,
      exerciseType: row.exercise_type,
    }),
    bodyweightType: row.bodyweight_type ?? undefined,
    assistanceType: row.assistance_type ?? undefined,
    // Video demonstration fields
    demoGifUrl: row.demo_gif_url ?? undefined,
    demoThumbnailUrl: row.demo_thumbnail_url ?? undefined,
    youtubeVideoId: row.youtube_video_id ?? undefined,
    // Exercise type for duration-based exercises (planks, holds)
    exerciseType: row.exercise_type ?? undefined,
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
  const exercise: LoadedExercise = mapLoadedExerciseRow(block.exercises);

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
    pump: (block.pump ?? null) as ExerciseBlockWithExercise['pump'],
    workload: (block.workload ?? null) as ExerciseBlockWithExercise['workload'],
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
