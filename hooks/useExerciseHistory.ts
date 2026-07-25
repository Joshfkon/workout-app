'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import type { ExercisePerformanceSnapshot } from '@/types/schema';
import type { ExercisePerformanceSnapshotRow } from '@/types/database-queries';
import { calculateE1RM } from '@/services/plateauDetector';

interface UseExerciseHistoryOptions {
  exerciseId: string;
  limit?: number;
}

export function useExerciseHistory({ exerciseId, limit = 20 }: UseExerciseHistoryOptions) {
  const [snapshots, setSnapshots] = useState<ExercisePerformanceSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Monotonic request id. Only the most recent request is allowed to commit
  // results, so out-of-order responses (e.g. params changed mid-flight) and
  // post-unmount responses are ignored.
  const requestIdRef = useRef(0);

  const fetchHistory = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data, error: fetchError } = await supabase
        .from('exercise_performance_snapshots')
        .select('*')
        .eq('exercise_id', exerciseId)
        // Deload sessions are excluded from e1RM trend / PR reads.
        .eq('is_deload', false)
        .order('session_date', { ascending: false })
        .limit(limit);

      // Ignore stale/out-of-order responses.
      if (requestId !== requestIdRef.current) return;

      if (fetchError) throw fetchError;

      // Map database fields to TypeScript interface. Rows with a NULL
      // estimated_e1rm ("no valid estimate" — canonical estimator, e.g. a
      // >15-effective-rep session) are excluded: this hook feeds e1RM stats
      // and trend charts, and a null must render as absent, never as 0.
      const mappedData: ExercisePerformanceSnapshot[] = (data || [])
        .filter((row: ExercisePerformanceSnapshotRow) => row.estimated_e1rm != null)
        .map((row: ExercisePerformanceSnapshotRow) => ({
          id: row.id,
          userId: row.user_id,
          exerciseId: row.exercise_id,
          sessionDate: row.session_date,
          topSetWeightKg: row.top_set_weight_kg,
          topSetReps: row.top_set_reps,
          topSetRpe: row.top_set_rpe,
          totalWorkingSets: row.total_working_sets,
          estimatedE1RM: row.estimated_e1rm as number,
        }));

      setSnapshots(mappedData);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;
      setError(getErrorMessage(err));
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [exerciseId, limit]);

  useEffect(() => {
    fetchHistory();
    // Invalidate any in-flight request on unmount / dependency change so its
    // response is discarded and never sets state on an unmounted component.
    return () => {
      requestIdRef.current++;
    };
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

