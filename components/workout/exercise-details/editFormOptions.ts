/** Static option lists for the exercise metadata edit form. */

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

export const MUSCLE_OPTIONS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
] as const;

/** Broader muscle list for secondary muscle selection (includes traps/forearms). */
export const SECONDARY_MUSCLE_OPTIONS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
  'traps', 'forearms',
] as const;

export const EQUIPMENT_OPTIONS = [
  'barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'other',
] as const;
