import type { SharedWorkoutContent, SharedExercise } from '@/types/social';

/**
 * Serialize a workout session for sharing
 * Extracts exercise blocks and converts them to shareable format
 */
export async function serializeWorkoutForSharing(
  workoutSessionId: string,
  supabase: any
): Promise<SharedWorkoutContent | null> {
  try {
    // Fetch workout session
    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .select('id, mesocycle_id')
      .eq('id', workoutSessionId)
      .single();

    if (sessionError || !session) {
      console.error('Failed to fetch workout session:', sessionError);
      return null;
    }

    // Fetch exercise blocks
    const { data: blocks, error: blocksError } = await supabase
      .from('exercise_blocks')
      .select(`
        id,
        exercise_id,
        target_sets,
        target_rep_range,
        target_rir,
        note,
        superset_group_id,
        exercises!inner (
          id,
          name
        )
      `)
      .eq('workout_session_id', workoutSessionId)
      .order('order', { ascending: true });

    if (blocksError || !blocks) {
      console.error('Failed to fetch exercise blocks:', blocksError);
      return null;
    }

    // Calculate total sets and estimated duration
    const totalSets = blocks.reduce((sum: number, block: any) => sum + (block.target_sets || 0), 0);
    // Estimate: 2 minutes per set + 2 minutes rest between exercises
    const estimatedDurationMinutes = totalSets * 2 + blocks.length * 2;

    // Convert blocks to shared exercises
    const exercises: SharedExercise[] = blocks.map((block: any) => {
      // target_rep_range is stored as an array like [8, 12]
      const repRange = block.target_rep_range || [0, 0];
      return {
        exercise_id: block.exercise_id,
        exercise_name: block.exercises?.name || 'Unknown Exercise',
        sets: block.target_sets || 0,
        rep_range: [repRange[0] || 0, repRange[1] || 0] as [number, number],
        target_rir: block.target_rir || 0,
        notes: block.note || undefined,
        superset_group: block.superset_group_id || undefined,
      };
    });

    return {
      exercises,
      estimated_duration_minutes: estimatedDurationMinutes,
      total_sets: totalSets,
    };
  } catch (error) {
    console.error('Error serializing workout:', error);
    return null;
  }
}

/**
 * Extract target muscle groups from workout data
 */
export function extractMuscleGroups(workoutData: SharedWorkoutContent): string[] {
  // This would ideally query exercises to get their primary muscle groups
  // For now, return empty array - can be enhanced later
  return [];
}

