/**
 * Pure helpers for recording workout calories against a day.
 * No database access — `lib/actions/wearable.ts` and
 * `lib/actions/workout-calories.ts` own the I/O.
 */

import { validateWeightEntry } from '@/lib/weightUtils';

const LB_PER_KG = 2.20462;

/** Fallbacks used only when the user has never recorded the value. */
export const DEFAULT_WORKOUT_BODYWEIGHT_KG = 80;
export const DEFAULT_WORKOUT_BODY_FAT_PERCENT = 15;

/**
 * A day's workout expenditure is the sum of its sessions (two-a-days
 * accumulate). Rows are de-duplicated by session id so a session that was
 * somehow written twice is only counted once (the largest value wins).
 */
export function sumSessionExpenditure(
  rows: Array<{ workout_session_id?: string | null; estimated_calories?: number | null }>
): number {
  const bySession = new Map<string, number>();
  let anonymous = 0;
  for (const row of rows) {
    const calories = Math.max(0, Math.round(Number(row.estimated_calories) || 0));
    if (row.workout_session_id) {
      const prev = bySession.get(row.workout_session_id) ?? 0;
      bySession.set(row.workout_session_id, Math.max(prev, calories));
    } else {
      anonymous += calories;
    }
  }
  let total = anonymous;
  bySession.forEach((calories) => {
    total += calories;
  });
  return total;
}

/**
 * The bodyweight (kg) to use for a workout calorie estimate: the most recent
 * weigh-in (unit-validated), then the profile weight, then a default.
 */
export function resolveWorkoutBodyweightKg(input: {
  latestWeighIn?: { weight?: number | null; unit?: string | null } | null;
  profileWeightKg?: number | null;
}): number {
  const weighIn = input.latestWeighIn;
  const raw = Number(weighIn?.weight);
  if (weighIn && Number.isFinite(raw) && raw > 0) {
    const validated = validateWeightEntry(raw, (weighIn.unit ?? null) as 'lb' | 'kg' | null);
    const kg = validated.unit === 'kg' ? validated.weight : validated.weight / LB_PER_KG;
    if (kg >= 20 && kg <= 300) return kg;
  }
  const profile = Number(input.profileWeightKg);
  if (Number.isFinite(profile) && profile >= 20 && profile <= 300) return profile;
  return DEFAULT_WORKOUT_BODYWEIGHT_KG;
}

/** Latest measured body fat %, else the default. */
export function resolveWorkoutBodyFatPercent(measured?: number | null): number {
  const value = Number(measured);
  if (Number.isFinite(value) && value >= 3 && value <= 70) return value;
  return DEFAULT_WORKOUT_BODY_FAT_PERCENT;
}
