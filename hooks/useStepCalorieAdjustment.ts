'use client';

import { useQuery } from '@tanstack/react-query';
import { getStepAdjustmentInputs } from '@/lib/actions/step-calorie-adjustment';
import {
  calculateStepAdjustedTarget,
  type StepAdjustmentResult,
} from '@/lib/nutrition/step-calorie-adjustment';
import { getLocalDateString } from '@/lib/utils';

export const STEP_ADJUSTMENT_KEY = ['step-calorie-adjustment'] as const;

/**
 * Step-adjusted calorie target for a day. Returns null unless the user opted
 * into "activity_adjusted" in Activity settings (default 'fixed'), so callers
 * fall back to the stored target unchanged.
 */
export function useStepCalorieAdjustment(
  dateKey: string | null,
  baseCalories: number | null | undefined
): StepAdjustmentResult | null {
  const isToday = !!dateKey && dateKey === getLocalDateString();
  const { data } = useQuery({
    queryKey: [...STEP_ADJUSTMENT_KEY, dateKey ?? '__none__'],
    queryFn: () => getStepAdjustmentInputs(dateKey as string),
    enabled: !!dateKey,
    staleTime: isToday ? 5 * 60 * 1000 : 60 * 60 * 1000,
    refetchInterval: isToday ? 10 * 60 * 1000 : false,
  });

  if (!data?.enabled || !baseCalories || baseCalories <= 0) return null;

  const now = new Date();
  return calculateStepAdjustedTarget({
    baseCalories,
    daySteps: data.daySteps,
    baseline: data.baseline,
    weightKg: data.weightKg,
    maxDailyAdjustment: data.maxDailyAdjustment,
    isToday,
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
  });
}
