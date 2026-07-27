/** Static option lists for the exercise metadata edit form. */

import { STANDARD_MUSCLE_DISPLAY_NAMES, type StandardMuscleGroup } from '@/types/schema';

export const MOVEMENT_PATTERN_OPTIONS = [
  ['horizontal_push', 'Horizontal Push'],
  ['horizontal_pull', 'Horizontal Pull'],
  ['vertical_push', 'Vertical Push'],
  ['vertical_pull', 'Vertical Pull'],
  ['hip_hinge', 'Hip Hinge'],
  ['squat', 'Squat'],
  ['lunge', 'Lunge'],
  ['knee_flexion', 'Knee Flexion'],
  ['elbow_flexion', 'Elbow Flexion'],
  ['elbow_extension', 'Elbow Extension'],
  ['shoulder_isolation', 'Shoulder Isolation'],
  ['calf_raise', 'Calf Raise'],
  ['core', 'Core'],
  ['isolation', 'Isolation'],
  ['carry', 'Carry'],
  ['compound', 'Compound'],
] as const;

export interface SubMuscleOption {
  /** Standard-taxonomy token stored on the exercise (e.g. 'lateral_delts'). */
  value: StandardMuscleGroup;
  label: string;
}

export interface MuscleGroupOption {
  /**
   * Token stored when the whole (coarse) group is selected — the legacy coarse
   * name the volume/recovery resolver splits across the group's sub-muscles.
   */
  value: string;
  label: string;
  /**
   * Anatomical sub-muscle heads. Selecting one stores its fine standard token
   * so volume credit lands on that specific head (Side/Front/Rear Delts, etc.).
   * Empty for groups with no meaningful subdivision (biceps, quads, …).
   */
  subMuscles: SubMuscleOption[];
}

const sub = (value: StandardMuscleGroup): SubMuscleOption => ({
  value,
  label: STANDARD_MUSCLE_DISPLAY_NAMES[value],
});

/**
 * The muscle taxonomy the edit form offers: a coarse group plus the fine
 * sub-muscle heads underneath it. Mirrors COARSE_CHILDREN in weeklyVolume.ts so
 * the tokens chosen here resolve cleanly through resolveMuscleToStandard /
 * resolvePrimaryMuscleCredits and show up on the correct recovery/volume rows.
 */
export const MUSCLE_GROUP_OPTIONS: MuscleGroupOption[] = [
  { value: 'chest', label: 'Chest', subMuscles: [sub('chest_upper'), sub('chest_lower')] },
  { value: 'back', label: 'Back', subMuscles: [sub('lats'), sub('upper_back'), sub('erectors')] },
  { value: 'shoulders', label: 'Shoulders', subMuscles: [sub('front_delts'), sub('lateral_delts'), sub('rear_delts')] },
  { value: 'biceps', label: 'Biceps', subMuscles: [] },
  { value: 'triceps', label: 'Triceps', subMuscles: [sub('triceps_long'), sub('triceps_lat_med')] },
  { value: 'forearms', label: 'Forearms', subMuscles: [] },
  { value: 'traps', label: 'Traps', subMuscles: [sub('upper_traps'), sub('mid_lower_traps')] },
  { value: 'quads', label: 'Quads', subMuscles: [] },
  { value: 'hamstrings', label: 'Hamstrings', subMuscles: [] },
  { value: 'glutes', label: 'Glutes', subMuscles: [sub('glute_med')] },
  { value: 'adductors', label: 'Adductors', subMuscles: [] },
  { value: 'calves', label: 'Calves', subMuscles: [sub('gastrocnemius'), sub('soleus')] },
  { value: 'abs', label: 'Abs', subMuscles: [sub('obliques')] },
];

/** All valid muscle tokens (coarse + fine) that the selectors can produce. */
export const ALL_MUSCLE_TOKENS: string[] = MUSCLE_GROUP_OPTIONS.flatMap((g) => [
  g.value,
  ...g.subMuscles.map((s) => s.value),
]);

export const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other',
] as const;
