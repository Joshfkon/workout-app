/**
 * Loadable display weights for SUGGESTIONS and PREFILLS.
 *
 * Loads are stored in kg and the engine prescribes on a kg grid (often an
 * lb-native one: 2.27 kg = 5 lb). Converting that number to the lifter's unit
 * and printing it is not the same as telling them what to load: a 27.5 kg
 * history set reads "60.6 lbs", a 70 kg one "154.3 lbs", and the ± stepper
 * then walks 154.3 → 159.3 → 164.3. Nobody owns a 0.3 lb plate.
 *
 * This module is display-only. It never changes what the engine prescribes or
 * what gets stored (the typed number is converted back to kg as before); it
 * only decides which number in the user's own unit is shown and prefilled.
 *
 * Rules:
 *  1. A fresh suggestion snaps to the exercise's loadable step in the user's
 *     unit (see {@link loadStepForDisplay}).
 *  2. A value that is VERBATIM a logged set keeps its exact value only when it
 *     is something a lifter could have typed (a quarter-unit number once the
 *     DECIMAL(6,2) storage round-trip is undone). A conversion artifact — kg
 *     history shown to an lb user, or the reverse — snaps like a suggestion.
 *  3. kg users keep the existing kg plate rounding (`formatWeightValue`:
 *     2.5 kg steps, whole kg under 20 kg).
 *
 * Pure: no DB, no clock, no storage (the plate setting is passed in).
 */

import { convertWeight, formatWeightValue, roundToIncrement } from '@/lib/utils';
import type { EquipmentClass, WeightUnit } from '@/types/schema';

/** Equipment whose load is built from plate PAIRS (one plate per side). */
const PLATE_PAIR_CLASSES: ReadonlySet<EquipmentClass> = new Set<EquipmentClass>([
  'barbell',
  'smith',
  'machine_plate_loaded',
]);

/**
 * lb step when the exercise records no increment. Barbells and plate-loaded
 * machines move by a pair of 2.5 lb plates; dumbbells and kettlebells come in
 * 5 lb jumps; stacks, cables and everything else get 2.5 lb (add-on weights).
 */
export const DEFAULT_LB_STEP: Record<EquipmentClass, number> = {
  barbell: 5,
  smith: 5,
  machine_plate_loaded: 5,
  dumbbell: 5,
  kettlebell: 5,
  machine_pin_loaded: 2.5,
  cable: 2.5,
  bodyweight: 2.5,
  band: 2.5,
  other: 2.5,
};

/** kg steps a kg-unit stepper may use; an lb-native increment maps to the nearest. */
const KG_STEP_LADDER = [0.5, 1, 1.25, 2, 2.5, 5, 10, 20] as const;

export interface LoadStepOptions {
  /** Derived equipment class of the exercise (`deriveEquipmentClass`). */
  equipmentClass?: EquipmentClass | null;
  /** exercises.available_increments_kg — the per-exercise loading reality. */
  availableIncrementsKg?: number[] | null;
  /** exercises.min_weight_increment_kg — the legacy single increment. */
  minIncrementKg?: number | null;
  /**
   * The smallest plate the lifter has said they own, per side, in `unit`
   * (the plate calculator's setting). Only an EXPLICIT choice belongs here —
   * pass undefined when the user never picked one. Applies to plate-pair
   * equipment only.
   */
  smallestPlate?: number | null;
}

function validPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function kgIncrementToLbStep(incKg: number): number {
  return Math.max(1.25, roundToIncrement(convertWeight(incKg, 'kg', 'lb'), 1.25));
}

function kgIncrementToKgStep(incKg: number): number {
  // Nearest ladder entry by ratio, so 2.27 (an lb-native 5 lb) → 2.5 and a
  // genuine 2 kg dumbbell step stays 2.
  let best: number = KG_STEP_LADDER[0];
  for (const step of KG_STEP_LADDER) {
    if (Math.abs(Math.log(incKg / step)) < Math.abs(Math.log(incKg / best))) best = step;
  }
  return best;
}

/**
 * The smallest load change the lifter can actually make on this exercise, in
 * the DISPLAY unit. Precedence: the exercise's recorded increment set, then
 * the user's plate choice (plate-pair equipment: 2 × smallest plate), then
 * the exercise's legacy increment, then the equipment default.
 */
export function loadStepForDisplay(unit: WeightUnit, opts: LoadStepOptions = {}): number {
  const toDisplayStep = unit === 'lb' ? kgIncrementToLbStep : kgIncrementToKgStep;

  const recorded = (opts.availableIncrementsKg ?? []).filter(validPositive);
  if (recorded.length > 0) return toDisplayStep(Math.min(...recorded));

  const cls = opts.equipmentClass ?? null;
  if (cls && PLATE_PAIR_CLASSES.has(cls) && validPositive(opts.smallestPlate)) {
    return opts.smallestPlate * 2;
  }

  if (validPositive(opts.minIncrementKg)) return toDisplayStep(opts.minIncrementKg);

  if (unit === 'lb') return cls ? DEFAULT_LB_STEP[cls] : 2.5;
  return 2.5;
}

/** Two decimals, without float noise ("152.50000001" → 152.5). */
function tidy(n: number): number {
  return parseFloat(n.toFixed(2));
}

/**
 * A suggested load in the display unit, on the loadable grid. lb snaps to
 * `step` (never to 0 for a positive load); kg keeps `formatWeightValue`.
 */
export function snapSuggestedLoad(weightKg: number, unit: WeightUnit, step: number): number {
  if (!(weightKg > 0)) return 0;
  if (unit === 'kg') return formatWeightValue(weightKg, 'kg');
  const lbs = convertWeight(weightKg, 'kg', 'lb');
  const s = validPositive(step) ? step : 2.5;
  return tidy(Math.max(s, roundToIncrement(lbs, s)));
}

/**
 * Tolerance for "the lifter typed this": DECIMAL(6,2) kg storage moves a
 * typed value by at most 0.005 kg = 0.011 lb.
 */
const TYPED_TOLERANCE = { lb: 0.015, kg: 0.006 } as const;

/**
 * If `weightKg` converts to a number a lifter could have typed (a multiple of
 * 0.25 in `unit`, within storage precision), that number; otherwise null.
 */
export function typedLoadInUnit(weightKg: number, unit: WeightUnit): number | null {
  if (!(weightKg > 0)) return null;
  const v = unit === 'lb' ? convertWeight(weightKg, 'kg', 'lb') : weightKg;
  const quarter = Math.round(v * 4) / 4;
  return Math.abs(v - quarter) <= TYPED_TOLERANCE[unit] ? tidy(quarter) : null;
}

/**
 * The number to SHOW or PREFILL for a suggested load. When the suggestion is
 * verbatim a logged set (`exactSourceKg`), the lifter's own typed number is
 * kept; a conversion artifact snaps to the grid like any suggestion.
 */
export function suggestedLoadForDisplay(
  weightKg: number,
  unit: WeightUnit,
  step: number,
  exactSourceKg?: number
): number {
  if (exactSourceKg !== undefined && weightKg === exactSourceKg) {
    const typed = typedLoadInUnit(weightKg, unit);
    if (typed !== null) return typed;
  }
  return snapSuggestedLoad(weightKg, unit, step);
}

/**
 * One ± stepper move in the display unit. From a value on the grid it moves a
 * full step; from an off-grid value (a hand-typed or legacy number) it moves
 * to the next grid point in that direction, so 154.3 + 5 → 155, not 159.3.
 */
export function stepLoad(current: number, direction: 1 | -1, step: number): number {
  const s = validPositive(step) ? step : 2.5;
  const value = Number.isFinite(current) && current > 0 ? current : 0;
  const onGrid = Math.abs(value / s - Math.round(value / s)) < 1e-6;
  const next = onGrid
    ? value + direction * s
    : (direction === 1 ? Math.ceil(value / s) : Math.floor(value / s)) * s;
  return tidy(Math.max(0, next));
}
