'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useUserStore, useExerciseStore } from '@/stores';
import {
  calculateNextTargets,
  extractPerformanceFromSets,
  type CalculateNextTargetsInput,
} from '@/services/progressionEngine';
import type { ProgressionTargets, Exercise, SetLog, ExerciseBlock } from '@/types/schema';

interface UseProgressionTargetsOptions {
  exerciseId: string;
  weekInMeso?: number;
  isDeloadWeek?: boolean;
  readinessScore?: number;
}

export function useProgressionTargets({
  exerciseId,
  weekInMeso = 1,
  isDeloadWeek = false,
  readinessScore = 80,
}: UseProgressionTargetsOptions) {
  const [targets, setTargets] = useState<ProgressionTargets | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user } = useUserStore();
  const { getExerciseById } = useExerciseStore();

  const calculateTargets = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Get exercise data
      const exercise = getExerciseById(exerciseId);
      if (!exercise) {
        throw new Error('Exercise not found');
      }

      // Fetch last session performance from database
      const supabase = createClient();
      const { data: lastSnapshot, error: snapshotError } = await supabase
        .from('exercise_performance_snapshots')
        .select('*')
        .eq('exercise_id', exerciseId)
        .order('session_date', { ascending: false })
        .limit(1)
        .single();

      let lastPerformance = null;
      if (lastSnapshot && !snapshotError) {
        lastPerformance = {
          exerciseId,
          weightKg: lastSnapshot.top_set_weight_kg,
          reps: lastSnapshot.top_set_reps,
          rpe: lastSnapshot.top_set_rpe,
          sets: lastSnapshot.total_working_sets,
          allSetsCompleted: true,
          averageRpe: lastSnapshot.top_set_rpe,
        };
      }

      // Calculate progression targets
      const input: CalculateNextTargetsInput = {
        exercise,
        lastPerformance,
        experience: user?.experience || 'intermediate',
        weekInMeso,
        isDeloadWeek,
        readinessScore,
      };

      const calculatedTargets = calculateNextTargets(input);
      setTargets(calculatedTargets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate targets');
    } finally {
      setIsLoading(false);
    }
  }, [exerciseId, weekInMeso, isDeloadWeek, readinessScore, user?.experience, getExerciseById]);

  useEffect(() => {
    calculateTargets();
  }, [calculateTargets]);

  return {
    targets,
    isLoading,
    error,
    recalculate: calculateTargets,
  };
}

