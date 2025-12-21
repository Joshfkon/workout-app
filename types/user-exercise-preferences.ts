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
