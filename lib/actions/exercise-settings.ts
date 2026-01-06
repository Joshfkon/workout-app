'use server';

import { createUntypedClient } from '@/lib/supabase/server';

/**
 * Save machine starting weight for an exercise
 */
export async function saveMachineStartingWeight(
  exerciseId: string,
  startingWeightKg: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    if (startingWeightKg === null || startingWeightKg === undefined) {
      // Delete the setting if weight is null
      const { error } = await supabase
        .from('user_exercise_settings')
        .delete()
        .eq('user_id', user.id)
        .eq('exercise_id', exerciseId);

      if (error) {
        console.error('Error deleting starting weight:', error);
        return { success: false, error: error.message };
      }
    } else {
      // Upsert the setting
      const { error } = await supabase
        .from('user_exercise_settings')
        .upsert({
          user_id: user.id,
          exercise_id: exerciseId,
          machine_starting_weight_kg: startingWeightKg,
        }, {
          onConflict: 'user_id,exercise_id',
        });

      if (error) {
        console.error('Error saving starting weight:', error);
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error in saveMachineStartingWeight:', error);
    return { success: false, error: 'Failed to save starting weight' };
  }
}

/**
 * Load machine starting weight for an exercise
 */
export async function loadMachineStartingWeight(
  exerciseId: string
): Promise<{ startingWeightKg: number | null; error?: string }> {
  try {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return { startingWeightKg: null, error: 'Not authenticated' };
    }

    const { data, error } = await supabase
      .from('user_exercise_settings')
      .select('machine_starting_weight_kg')
      .eq('user_id', user.id)
      .eq('exercise_id', exerciseId)
      .maybeSingle();

    if (error) {
      console.error('Error loading starting weight:', error);
      return { startingWeightKg: null, error: error.message };
    }

    return { startingWeightKg: data?.machine_starting_weight_kg ?? null };
  } catch (error) {
    console.error('Error in loadMachineStartingWeight:', error);
    return { startingWeightKg: null, error: 'Failed to load starting weight' };
  }
}

