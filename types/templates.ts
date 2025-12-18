/**
 * Workout Templates Types
 */

export interface WorkoutFolder {
  id: string;
  user_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WorkoutTemplate {
  id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  notes: string | null;
  last_performed_at: string | null;
  times_performed: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  // Joined data
  exercises?: WorkoutTemplateExercise[];
}

export interface WorkoutTemplateExercise {
  id: string;
  template_id: string;
  exercise_id: string;
  exercise_name: string;
  exercise_type: string | null;
  sort_order: number;
  default_sets: number;
  default_reps: string;
  default_weight: number | null;
  default_rest_seconds: number;
  notes: string | null;
  created_at: string;
}

// For UI grouping
export interface FolderWithTemplates extends WorkoutFolder {
  templates: WorkoutTemplate[];
}

// Form data types
export interface CreateFolderData {
  name: string;
  color?: string;
}

export interface CreateTemplateData {
  name: string;
  folder_id?: string | null;
  notes?: string;
}

export interface AddExerciseToTemplateData {
  exercise_id: string;
  exercise_name: string;
  exercise_type?: string;
  default_sets?: number;
  default_reps?: string;
  default_weight?: number;
  default_rest_seconds?: number;
  notes?: string;
}

