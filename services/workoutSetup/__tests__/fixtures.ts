/** Shared fixtures for the workout-setup engine tests (not a test file). */

import type { CoarseMuscle } from '@/services/volumeBands';
import type { SetupExercise, SetupGroupState, SetupReadinessStatus } from '../types';

function ex(
  id: string,
  name: string,
  primaryMuscle: string,
  opts: Partial<SetupExercise> = {}
): SetupExercise {
  return {
    id,
    name,
    primaryMuscle,
    secondaryMuscles: [],
    mechanic: 'isolation',
    movementPattern: null,
    equipment: ['dumbbells'],
    equipmentClass: null,
    isBodyweight: false,
    tier: 'B',
    defaultRepRange: null,
    defaultRir: 2,
    stabilizers: [],
    ...opts,
  };
}

export const CATALOG: SetupExercise[] = [
  ex('bench', 'Barbell Bench Press', 'chest', { secondaryMuscles: ['triceps', 'front_delts'], mechanic: 'compound', movementPattern: 'horizontal_push', equipment: ['barbell', 'flat_bench'], tier: 'S', stabilizers: ['rotator_cuff'] }),
  ex('incline', 'Incline Dumbbell Press', 'chest_upper', { secondaryMuscles: ['front_delts', 'triceps'], mechanic: 'compound', movementPattern: 'incline_push', equipment: ['dumbbells', 'incline_bench'], tier: 'A' }),
  ex('fly', 'Cable Fly', 'chest', { movementPattern: 'fly', equipment: ['cable_machine'], tier: 'A' }),
  ex('row', 'Barbell Row', 'back', { secondaryMuscles: ['biceps', 'rear_delts'], mechanic: 'compound', movementPattern: 'horizontal_pull', equipment: ['barbell'], tier: 'A', stabilizers: ['erectors', 'forearms'] }),
  ex('pulldown', 'Lat Pulldown', 'lats', { secondaryMuscles: ['biceps'], mechanic: 'compound', movementPattern: 'vertical_pull', equipment: ['lat_pulldown'], tier: 'S', stabilizers: ['forearms'] }),
  ex('csrow', 'Chest Supported Row', 'upper_back', { secondaryMuscles: ['biceps', 'rear_delts'], mechanic: 'compound', movementPattern: 'horizontal_pull', equipment: ['dumbbells', 'incline_bench'], tier: 'A' }),
  ex('deadlift', 'Deadlift', 'hamstrings', { secondaryMuscles: ['glutes', 'erectors'], mechanic: 'compound', movementPattern: 'hip_hinge', equipment: ['barbell'], tier: 'B', stabilizers: ['erectors', 'forearms'] }),
  ex('legcurl', 'Seated Leg Curl', 'hamstrings', { movementPattern: 'knee_flexion', equipment: ['leg_curl'], tier: 'S' }),
  ex('squat', 'Barbell Back Squat', 'quads', { secondaryMuscles: ['glutes'], mechanic: 'compound', movementPattern: 'squat', equipment: ['barbell', 'squat_rack'], tier: 'A', stabilizers: ['erectors'] }),
  ex('legpress', 'Leg Press', 'quads', { secondaryMuscles: ['glutes'], mechanic: 'compound', movementPattern: 'squat', equipment: ['leg_press'], tier: 'A' }),
  ex('legext', 'Leg Extension', 'quads', { movementPattern: 'knee_extension', equipment: ['leg_extension'], tier: 'A' }),
  ex('ohp', 'Overhead Press', 'front_delts', { secondaryMuscles: ['triceps', 'lateral_delts'], mechanic: 'compound', movementPattern: 'vertical_push', equipment: ['barbell'], tier: 'B' }),
  ex('lateral', 'Dumbbell Lateral Raise', 'lateral_delts', { movementPattern: 'shoulder_abduction', tier: 'A' }),
  ex('reardelt', 'Rear Delt Fly', 'rear_delts', { movementPattern: 'reverse_fly', tier: 'A' }),
  ex('curl', 'Dumbbell Curl', 'biceps', { secondaryMuscles: ['forearms'], movementPattern: 'elbow_flexion', tier: 'B' }),
  ex('pushdown', 'Triceps Pushdown', 'triceps', { movementPattern: 'elbow_extension', equipment: ['cable_machine'], tier: 'B' }),
  ex('calf', 'Standing Calf Raise', 'calves', { movementPattern: 'plantar_flexion', tier: 'B' }),
  ex('thrust', 'Barbell Hip Thrust', 'glutes', { mechanic: 'compound', movementPattern: 'hip_extension', equipment: ['barbell', 'flat_bench'], tier: 'S' }),
  ex('wristcurl', 'Wrist Curl', 'forearms', { movementPattern: 'wrist_flexion', tier: 'C' }),
];

export const BY_ID = new Map(CATALOG.map((e) => [e.id, e]));

const BANDS: Record<string, [number, number]> = {
  chest: [8, 22], back: [10, 25], shoulders: [12, 26], biceps: [10, 26], triceps: [8, 24],
  quads: [8, 20], hamstrings: [8, 20], glutes: [6, 24], calves: [8, 20], abs: [6, 20],
  traps: [6, 20], forearms: [4, 14], adductors: [4, 12], erectors: [4, 12],
};

export function group(
  g: CoarseMuscle,
  weeklyCredited = 0,
  status: SetupReadinessStatus = 'fresh',
  focusMuscles: SetupGroupState['focusMuscles'] = []
): SetupGroupState {
  const [zoneMin, zoneMax] = BANDS[g];
  return {
    group: g,
    displayName: g.charAt(0).toUpperCase() + g.slice(1),
    status,
    weeklyCredited,
    zoneMin,
    zoneMax,
    focusMuscles,
  };
}

export const ALL_GROUPS: SetupGroupState[] = (Object.keys(BANDS) as CoarseMuscle[]).map((g) =>
  group(g)
);
