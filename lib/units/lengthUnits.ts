/**
 * Length units (height, tape measurements), chosen separately from the
 * weight unit. Pure.
 *
 * Stored as `lengthUnits` in the users.preferences JSONB, next to `units`
 * (the weight unit). Nobody had a separate length choice before, so a user
 * with no `lengthUnits` keeps what the old bundled setting gave them: the
 * length unit that goes with their weight unit (kg→cm, lb→in). Nothing
 * changes for them until they pick a length unit themselves.
 *
 * All lengths are STORED in cm; this only decides how they are shown/typed.
 */
import type { LengthUnit, WeightUnit } from '@/types/schema';

/** users.preferences key for the length unit. */
export const LENGTH_UNITS_PREFERENCE_KEY = 'lengthUnits';

/** The length unit that the old bundled "kg & cm" / "lb & inches" setting implied. */
export function lengthUnitForWeightUnit(weightUnit: WeightUnit): LengthUnit {
  return weightUnit === 'kg' ? 'cm' : 'in';
}

/** A stored value, if it is a valid length unit. */
export function parseLengthUnit(value: unknown): LengthUnit | null {
  return value === 'cm' || value === 'in' ? value : null;
}

/**
 * The length unit to use for a preferences object: the explicit choice when
 * there is one, else the one implied by the weight unit. `fallbackWeightUnit`
 * is used only when `units` itself is missing or invalid.
 */
export function resolveLengthUnit(
  prefs: { units?: unknown; lengthUnits?: unknown } | null | undefined,
  fallbackWeightUnit: WeightUnit = 'lb'
): LengthUnit {
  const explicit = parseLengthUnit(prefs?.lengthUnits);
  if (explicit) return explicit;
  const weight: WeightUnit =
    prefs?.units === 'kg' || prefs?.units === 'lb' ? prefs.units : fallbackWeightUnit;
  return lengthUnitForWeightUnit(weight);
}

/** Word for a length unit in a field label: "cm" / "inches". */
export function lengthUnitLabel(unit: LengthUnit): string {
  return unit === 'cm' ? 'cm' : 'inches';
}
