'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import { calculateWeeklyVolume, assessVolumeStatus, type MuscleVolumeData } from '@/services/volumeTracker';
import type { WeeklyMuscleVolume, SetLog, ExerciseBlock, Exercise } from '@/types/schema';
import { MUSCLE_GROUPS } from '@/types/schema';

interface UseWeeklyVolumeOptions {
  weekStart?: string; // YYYY-MM-DD, defaults to current week
}

export function useWeeklyVolume(options: UseWeeklyVolumeOptions = {}) {
  const [volumeData, setVolumeData] = useState<MuscleVolumeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user, getVolumeLandmarks } = useUserStore();

  // Calculate week start (Monday)
  const weekStart = useMemo(() => {
    if (options.weekStart) return options.weekStart;
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now.setDate(diff));
    return monday.toISOString().split('T')[0];
  }, [options.weekStart]);

  const fetchVolume = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // Try to get pre-computed volume from database first
      const { data: storedVolume, error: volumeError } = await supabase
        .from('weekly_muscle_volume')
        .select('*')
        .eq('week_start', weekStart);

      if (storedVolume && storedVolume.length > 0) {
        // Use stored volume data
        const mapped: MuscleVolumeData[] = storedVolume.map((row: any) => {
          const landmarks = getVolumeLandmarks(row.muscle_group);
          return {
            muscleGroup: row.muscle_group,
            totalSets: row.total_sets,
            directSets: row.total_sets, // Not tracked separately in DB
            indirectSets: 0,
            landmarks,
            status: row.status,
            percentOfMrv: Math.round((row.total_sets / landmarks.mrv) * 100),
          };
        });
        setVolumeData(mapped);
      } else {
        // Calculate from set logs if no pre-computed data
        // This would be a more complex query joining sets -> blocks -> exercises
        // For now, return empty/default data
        const defaultData: MuscleVolumeData[] = MUSCLE_GROUPS.map((muscle) => {
          const landmarks = getVolumeLandmarks(muscle);
          return {
            muscleGroup: muscle,
            totalSets: 0,
            directSets: 0,
            indirectSets: 0,
            landmarks,
            status: 'below_mev' as const,
            percentOfMrv: 0,
          };
        });
        setVolumeData(defaultData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch volume');
    } finally {
      setIsLoading(false);
    }
  }, [weekStart, getVolumeLandmarks]);

  useEffect(() => {
    fetchVolume();
  }, [fetchVolume]);

  // Summary stats
  const summary = useMemo(() => {
    const totalSets = volumeData.reduce((sum, d) => sum + d.totalSets, 0);
    const musclesBelowMev = volumeData.filter((d) => d.status === 'below_mev').map((d) => d.muscleGroup);
    const musclesOptimal = volumeData.filter((d) => d.status === 'optimal').map((d) => d.muscleGroup);
    const musclesOverMrv = volumeData.filter((d) => d.status === 'exceeding_mrv').map((d) => d.muscleGroup);
    const avgPercentMrv = volumeData.length > 0
      ? Math.round(volumeData.reduce((sum, d) => sum + d.percentOfMrv, 0) / volumeData.length)
      : 0;

    return {
      totalSets,
      musclesBelowMev,
      musclesOptimal,
      musclesOverMrv,
      avgPercentMrv,
    };
  }, [volumeData]);

  return {
    volumeData,
    isLoading,
    error,
    weekStart,
    summary,
    refetch: fetchVolume,
  };
}

