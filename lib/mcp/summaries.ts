/**
 * Pure shaping helpers for the Claude connector (MCP) at /mcp.
 *
 * Everything here turns rows into the plain text the tools return. No
 * database access and no clock reads: callers pass rows and dates in, so
 * these are unit-testable and deterministic.
 */

import { rpeToRir } from '@/types/schema';
import { e1rmValueFromRpe } from '@/services/shared/e1rm';
import { getSetDuration, getSetReps, type ModalitySource } from '@/services/shared/setModality';

export type Units = 'kg' | 'lb';

export interface SetRow {
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number | null;
  is_warmup: boolean;
  set_type?: string | null;
  logged_at?: string | null;
}

const LB_PER_KG = 2.20462;

/** The modality accessors' exercise shape, from the boolean the tools carry. */
const modality = (isDuration: boolean): ModalitySource => ({
  exerciseType: isDuration ? 'duration_based' : 'rep_based',
});

/** A weigh-in row's value in kg (`weight_log.weight` is in the row's own unit). */
export function weightLogToKg(weight: number, unit: string | null | undefined): number {
  return unit === 'kg' ? weight : weight / LB_PER_KG;
}

/**
 * A logged load for display: the exact value in the user's unit to one
 * decimal ("185 lb", "82.5 kg"). The app's formatWeight rounds to 2.5
 * increments for suggestions; logged sets must be reported as entered.
 */
export function formatLoad(weightKg: number, units: Units): string {
  const value = units === 'lb' ? weightKg * LB_PER_KG : weightKg;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${units}`;
}

/** Body weight for display: one decimal, never rounded to plate increments. */
export function formatBodyWeight(weightKg: number, units: Units): string {
  const value = units === 'lb' ? weightKg * LB_PER_KG : weightKg;
  return `${value.toFixed(1)} ${units}`;
}

/** Working (non-warmup) sets in logged order. */
export function workingSets(sets: SetRow[]): SetRow[] {
  return sets
    .filter((s) => !s.is_warmup && s.set_type !== 'warmup')
    .sort((a, b) => a.set_number - b.set_number);
}

/**
 * One set as text. Duration exercises store SECONDS in `reps`, so they are
 * printed as a hold time and never as a rep count.
 */
export function describeSet(set: SetRow, units: Units, isDuration: boolean): string {
  const effort = set.rpe != null && set.rpe > 0 ? ` @ RIR ${rpeToRir(set.rpe)}` : '';
  const tag = set.set_type && set.set_type !== 'normal' ? ` (${set.set_type.replace('_', ' ')})` : '';
  const seconds = getSetDuration(set, modality(isDuration));
  if (seconds !== null) {
    const load = set.weight_kg > 0 ? `${formatLoad(set.weight_kg, units)} × ` : '';
    return `${load}${seconds}s${tag}`;
  }
  return `${formatLoad(set.weight_kg, units)} × ${getSetReps(set, modality(isDuration))}${effort}${tag}`;
}

/** Warm-up sets of one block as "load × reps" (or a hold time), in order. */
export function describeWarmups(sets: SetRow[], units: Units, isDuration: boolean): string | null {
  const warmups = sets
    .filter((s) => s.is_warmup || s.set_type === 'warmup')
    .sort((a, b) => a.set_number - b.set_number);
  if (warmups.length === 0) return null;
  // Effort and set-type tags are noise on warm-ups: strip them.
  return warmups
    .map((s) => describeSet({ ...s, rpe: null, set_type: 'normal' }, units, isDuration))
    .join(', ');
}

/** All working sets of one exercise block on one line. */
export function describeBlock(
  name: string,
  sets: SetRow[],
  units: Units,
  isDuration: boolean
): string {
  const working = workingSets(sets);
  if (working.length === 0) return `${name}: no working sets logged`;
  return `${name}: ${working.map((s) => describeSet(s, units, isDuration)).join(', ')}`;
}

/**
 * Best estimated 1RM (kg) among the working sets, or null when there is no
 * usable estimate (no sets, a duration exercise, or reps out of range).
 */
export function bestE1rmKg(sets: SetRow[], isDuration: boolean): number | null {
  let best = 0;
  for (const s of workingSets(sets)) {
    // null for a duration exercise: seconds must never reach rep maths.
    const reps = getSetReps(s, modality(isDuration));
    if (reps === null || s.weight_kg <= 0 || reps <= 0) continue;
    const value = e1rmValueFromRpe(s.weight_kg, reps, s.rpe);
    if (value > best) best = value;
  }
  return best > 0 ? best : null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return 'duration not recorded';
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}

/** "Mon, Nov 9, 2026" for a YYYY-MM-DD key, without any timezone shift. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return 'unknown date';
  const key = day.slice(0, 10);
  const date = new Date(`${key}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The YYYY-MM-DD calendar day of an instant, in the given IANA time zone. */
export function dayInZone(instant: string | Date, timeZone: string): string {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add calendar days to a YYYY-MM-DD key (calendar arithmetic, not +24h). */
export function addDays(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + delta));
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing the given YYYY-MM-DD key. */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(day, weekday === 0 ? -6 : 1 - weekday);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface VolumeSetRow {
  logged_at: string;
  primary_muscle: string | null;
}

/**
 * Hard sets per primary muscle per week (weeks start Monday, in the user's
 * zone). Returns weeks newest first; each week maps muscle -> set count.
 */
export function weeklySetsByMuscle(
  rows: VolumeSetRow[],
  timeZone: string
): Array<{ weekStart: string; muscles: Array<[string, number]>; total: number }> {
  const weeks = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const weekStart = mondayOf(dayInZone(row.logged_at, timeZone));
    const muscle = row.primary_muscle || 'unknown';
    const byMuscle = weeks.get(weekStart) ?? new Map<string, number>();
    byMuscle.set(muscle, (byMuscle.get(muscle) ?? 0) + 1);
    weeks.set(weekStart, byMuscle);
  }
  return Array.from(weeks.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([weekStart, byMuscle]) => {
      const muscles = Array.from(byMuscle.entries()).sort((a, b) => b[1] - a[1]);
      return { weekStart, muscles, total: muscles.reduce((sum, [, n]) => sum + n, 0) };
    });
}

export interface FoodRow {
  logged_at: string;
  meal_type: string;
  food_name: string;
  serving_size: string | null;
  servings: number;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

export interface MacroTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  entries: number;
}

/** Per-day macro totals keyed by YYYY-MM-DD. Row values are already per entry. */
export function dailyMacroTotals(rows: FoodRow[]): Map<string, MacroTotals> {
  const days = new Map<string, MacroTotals>();
  for (const row of rows) {
    const key = row.logged_at.slice(0, 10);
    const day = days.get(key) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, entries: 0 };
    day.calories += row.calories ?? 0;
    day.protein += row.protein ?? 0;
    day.carbs += row.carbs ?? 0;
    day.fat += row.fat ?? 0;
    day.entries += 1;
    days.set(key, day);
  }
  return days;
}

export function formatMacros(totals: Pick<MacroTotals, 'calories' | 'protein' | 'carbs' | 'fat'>): string {
  return `${Math.round(totals.calories)} kcal, ${Math.round(totals.protein)} g protein, ${Math.round(
    totals.carbs
  )} g carbs, ${Math.round(totals.fat)} g fat`;
}

/** Mean of the finite numbers in a list, or null when there are none. */
export function mean(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
}
