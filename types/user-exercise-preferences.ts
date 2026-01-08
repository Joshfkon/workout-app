/**
 * User Exercise Preferences
 *
 * Controls which exercises appear in suggestions and which are hidden from the exercise library.
 *
 * Behavior by status:
 * - 'active': Normal behavior, shown everywhere, suggested freely
 * - 'do_not_suggest': Shown in exercise list, can be manually added, never auto-suggested
 * - 'archived': Hidden from list, only appears in search, never suggested
 */

/** Exercise visibility status */
export type ExerciseVisibilityStatus = 'active' | 'do_not_suggest' | 'archived';

/** Predefined reasons for hiding/archiving an exercise */
export type ExerciseHideReason =
  | 'no_equipment'      // "My gym doesn't have this equipment"
  | 'causes_pain'       // "Causes pain/discomfort"
  | 'dislike'           // "Just don't like this exercise"
  | 'other';            // Custom reason

/** User preference for a specific exercise */
export interface UserExercisePreference {
  id: string;
  userId: string;
  exerciseId: string;
  status: ExerciseVisibilityStatus;
  reason?: ExerciseHideReason;
  reasonNote?: string;  // Custom note if reason is 'other'
  createdAt: Date;
  updatedAt: Date;
}

/** Database row representation */
export interface UserExercisePreferenceRow {
  id: string;
  user_id: string;
  exercise_id: string;
  status: ExerciseVisibilityStatus;
  reason?: ExerciseHideReason | null;
  reason_note?: string | null;
  created_at: string;
  updated_at: string;
}

/** Options for fetching exercises with preference filtering */
export interface GetExercisesWithPrefsOptions {
  /** Include archived exercises (default: false) */
  includeArchived?: boolean;
  /** Include do_not_suggest exercises (default: true - they're still visible) */
  includeDoNotSuggest?: boolean;
  /** If true, excludes both archived AND do_not_suggest (for program generation) */
  forSuggestion?: boolean;
  /** If provided, include archived results in search */
  searchQuery?: string;
  /** Include custom exercises (default: true) */
  includeCustom?: boolean;
}

/** Exercise with its preference status attached */
export interface ExerciseWithPreference {
  id: string;
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  mechanic: 'compound' | 'isolation';
  equipment: string;
  hypertrophyTier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
  // Preference fields
  status: ExerciseVisibilityStatus;
  reason?: ExerciseHideReason;
  reasonNote?: string;
}

/** Summary counts for settings display */
export interface ExercisePreferenceSummary {
  activeCount: number;
  doNotSuggestCount: number;
  archivedCount: number;
}

/** Input for setting exercise status */
export interface SetExerciseStatusInput {
  exerciseId: string;
  status: ExerciseVisibilityStatus;
  reason?: ExerciseHideReason;
  reasonNote?: string;
}

/** Equipment-based bulk archive input */
export interface BulkArchiveByEquipmentInput {
  /** Equipment types that the user HAS - exercises requiring other equipment will be archived */
  availableEquipment: string[];
  /** Optional reason for the archive */
  reason?: ExerciseHideReason;
}

// ============================================
// EXERCISE VARIETY PREFERENCES
// ============================================

/** Variety level - how much exercise rotation the user wants */
export type ExerciseVarietyLevel = 'low' | 'medium' | 'high';

/** User's exercise variety preferences */
export interface ExerciseVarietyPreferences {
  id: string;
  userId: string;
  /** How much variety: low = 2-3 exercises, medium = 5-6, high = 8-10+ */
  varietyLevel: ExerciseVarietyLevel;
  /** Sessions to wait before repeating an exercise for same muscle (0 = no limit) */
  rotationFrequency: number;
  /** Minimum exercises to rotate between per muscle group */
  minPoolSize: number;
  /** Whether to still prioritize S/A tier within the variety pool */
  prioritizeTopTier: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Database row representation for variety preferences */
export interface ExerciseVarietyPreferencesRow {
  id: string;
  user_id: string;
  variety_level: ExerciseVarietyLevel;
  rotation_frequency: number;
  min_pool_size: number;
  prioritize_top_tier: boolean;
  created_at: string;
  updated_at: string;
}

/** Exercise usage history record */
export interface ExerciseUsageRecord {
  id: string;
  userId: string;
  exerciseId: string;
  muscleGroup: string;
  usedAt: Date;
  sessionId?: string;
}

/** Database row representation for exercise usage */
export interface ExerciseUsageRow {
  id: string;
  user_id: string;
  exercise_id: string;
  muscle_group: string;
  used_at: string;
  session_id?: string | null;
}

/** Default variety preferences by level */
export const VARIETY_LEVEL_DEFAULTS: Record<ExerciseVarietyLevel, {
  rotationFrequency: number;
  minPoolSize: number;
  description: string;
}> = {
  low: {
    rotationFrequency: 0,
    minPoolSize: 3,
    description: 'Stick to your top 2-3 exercises per muscle. Consistent and familiar.',
  },
  medium: {
    rotationFrequency: 2,
    minPoolSize: 5,
    description: 'Rotate through 5-6 exercises. Good balance of variety and consistency.',
  },
  high: {
    rotationFrequency: 3,
    minPoolSize: 8,
    description: 'Maximum variety with 8-10+ exercises. Each session feels fresh.',
  },
};

/** Input for updating variety preferences */
export interface UpdateVarietyPreferencesInput {
  varietyLevel?: ExerciseVarietyLevel;
  rotationFrequency?: number;
  minPoolSize?: number;
  prioritizeTopTier?: boolean;
}
