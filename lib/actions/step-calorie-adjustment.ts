'use server';

/**
 * Inputs for the step-adjusted calorie target (see
 * lib/nutrition/step-calorie-adjustment.ts for the math and the
 * double-counting reasoning). The adjustment itself is computed on the client
 * because "today" is compared against the user's usual step PACE, which needs
 * the device's local time.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { validateWeightEntry } from '@/lib/weightUtils';
import { addLocalDays } from '@/lib/date/localDay';
import {
  STEP_BASELINE_WINDOW_DAYS,
  computeStepBaseline,
  isStepAdjustmentEnabled,
  type StepBaseline,
} from '@/lib/nutrition/step-calorie-adjustment';

export interface StepAdjustmentInputs {
  enabled: boolean;
  maxDailyAdjustment: number;
  daySteps: number | null;
  baseline: StepBaseline | null;
  weightKg: number | null;
}

const DISABLED: StepAdjustmentInputs = {
  enabled: false,
  maxDailyAdjustment: 0,
  daySteps: null,
  baseline: null,
  weightKg: null,
};

export async function getStepAdjustmentInputs(date: string): Promise<StepAdjustmentInputs> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return DISABLED;
  const supabase = await createUntypedServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DISABLED;

  const { data: settings } = (await supabase
    .from('activity_settings')
    .select('adjustment_mode, max_daily_adjustment')
    .eq('user_id', user.id)
    .maybeSingle()) as {
    data: { adjustment_mode?: string | null; max_daily_adjustment?: number | null } | null;
  };

  // Default (no row) is 'fixed': nothing else is fetched or changed.
  if (!isStepAdjustmentEnabled(settings?.adjustment_mode)) return DISABLED;

  const from = addLocalDays(date, -STEP_BASELINE_WINDOW_DAYS);
  const [{ data: activityRows }, { data: weightRows }] = await Promise.all([
    supabase
      .from('daily_activity_data')
      .select('date, steps_total')
      .eq('user_id', user.id)
      .gte('date', from)
      .lte('date', date) as unknown as Promise<{
      data: Array<{ date: string; steps_total: number | null }> | null;
    }>,
    supabase
      .from('weight_log')
      .select('weight, unit')
      .eq('user_id', user.id)
      .lte('logged_at', date)
      .order('logged_at', { ascending: false })
      .limit(1) as unknown as Promise<{
      data: Array<{ weight: number; unit?: string | null }> | null;
    }>,
  ]);

  const history = (activityRows ?? []).map((r) => ({ date: r.date, steps: r.steps_total ?? 0 }));
  const dayRow = history.find((d) => d.date === date);

  let weightKg: number | null = null;
  const w = weightRows?.[0];
  if (w?.weight) {
    const v = validateWeightEntry(w.weight, (w.unit ?? null) as 'lb' | 'kg' | null);
    weightKg = v.unit === 'kg' ? v.weight : v.weight / 2.20462;
  }

  return {
    enabled: true,
    maxDailyAdjustment: settings?.max_daily_adjustment ?? 300,
    daySteps: dayRow && dayRow.steps > 0 ? dayRow.steps : null,
    baseline: computeStepBaseline(history, date),
    weightKg,
  };
}
