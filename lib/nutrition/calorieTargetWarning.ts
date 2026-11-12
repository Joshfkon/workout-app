/**
 * A warning (never a block) for very low hand-entered calorie targets, using
 * the same floors the macro calculator enforces on its own output.
 */

import { MIN_CALORIE_FLOORS } from '@/lib/nutrition/macroCalculator';

/**
 * Returns warning text when `calories` is below the calculator's floor for
 * the user's sex, else null. With an unknown sex the lower (female) floor is
 * used so the warning never fires for a value the calculator itself could
 * have produced.
 */
export function lowCalorieTargetWarning(
  calories: number,
  sex?: 'male' | 'female' | null
): string | null {
  if (!Number.isFinite(calories) || calories <= 0) return null;
  const floor = sex === 'male' ? MIN_CALORIE_FLOORS.male : MIN_CALORIE_FLOORS.female;
  if (calories >= floor) return null;
  return (
    `${Math.round(calories)} cal is below the ${floor} cal minimum the macro calculator uses. ` +
    'Very low targets are hard to sustain and can cost muscle. You can still save it.'
  );
}
