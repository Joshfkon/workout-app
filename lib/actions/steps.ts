'use server';

/**
 * Server Actions for Manual Step Tracking
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { saveDailyActivityData } from './wearable';
import type { DailyActivityInput } from '@/types/wearable';

/**
 * Save manual steps for a specific date
 */
export async function saveManualSteps(
  date: string,
  steps: number,
  userWeightKg: number
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  if (steps < 0) {
    return { success: false, error: 'Steps must be a positive number' };
  }

  // Get existing activity data for this date
  const { data: existing, error: existingError } = await supabase
    .from('daily_activity_data')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .single();

  // Handle table not existing error gracefully
  if (existingError?.code === '42P01' || existingError?.message?.includes('schema cache')) {
    console.error('daily_activity_data table not found - migration may need to be run');
    return { success: false, error: 'Step tracking is not yet available. Please try again later.' };
  }

  // Prepare activity input
  const activityInput: DailyActivityInput = {
    date,
    steps: {
      total: steps,
      source: 'manual',
      hourlyBreakdown: undefined, // Manual entry doesn't have hourly breakdown
      confidence: 'manual', // User-entered data is manual confidence
    },
    wearableActiveCalories: existing?.wearable_active_calories || null,
  };

  // Save using existing function
  const result = await saveDailyActivityData(activityInput, userWeightKg);

  return result;
}

/**
 * Get steps for a specific date
 */
export async function getStepsForDate(date: string): Promise<number | null> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('daily_activity_data')
    .select('steps_total')
    .eq('user_id', user.id)
    .eq('date', date)
    .single();

  // Handle table not existing error gracefully
  if (error?.code === '42P01' || error?.message?.includes('schema cache')) {
    console.error('daily_activity_data table not found - migration may need to be run');
    return null;
  }

  return data?.steps_total || null;
}

