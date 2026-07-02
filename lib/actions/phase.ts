'use server';

/**
 * Training Phase Server Actions
 *
 * Single write path for the user's current phase (bulk / cut / maintain).
 * The phase lives in two places with different vocabularies:
 * - users.goal ('bulk' | 'cut' | 'maintenance') — drives training logic
 *   (mesocycle builder, fatigue budget, session builder, AI coaching context)
 * - macro_settings.goal (7-level 'aggressive_cut'..'aggressive_bulk') — drives
 *   nutrition target calculation
 * Updating the phase here keeps both in sync and (optionally) recalculates
 * nutrition_targets so the calorie/macro targets match the new phase.
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import {
  calculateMacros,
  lbsToKg,
  type Goal as NutritionGoal,
  type ActivityLevel,
  type Peptide,
  type UserStats,
  type ActivityConfig,
  type GoalConfig,
} from '@/lib/nutrition/macroCalculator';

/** Top-level phase; values match the users.goal DB enum. */
export type TrainingPhase = 'bulk' | 'cut' | 'maintenance';

export interface UpdatePhaseResult {
  success: boolean;
  message: string;
  /** Whether macro_settings.goal was synced to the new phase. */
  macrosSynced: boolean;
  /** New nutrition targets, present only if they were recalculated. */
  newTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

const CUT_GOALS: NutritionGoal[] = ['aggressive_cut', 'moderate_cut', 'slow_cut'];
const BULK_GOALS: NutritionGoal[] = ['slow_bulk', 'moderate_bulk', 'aggressive_bulk'];

/**
 * Map a phase onto the macro calculator's 7-level goal, preserving the user's
 * chosen pace when the direction is unchanged (slow_cut stays slow_cut) and
 * defaulting to a sensible pace when switching direction.
 */
function phaseToNutritionGoal(phase: TrainingPhase, current: NutritionGoal | null): NutritionGoal {
  if (phase === 'maintenance') return 'maintain';
  if (phase === 'cut') {
    return current && CUT_GOALS.includes(current) ? current : 'moderate_cut';
  }
  // Lean-bulk default: minimizes fat gain, the right starting point for most lifters
  return current && BULK_GOALS.includes(current) ? current : 'slow_bulk';
}

/**
 * Current body weight in kg for macro recalculation: latest weight_log entry
 * (converted from the logged/preferred unit), falling back to the profile weight.
 */
async function getCurrentWeightKg(
  supabase: Awaited<ReturnType<typeof createUntypedServerClient>>,
  userId: string
): Promise<number | null> {
  const [{ data: latest }, { data: prefs }] = await Promise.all([
    supabase
      .from('weight_log')
      .select('weight, unit')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('user_preferences').select('weight_unit').eq('user_id', userId).maybeSingle(),
  ]);

  if (latest?.weight) {
    const unit = latest.unit || prefs?.weight_unit || 'lb';
    return unit === 'kg' ? latest.weight : lbsToKg(latest.weight);
  }

  const { data: profile } = await supabase
    .from('users')
    .select('weight_kg')
    .eq('id', userId)
    .maybeSingle();
  return profile?.weight_kg ?? null;
}

/**
 * Set the user's current phase (bulk / cut / maintain).
 *
 * Always updates users.goal. If the user has macro settings (i.e. has used the
 * macro calculator), also syncs macro_settings.goal and — unless
 * `recalculateTargets` is false — recalculates nutrition_targets for the new
 * phase using their latest body weight.
 */
export async function updateTrainingPhase(
  phase: TrainingPhase,
  options: { recalculateTargets?: boolean } = {}
): Promise<UpdatePhaseResult> {
  const recalculateTargets = options.recalculateTargets ?? true;
  try {
    const supabase = await createUntypedServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, macrosSynced: false, message: 'Not authenticated' };
    }

    // 1. Profile goal — the value training logic reads
    const { error: goalError } = await supabase
      .from('users')
      .update({ goal: phase })
      .eq('id', user.id);
    if (goalError) {
      console.error('[updateTrainingPhase] users.goal update failed:', goalError);
      return { success: false, macrosSynced: false, message: 'Failed to update training phase' };
    }

    // 2. Nutrition goal — only exists once the user has saved macro settings
    const { data: settings } = await supabase
      .from('macro_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!settings) {
      return {
        success: true,
        macrosSynced: false,
        message: 'Phase updated. Set up the macro calculator to sync nutrition targets too.',
      };
    }

    const nutritionGoal = phaseToNutritionGoal(phase, (settings.goal as NutritionGoal) ?? null);
    const goalChanged = nutritionGoal !== settings.goal;
    const { error: settingsError } = await supabase
      .from('macro_settings')
      .update({
        goal: nutritionGoal,
        // A per-week weight-change override from the old phase has the wrong
        // sign/magnitude for the new one — clear it and let pace defaults drive.
        ...(goalChanged ? { target_weight_change_per_week: null } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);
    if (settingsError) {
      console.error('[updateTrainingPhase] macro_settings update failed:', settingsError);
      return {
        success: true,
        macrosSynced: false,
        message: 'Phase updated, but nutrition settings could not be synced.',
      };
    }

    if (!recalculateTargets) {
      return { success: true, macrosSynced: true, message: 'Phase updated.' };
    }

    // 3. Recalculate nutrition targets for the new phase
    if (!settings.height_cm || !settings.age || !settings.sex) {
      return {
        success: true,
        macrosSynced: true,
        message: 'Phase updated. Complete the macro calculator to refresh your targets.',
      };
    }

    const weightKg = await getCurrentWeightKg(supabase, user.id);
    if (!weightKg) {
      return {
        success: true,
        macrosSynced: true,
        message: 'Phase updated. Log a body weight to refresh your macro targets.',
      };
    }

    const userStats: UserStats = {
      weightKg,
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
      goal: nutritionGoal,
      peptide: (settings.peptide as Peptide) || 'none',
    };

    const recommendation = calculateMacros(userStats, activityConfig, goalConfig);
    const newTargets = {
      calories: recommendation.calories,
      protein: recommendation.protein,
      carbs: recommendation.carbs,
      fat: recommendation.fat,
    };

    const { data: existingTargets } = await supabase
      .from('nutrition_targets')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();

    const targetsResult = existingTargets
      ? await supabase
          .from('nutrition_targets')
          .update({ ...newTargets, updated_at: new Date().toISOString() })
          .eq('user_id', user.id)
      : await supabase.from('nutrition_targets').insert({ user_id: user.id, ...newTargets });

    if (targetsResult.error) {
      console.error('[updateTrainingPhase] nutrition_targets update failed:', targetsResult.error);
      return {
        success: true,
        macrosSynced: true,
        message: 'Phase updated, but macro targets could not be refreshed.',
      };
    }

    return {
      success: true,
      macrosSynced: true,
      newTargets,
      message: `Phase updated. New targets: ${newTargets.calories} cal, ${newTargets.protein}g protein.`,
    };
  } catch (error) {
    console.error('[updateTrainingPhase] Error:', error);
    return { success: false, macrosSynced: false, message: 'Failed to update training phase' };
  }
}
