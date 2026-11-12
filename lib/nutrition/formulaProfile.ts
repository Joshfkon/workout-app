/**
 * Resolves the body stats and activity config that feed the formula
 * (Mifflin-St Jeor) TDEE from the tables that actually hold them.
 *
 * There is no `user_preferences` table. The real sources are:
 *   - `macro_settings` — what the user entered in the macro calculator
 *     (height, age, sex, activity level, workouts/week, duration, intensity)
 *   - `users` — the profile (height_cm, age / birth_date, sex, weight_kg)
 *
 * Pure: rows are passed in; `lib/actions/tdee.ts` owns the queries.
 */

import type { ActivityLevel } from '@/lib/nutrition/macroCalculator';
import { parseLocalDay } from '@/lib/date/localDay';

export interface MacroSettingsProfileRow {
  height_cm?: number | string | null;
  age?: number | string | null;
  sex?: string | null;
  activity_level?: string | null;
  workouts_per_week?: number | null;
  avg_workout_minutes?: number | null;
  workout_intensity?: string | null;
}

export interface UserProfileRow {
  height_cm?: number | string | null;
  age?: number | string | null;
  birth_date?: string | null;
  sex?: string | null;
  weight_kg?: number | string | null;
}

export interface FormulaProfile {
  heightCm: number;
  age: number;
  sex: 'male' | 'female';
  activityLevel: ActivityLevel;
  workoutsPerWeek: number;
  avgWorkoutMinutes: number;
  workoutIntensity: 'light' | 'moderate' | 'intense';
  /** Profile weight in kg, for users with no weigh-in yet. */
  profileWeightKg: number | null;
  /** True when height, age and sex all came from stored data (no defaults). */
  isComplete: boolean;
}

export const FORMULA_PROFILE_DEFAULTS = {
  heightCm: 175,
  age: 30,
  sex: 'male' as const,
  activityLevel: 'moderate' as const,
  workoutsPerWeek: 4,
  avgWorkoutMinutes: 60,
  workoutIntensity: 'moderate' as const,
};

const ACTIVITY_LEVELS: readonly string[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
  'athlete',
];
const INTENSITIES: readonly string[] = ['light', 'moderate', 'intense'];

function positive(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return value != null && Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Whole years between a YYYY-MM-DD birth date and the given local day. */
export function ageFromBirthDate(birthDate: string | null | undefined, today: string): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}/.test(birthDate)) return null;
  const birth = parseLocalDay(birthDate);
  const now = parseLocalDay(today);
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthday =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthday) age -= 1;
  return age >= 10 && age <= 120 ? age : null;
}

export function resolveFormulaProfile(input: {
  macroSettings?: MacroSettingsProfileRow | null;
  userRow?: UserProfileRow | null;
  /** Local day (YYYY-MM-DD), used only to turn a birth date into an age. */
  today: string;
}): FormulaProfile {
  const { macroSettings: ms, userRow: user, today } = input;

  const heightCm = positive(ms?.height_cm, 90, 260) ?? positive(user?.height_cm, 90, 260);
  const age =
    positive(ms?.age, 10, 120) ??
    positive(user?.age, 10, 120) ??
    ageFromBirthDate(user?.birth_date, today);
  const rawSex = ms?.sex ?? user?.sex ?? null;
  const sex = rawSex === 'male' || rawSex === 'female' ? rawSex : null;

  const activityLevel =
    ms?.activity_level && ACTIVITY_LEVELS.includes(ms.activity_level)
      ? (ms.activity_level as ActivityLevel)
      : FORMULA_PROFILE_DEFAULTS.activityLevel;
  const workoutIntensity =
    ms?.workout_intensity && INTENSITIES.includes(ms.workout_intensity)
      ? (ms.workout_intensity as 'light' | 'moderate' | 'intense')
      : FORMULA_PROFILE_DEFAULTS.workoutIntensity;

  return {
    heightCm: heightCm ?? FORMULA_PROFILE_DEFAULTS.heightCm,
    age: age ?? FORMULA_PROFILE_DEFAULTS.age,
    sex: sex ?? FORMULA_PROFILE_DEFAULTS.sex,
    activityLevel,
    workoutsPerWeek: ms?.workouts_per_week || FORMULA_PROFILE_DEFAULTS.workoutsPerWeek,
    avgWorkoutMinutes: ms?.avg_workout_minutes || FORMULA_PROFILE_DEFAULTS.avgWorkoutMinutes,
    workoutIntensity,
    profileWeightKg: positive(user?.weight_kg, 20, 300),
    isComplete: heightCm != null && age != null && sex != null,
  };
}

/** The app-wide unit preference lives in `users.preferences.units` (default lb). */
export function unitsFromUserPreferences(preferences: unknown): 'lb' | 'kg' {
  const units =
    preferences && typeof preferences === 'object'
      ? (preferences as { units?: unknown }).units
      : null;
  return units === 'kg' ? 'kg' : 'lb';
}
