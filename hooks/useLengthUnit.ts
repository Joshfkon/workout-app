'use client';

import { useUserStore } from '@/stores/userStore';
import { resolveLengthUnit } from '@/lib/units/lengthUnits';
import type { LengthUnit, WeightUnit } from '@/types/schema';

/**
 * The user's length unit (height, tape) for a component that is handed the
 * weight unit as a prop: their stored length choice from the user store, else
 * the one that goes with `weightUnit` (kg→cm, lb→in), which is exactly what
 * these components showed before length had its own setting.
 */
export function useLengthUnit(weightUnit: WeightUnit): LengthUnit {
  const stored = useUserStore((state) => state.user?.preferences.lengthUnits);
  return resolveLengthUnit({ units: weightUnit, lengthUnits: stored });
}
