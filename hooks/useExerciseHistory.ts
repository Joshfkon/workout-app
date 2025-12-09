'use client';

import { useState, useEffect, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type { ExercisePerformanceSnapshot } from '@/types/schema';
import { calculateE1RM } from '@/services/plateauDetector';

interface UseExerciseHistoryOptions {
  exerciseId: string;
  limit?: number;
}

export function useExerciseHistory({ exerciseId, limit = 20 }: UseExerciseHistoryOptions) {
  const [snapshots, setSnapshots] = useState<ExercisePerformanceSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data, error: fetchError } = await supabase
        .from('exercise_performance_snapshots')
        .select('*')
        .eq('exercise_id', exerciseId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;

      // Map database fields to TypeScript interface
      const mappedData: ExercisePerformanceSnapshot[] = (data || []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        exerciseId: row.exercise_id,
        sessionDate: row.session_date,
        topSetWeightKg: row.top_set_weight_kg,
        topSetReps: row.top_set_reps,
        topSetRpe: row.top_set_rpe,
        totalWorkingSets: row.total_working_sets,
        estimatedE1RM: row.estimated_e1rm,
      }));

      setSnapshots(mappedData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    } finally {
      setIsLoading(false);
    }
  }, [exerciseId, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Calculate stats
  const stats = snapshots.length > 0
    ? {
        currentE1RM: snapshots[0].estimatedE1RM,
        peakE1RM: Math.max(...snapshots.map((s) => s.estimatedE1RM)),
        totalSessions: snapshots.length,
        lastSession: snapshots[0].sessionDate,
      }
    : null;

  // Get trend (is E1RM increasing?)
  const trend = snapshots.length >= 2
    ? {
        change: snapshots[0].estimatedE1RM - snapshots[snapshots.length - 1].estimatedE1RM,
        isPositive: snapshots[0].estimatedE1RM > snapshots[snapshots.length - 1].estimatedE1RM,
      }
    : null;

  return {
    snapshots,
    isLoading,
    error,
    stats,
    trend,
    refetch: fetchHistory,
  };
}

