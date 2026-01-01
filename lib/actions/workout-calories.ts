'use server';

/**
 * Server Actions for Workout Calorie Calculation
 * Uses HyperTracker set-based calculation when available
 */

import { createUntypedServerClient } from '@/lib/supabase/server';
import { estimateWorkoutExpenditure } from '@/lib/integrations/workout-calories';
import { updateWorkoutExpenditure } from './wearable';
import type { SetLog } from '@/types/schema';
import type { ExerciseEntry } from '@/types/schema';
import type { AppWorkoutActivity } from '@/types/wearable';

/**
 * Calculate and save workout calories for a completed workout session
 */
export async function calculateAndSaveWorkoutCalories(
  workoutSessionId: string,
  date: string
): Promise<{ success: boolean; calories?: number; error?: string }> {
  const supabase = await createUntypedServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  try {
    // Fetch workout session
    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .select('id, started_at, completed_at, user_id')
      .eq('id', workoutSessionId)
      .eq('user_id', user.id)
      .single();

    if (sessionError || !session) {
      return { success: false, error: 'Workout session not found' };
    }

    if (!session.started_at || !session.completed_at) {
      return { success: false, error: 'Workout session not completed' };
    }

    // First get exercise block IDs for this workout
    const { data: exerciseBlocks, error: blocksError } = await supabase
      .from('exercise_blocks')
      .select('id, exercise_id, exercise:exercises(id, name, primary_muscle, pattern)')
      .eq('workout_session_id', workoutSessionId);

    if (blocksError) {
      console.error('Error fetching exercise blocks:', blocksError);
    }

    const blockIds = (exerciseBlocks || []).map(b => b.id);

    // Fetch all set logs for this workout
    const { data: setLogs, error: setsError } = await supabase
      .from('set_logs')
      .select('*')
      .in('exercise_block_id', blockIds.length > 0 ? blockIds : ['']) // Empty array causes error
      .order('logged_at', { ascending: true });

    if (setsError && blockIds.length > 0) {
      console.error('Error fetching set logs:', setsError);
      // Continue with duration-based calculation
    }

    // Get user profile for body fat percentage
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('weight_kg, body_fat_percent')
      .eq('user_id', user.id)
      .single();

    // Get user weight (fallback to user_profiles or weight_log)
    let userWeightKg = userProfile?.weight_kg || 80; // Default fallback
    let bodyFatPercent = userProfile?.body_fat_percent || 15; // Default fallback

    // Try to get most recent weight from weight_log if not in profile
    if (!userWeightKg) {
      const { data: recentWeight } = await supabase
        .from('weight_log')
        .select('weight, unit')
        .eq('user_id', user.id)
        .order('logged_at', { ascending: false })
        .limit(1)
        .single();

      if (recentWeight) {
        // Convert to kg if needed
        userWeightKg = recentWeight.unit === 'kg' 
          ? recentWeight.weight 
          : recentWeight.weight / 2.20462;
      }
    }

    // Build exercise map (exercise_block_id -> ExerciseEntry)
    const exerciseMap = new Map<string, ExerciseEntry>();
    
    if (exerciseBlocks) {
      for (const block of exerciseBlocks) {
        const exercise = block.exercise;
        if (exercise && typeof exercise === 'object' && !Array.isArray(exercise) && 'id' in exercise) {
          const exerciseData = exercise as { id: string; name?: string; primary_muscle?: string; pattern?: string };
          exerciseMap.set(block.id, {
            name: exerciseData.name || '',
            primaryMuscle: (exerciseData.primary_muscle as any) || 'chest',
            secondaryMuscles: [],
            pattern: (exerciseData.pattern as any) || 'isolation',
            equipment: 'barbell', // Default, could be fetched if needed
            difficulty: 'intermediate',
            fatigueRating: 2,
          });
        }
      }
    }

    // Convert set logs to SetLog format
    const formattedSetLogs: SetLog[] = (setLogs || []).map((set: any) => ({
      id: set.id,
      exerciseBlockId: set.exercise_block_id,
      setNumber: set.set_number,
      weightKg: set.weight_kg,
      reps: set.reps,
      rpe: set.rpe,
      restSeconds: set.rest_seconds,
      isWarmup: set.is_warmup || false,
      setType: set.set_type || 'normal',
      parentSetId: set.parent_set_id,
      quality: set.quality || 'effective',
      qualityReason: set.quality_reason || '',
      note: set.note,
      loggedAt: set.logged_at,
    }));

    // Create AppWorkoutActivity
    const startTime = new Date(session.started_at);
    const endTime = new Date(session.completed_at);
    const durationMinutes = Math.round(
      (endTime.getTime() - startTime.getTime()) / 1000 / 60
    );

    // Get muscle groups from exercises
    const muscleGroups = Array.from(exerciseMap.values())
      .map(e => e.primaryMuscle)
      .filter((v, i, a) => a.indexOf(v) === i); // Unique

    const workoutActivity: AppWorkoutActivity = {
      workoutId: session.id,
      startTime,
      endTime,
      durationMinutes,
      muscleGroups,
      totalSets: formattedSetLogs.length,
      totalVolume: formattedSetLogs.reduce(
        (sum, set) => sum + set.weightKg * set.reps,
        0
      ),
      averageRestSeconds: formattedSetLogs
        .filter(s => s.restSeconds)
        .reduce((sum, s) => sum + (s.restSeconds || 0), 0) / 
        Math.max(1, formattedSetLogs.filter(s => s.restSeconds).length) || 120,
      estimatedCalories: 0,
      stepsOverlap: 0,
    };

    // Calculate calories using set-based method if we have the data
    const estimate = estimateWorkoutExpenditure(
      workoutActivity,
      userWeightKg,
      bodyFatPercent,
      formattedSetLogs.length > 0 ? formattedSetLogs : undefined,
      exerciseMap.size > 0 ? exerciseMap : undefined
    );

    // Save to daily_activity_data
    const result = await updateWorkoutExpenditure(date, estimate.totalEstimate);

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      calories: estimate.totalEstimate,
    };
  } catch (error) {
    console.error('Error calculating workout calories:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

