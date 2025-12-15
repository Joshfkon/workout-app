'use server';

/**
 * Nutrition Server Actions
 * 
 * Handles macro recalculation when weight changes and other nutrition-related
 * server-side operations.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { calculateMacros, type Goal, type ActivityLevel, type Peptide, type UserStats, type ActivityConfig, type GoalConfig } from '@/lib/nutrition/macroCalculator';

// Note: Food search functions (searchFoods, getFoodDetails, lookupBarcode, FoodSearchResult)
// should be imported directly from '@/services/fatSecretService'

export interface MacroSettings {
  height_cm: number | null;
  age: number | null;
  sex: 'male' | 'female' | null;
  activity_level: ActivityLevel;
  workouts_per_week: number;
  avg_workout_minutes: number;
  workout_intensity: 'light' | 'moderate' | 'intense';
  goal: Goal;
  target_weight_change_per_week: number | null;
  peptide: Peptide;
  auto_update_enabled: boolean;
}

export interface RecalculateMacrosResult {
  success: boolean;
  newTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  message: string;
  skipped?: boolean;
}

/**
 * Recalculate macros based on a new weight entry
 * Uses saved macro settings for the recalculation
 */
export async function recalculateMacrosForWeight(
  newWeightKg: number
): Promise<RecalculateMacrosResult> {
  try {
    const supabase = await createUntypedServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, message: 'Not authenticated' };
    }

    // Get macro settings
    const { data: settings, error: settingsError } = await supabase
      .from('macro_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (settingsError || !settings) {
      // No settings saved - skip auto-update
      return { 
        success: true, 
        skipped: true, 
        message: 'No macro settings saved. Use the macro calculator to set up auto-updates.' 
      };
    }

    // Check if auto-update is enabled
    if (!settings.auto_update_enabled) {
      return { 
        success: true, 
        skipped: true, 
        message: 'Auto-update is disabled in your settings.' 
      };
    }

    // Validate required fields
    if (!settings.height_cm || !settings.age || !settings.sex) {
      return { 
        success: false, 
        message: 'Missing required data (height, age, or sex) for macro calculation.' 
      };
    }

    // Build calculation inputs
    const userStats: UserStats = {
      weightKg: newWeightKg,
      heightCm: settings.height_cm,
      age: settings.age,
      sex: settings.sex as 'male' | 'female',
    };

    const activityConfig: ActivityConfig = {
      activityLevel: settings.activity_level as ActivityLevel,
      workoutsPerWeek: settings.workouts_per_week || 4,
      avgWorkoutMinutes: settings.avg_workout_minutes || 60,
      workoutIntensity: (settings.workout_intensity as 'light' | 'moderate' | 'intense') || 'moderate',
    };

    const goalConfig: GoalConfig = {
      goal: settings.goal as Goal,
      targetWeightChangePerWeek: settings.target_weight_change_per_week || undefined,
      peptide: (settings.peptide as Peptide) || 'none',
    };

    // Calculate new macros
    const recommendation = calculateMacros(userStats, activityConfig, goalConfig);

    const newTargets = {
      calories: recommendation.calories,
      protein: recommendation.protein,
      carbs: recommendation.carbs,
      fat: recommendation.fat,
    };

    // Update nutrition targets
    const { data: existingTargets } = await supabase
      .from('nutrition_targets')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existingTargets) {
      await supabase
        .from('nutrition_targets')
        .update({
          ...newTargets,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);
    } else {
      await supabase
        .from('nutrition_targets')
        .insert({
          user_id: user.id,
          ...newTargets,
        });
    }

    return {
      success: true,
      newTargets,
      message: `Macros updated: ${newTargets.calories} cal, ${newTargets.protein}g protein, ${newTargets.carbs}g carbs, ${newTargets.fat}g fat`,
    };
  } catch (error) {
    console.error('[recalculateMacrosForWeight] Error:', error);
    return { success: false, message: 'Failed to recalculate macros' };
  }
}

/**
 * Save macro calculation settings for future auto-updates
 */
export async function saveMacroSettings(
  settings: Omit<MacroSettings, 'auto_update_enabled'> & { auto_update_enabled?: boolean }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createUntypedServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Upsert settings
    const { error } = await supabase
      .from('macro_settings')
      .upsert({
        user_id: user.id,
        height_cm: settings.height_cm,
        age: settings.age,
        sex: settings.sex,
        activity_level: settings.activity_level,
        workouts_per_week: settings.workouts_per_week,
        avg_workout_minutes: settings.avg_workout_minutes,
        workout_intensity: settings.workout_intensity,
        goal: settings.goal,
        target_weight_change_per_week: settings.target_weight_change_per_week,
        peptide: settings.peptide,
        auto_update_enabled: settings.auto_update_enabled ?? true,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('[saveMacroSettings] Error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[saveMacroSettings] Error:', error);
    return { success: false, error: 'Failed to save settings' };
  }
}

/**
 * Get current macro settings
 */
export async function getMacroSettings(): Promise<MacroSettings | null> {
  try {
    const supabase = await createUntypedServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) return null;

    const { data } = await supabase
      .from('macro_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    return data as MacroSettings | null;
  } catch (error) {
    console.error('[getMacroSettings] Error:', error);
    return null;
  }
}
