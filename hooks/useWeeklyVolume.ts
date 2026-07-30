'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
import {
  assessVolumeStatus,
  resolvePrimaryMuscleCredits,
  type MuscleVolumeData,
} from '@/services/volumeTracker';
import { perSetCredits } from '@/services/shared/volumeCredit';
import type { WeeklyMuscleVolumeRow } from '@/types/database-queries';
import { STANDARD_MUSCLE_GROUPS, type StandardMuscleGroup } from '@/types/schema';
import {
  computeReachableMuscles,
  isMuscleWarnable,
  type WeeklyVolumeBlockRow,
} from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import { getLocalDateString } from '@/lib/utils';

interface UseWeeklyVolumeOptions {
  weekStart?: string; // YYYY-MM-DD, defaults to current week
}

export function useWeeklyVolume(options: UseWeeklyVolumeOptions = {}) {
  const [volumeData, setVolumeData] = useState<MuscleVolumeData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user, getVolumeLandmarks } = useUserStore();

  // Calculate week start (rolling 7 days including today)
  const weekStart = useMemo(() => {
    if (options.weekStart) return options.weekStart;
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 6);
    return getLocalDateString(sevenDaysAgo);
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
        // Use stored volume data - convert to standard muscle groups.
        // Stored rows may use legacy coarse groups ('chest'); distribute their
        // sets across the standard muscles they cover instead of assigning
        // everything to the first match.
        const storedSets = new Map<StandardMuscleGroup, number>();
        storedVolume.forEach((row: WeeklyMuscleVolumeRow) => {
          resolvePrimaryMuscleCredits(row.muscle_group).forEach(({ muscle, weight }) => {
            storedSets.set(muscle, (storedSets.get(muscle) ?? 0) + row.total_sets * weight);
          });
        });
        const mapped: MuscleVolumeData[] = [];
        storedSets.forEach((sets, standardMuscle) => {
          const totalSets = Math.round(sets);
          const landmarks = getVolumeLandmarks(standardMuscle);
          mapped.push({
            muscleGroup: standardMuscle,
            totalSets,
            directSets: totalSets, // Not tracked separately in DB
            indirectSets: 0,
            landmarks,
            status: assessVolumeStatus(totalSets, landmarks),
            percentOfMrv: Math.round((totalSets / landmarks.mrv) * 100),
          });
        });
        setVolumeData(mapped);
      } else {
        // Calculate from set logs if no pre-computed data
        // Calculate end of week
        const weekEnd = new Date();
        weekEnd.setHours(23, 59, 59, 999);
        const weekEndStr = weekEnd.toISOString();

        // Fetch exercise blocks and sets for current week
        const { data: blocks } = await supabase
          .from('exercise_blocks')
          .select(`
            id,
            exercise_id,
            exercises!inner (
              id,
              name,
              primary_muscle,
              secondary_muscles
            ),
            workout_sessions!inner (
              id,
              completed_at,
              user_id,
              state
            ),
            set_logs (
              id,
              is_warmup,
              weight_kg,
              reps,
              rpe
            )
          `)
          .gte('workout_sessions.completed_at', weekStart)
          .lte('workout_sessions.completed_at', weekEndStr)
          .eq('workout_sessions.state', 'completed');

        if (blocks && blocks.length > 0) {
          // Calculate volume from blocks: weighted direct credit for the
          // primary muscle(s) plus partial credit for secondary muscles
          // (previously secondaries were fetched but never counted, so e.g.
          // rows contributed nothing to biceps/rear delts).
          const directByMuscle = new Map<StandardMuscleGroup, number>();
          const indirectByMuscle = new Map<StandardMuscleGroup, number>();

          blocks.forEach((block: any) => {
            const exercise = block.exercises;
            if (!exercise) return;

            const allSets = block.set_logs || [];
            const workingSets = allSets.filter((s: any) => !s.is_warmup);

            if (workingSets.length === 0) return;

            const primaryMuscle = exercise.primary_muscle;
            if (!primaryMuscle) return;

            // Canonical per-set credit math (services/shared/volumeCredit) —
            // this hook only multiplies by the working-set count.
            for (const { muscle, credit, isDirect } of perSetCredits(
              primaryMuscle,
              exercise.secondary_muscles || []
            )) {
              const map = isDirect ? directByMuscle : indirectByMuscle;
              map.set(muscle, (map.get(muscle) ?? 0) + workingSets.length * credit);
            }
          });

          // Convert to MuscleVolumeData format with all standard muscles —
          // EXCEPT fine members (glute_med, erectors, upper_traps, soleus, …)
          // the user's own exercise tagging can't feed: a coarse-only
          // 'traps'/'calves' logger must never see an un-clearable fine-muscle
          // below-MEV row here. Same reachability gate as buildVolumeRows.
          const reachable = computeReachableMuscles(blocks as WeeklyVolumeBlockRow[]);
          const calculatedData: MuscleVolumeData[] = STANDARD_MUSCLE_GROUPS.filter((muscle) =>
            isMuscleWarnable(muscle, reachable)
          ).map((muscle) => {
            const directSets = Math.round(directByMuscle.get(muscle) ?? 0);
            const indirectSets = Math.round(indirectByMuscle.get(muscle) ?? 0);
            const totalSets = directSets + indirectSets;
            const landmarks = getVolumeLandmarks(muscle);
            return {
              muscleGroup: muscle,
              totalSets,
              directSets,
              indirectSets,
              landmarks,
              status: assessVolumeStatus(totalSets, landmarks),
              percentOfMrv: Math.round((totalSets / landmarks.mrv) * 100),
            };
          });

          setVolumeData(calculatedData);
        } else {
          // No data found - return empty defaults. With no logged blocks,
          // NOTHING is reachable, so every fine member is dropped (an empty
          // reachable set gates them all).
          const defaultData: MuscleVolumeData[] = STANDARD_MUSCLE_GROUPS.filter((muscle) =>
            isMuscleWarnable(muscle, new Set<StandardMuscleGroup>())
          ).map((muscle) => {
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

    // Full data for muscles below MEV (for atrophy risk alerts)
    const musclesBelowMevData = volumeData.filter((d) => d.status === 'below_mev');

    return {
      totalSets,
      musclesBelowMev,
      musclesBelowMevData,
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

