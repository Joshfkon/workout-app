/**
 * Data Migration Utility for Bodyweight Sets
 *
 * This utility migrates existing set_logs for bodyweight exercises
 * to include the new bodyweightData field.
 *
 * Usage:
 * - Import and call migrateBodyweightSets() from a server action or API route
 * - The migration is idempotent (safe to run multiple times)
 */

import { createClient } from '@/lib/supabase/server';
import type { BodyweightData, BodyweightModification } from '@/types/schema';
import { calculateEffectiveLoad } from '@/types/schema';

interface SetLogRow {
  id: string;
  exercise_block_id: string;
  weight_kg: number;
  bodyweight_data: BodyweightData | null;
}

interface ExerciseBlockRow {
  id: string;
  exercise_id: string;
}

interface BodyweightEntry {
  weight_kg: number;
  date: string;
}

/**
 * Get the user's latest bodyweight from bodyweight_entries
 */
async function getUserLatestBodyweight(
  supabase: any,
  userId: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from('bodyweight_entries')
    .select('weight_kg')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return (data as BodyweightEntry).weight_kg;
}

/**
 * Determine the modification type and values from existing weight data
 * This uses heuristics based on the recorded weight value
 */
function inferBodyweightModification(
  weightKg: number,
  userBodyweightKg: number
): {
  modification: BodyweightModification;
  addedWeightKg?: number;
  assistanceWeightKg?: number;
  needsReview: boolean;
} {
  // No weight recorded - pure bodyweight
  if (weightKg === 0 || weightKg === null) {
    return {
      modification: 'none',
      needsReview: false,
    };
  }

  // Small weight (< 50% of BW) - likely added weight
  if (weightKg < userBodyweightKg * 0.5) {
    return {
      modification: 'weighted',
      addedWeightKg: weightKg,
      needsReview: false,
    };
  }

  // Weight close to bodyweight - probably pure bodyweight logged incorrectly
  if (weightKg >= userBodyweightKg * 0.9 && weightKg <= userBodyweightKg * 1.1) {
    return {
      modification: 'none',
      needsReview: true, // User may have logged total instead of added
    };
  }

  // Weight significantly different from bodyweight - needs review
  return {
    modification: 'none',
    needsReview: true,
  };
}

/**
 * Migrate bodyweight sets for a specific user
 */
export async function migrateUserBodyweightSets(
  userId: string
): Promise<{
  success: boolean;
  migratedCount: number;
  reviewNeededCount: number;
  error?: string;
}> {
  const supabase = await createClient() as any; // Cast to any for migration queries

  try {
    // Get user's current bodyweight
    const userBodyweightKg = await getUserLatestBodyweight(supabase, userId);

    if (!userBodyweightKg) {
      return {
        success: false,
        migratedCount: 0,
        reviewNeededCount: 0,
        error: 'No bodyweight data found for user',
      };
    }

    // Get all exercise blocks for bodyweight exercises
    const { data: exercises, error: exercisesError } = await supabase
      .from('exercises')
      .select('id')
      .eq('is_bodyweight', true);

    if (exercisesError || !exercises) {
      return {
        success: false,
        migratedCount: 0,
        reviewNeededCount: 0,
        error: 'Failed to fetch bodyweight exercises',
      };
    }

    const bodyweightExerciseIds = exercises.map((e: any) => e.id);

    if (bodyweightExerciseIds.length === 0) {
      return {
        success: true,
        migratedCount: 0,
        reviewNeededCount: 0,
      };
    }

    // Get exercise blocks for these exercises from user's sessions
    const { data: blocks, error: blocksError } = await supabase
      .from('exercise_blocks')
      .select('id, exercise_id, workout_session_id')
      .in('exercise_id', bodyweightExerciseIds);

    if (blocksError || !blocks) {
      return {
        success: false,
        migratedCount: 0,
        reviewNeededCount: 0,
        error: 'Failed to fetch exercise blocks',
      };
    }

    // Filter to blocks from this user's sessions
    const { data: userSessions, error: sessionsError } = await supabase
      .from('workout_sessions')
      .select('id')
      .eq('user_id', userId);

    if (sessionsError || !userSessions) {
      return {
        success: false,
        migratedCount: 0,
        reviewNeededCount: 0,
        error: 'Failed to fetch user sessions',
      };
    }

    const userSessionIds = new Set(userSessions.map((s: any) => s.id));
    const userBlockIds = blocks
      .filter((b: any) => userSessionIds.has(b.workout_session_id))
      .map((b: any) => b.id);

    if (userBlockIds.length === 0) {
      return {
        success: true,
        migratedCount: 0,
        reviewNeededCount: 0,
      };
    }

    // Get set_logs that need migration (no bodyweight_data)
    const { data: sets, error: setsError } = await supabase
      .from('set_logs')
      .select('id, exercise_block_id, weight_kg, bodyweight_data')
      .in('exercise_block_id', userBlockIds)
      .is('bodyweight_data', null);

    if (setsError || !sets) {
      return {
        success: false,
        migratedCount: 0,
        reviewNeededCount: 0,
        error: 'Failed to fetch set logs',
      };
    }

    let migratedCount = 0;
    let reviewNeededCount = 0;

    // Process each set
    for (const set of sets) {
      const inference = inferBodyweightModification(set.weight_kg, userBodyweightKg);

      const bodyweightData: BodyweightData = {
        userBodyweightKg,
        modification: inference.modification,
        addedWeightKg: inference.addedWeightKg,
        effectiveLoadKg: calculateEffectiveLoad(
          userBodyweightKg,
          inference.modification,
          inference.addedWeightKg,
          inference.assistanceWeightKg
        ),
        _needsReview: inference.needsReview || undefined,
      };

      // Update the set
      const { error: updateError } = await supabase
        .from('set_logs')
        .update({ bodyweight_data: bodyweightData })
        .eq('id', set.id);

      if (!updateError) {
        migratedCount++;
        if (inference.needsReview) {
          reviewNeededCount++;
        }
      }
    }

    return {
      success: true,
      migratedCount,
      reviewNeededCount,
    };
  } catch (err) {
    return {
      success: false,
      migratedCount: 0,
      reviewNeededCount: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Get sets that need user review
 */
export async function getSetsNeedingReview(
  userId: string
): Promise<{
  success: boolean;
  sets: Array<{
    id: string;
    exerciseName: string;
    weightKg: number;
    reps: number;
    date: string;
  }>;
  error?: string;
}> {
  const supabase = await createClient() as any; // Cast to any for migration queries

  try {
    // Query sets with _needsReview flag
    const { data, error } = await supabase
      .from('set_logs')
      .select(`
        id,
        weight_kg,
        reps,
        logged_at,
        exercise_blocks!inner (
          exercises!inner (
            name
          ),
          workout_sessions!inner (
            user_id
          )
        )
      `)
      .not('bodyweight_data', 'is', null)
      .eq('exercise_blocks.workout_sessions.user_id', userId)
      .contains('bodyweight_data', { _needsReview: true })
      .order('logged_at', { ascending: false })
      .limit(100);

    if (error) {
      return {
        success: false,
        sets: [],
        error: error.message,
      };
    }

    const sets = (data || []).map((row: any) => ({
      id: row.id,
      exerciseName: row.exercise_blocks?.exercises?.name || 'Unknown',
      weightKg: row.weight_kg,
      reps: row.reps,
      date: row.logged_at,
    }));

    return {
      success: true,
      sets,
    };
  } catch (err) {
    return {
      success: false,
      sets: [],
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Update a set's bodyweight data after user review
 */
export async function updateSetBodyweightData(
  setId: string,
  bodyweightData: BodyweightData
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient() as any; // Cast to any for migration queries

  try {
    // Remove the _needsReview flag
    const cleanedData = { ...bodyweightData };
    delete cleanedData._needsReview;

    const { error } = await supabase
      .from('set_logs')
      .update({
        bodyweight_data: cleanedData,
        weight_kg: cleanedData.effectiveLoadKg, // Update weight to effective load
      })
      .eq('id', setId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
