'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { now as clockNow } from '@/lib/clock';
import {
  adaptiveVolumeWindows,
  adaptiveVolumeWindowIndex,
  setRirOrFallback,
} from '@/src/lib/training/adaptiveVolumeWindows';
import {
  type UserVolumeProfile,
  type MuscleVolumeData,
  type MesocycleAnalysis,
  type FatigueAlert,
  type VolumeSummary,
  createInitialVolumeProfile,
  assessCurrentFatigueStatus,
  getVolumeSummary,
  resetVolumeProfileToBaseline,
  VOLUME_COUNTER_VERSION,
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';
import { MUSCLE_GROUPS, resolveMuscleToStandard } from '@/types/schema';
import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { rirFromFeedback, sumEffectiveVolume } from '@/services/effectiveVolume';
import { STANDARD_TO_COARSE } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type {
  ExerciseBlockFull,
  SetLogRow,
} from '@/types/database-queries';

interface UseAdaptiveVolumeResult {
  // Profile data
  volumeProfile: UserVolumeProfile | null;
  isLoading: boolean;
  error: string | null;

  // Current week summary
  volumeSummary: VolumeSummary[];

  // Fatigue alerts
  fatigueAlerts: FatigueAlert[];

  // Latest mesocycle analysis
  latestAnalysis: MesocycleAnalysis | null;

  // Actions
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserVolumeProfile>) => Promise<void>;
}

/**
 * Hook for accessing and managing adaptive volume data
 */
export function useAdaptiveVolume(): UseAdaptiveVolumeResult {
  const [volumeProfile, setVolumeProfile] = useState<UserVolumeProfile | null>(null);
  const [volumeData, setVolumeData] = useState<MuscleVolumeData[]>([]);
  const [previousWeekData, setPreviousWeekData] = useState<MuscleVolumeData[]>([]);
  // The week before `previousWeekData` — only the fatigue monitor reads it.
  const [earlierWeekData, setEarlierWeekData] = useState<MuscleVolumeData[]>([]);
  const [latestAnalysis, setLatestAnalysis] = useState<MesocycleAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { user: storeUser } = useUserStore();
  const { user: authUser } = useAuthUser();
  const userId = storeUser?.id || authUser?.id || null;
  const userExperience = storeUser?.experience;

  // Fetch volume data for current and previous week
  const fetchVolumeData = useCallback(async () => {
    if (!userId) {
      return;
    }

    try {
      const supabase = createUntypedClient();

      // Three consecutive rolling 7-local-day windows, newest first: this
      // week (the last 7 days including today), the week before, and the week
      // before that. Bounds are local-midnight INSTANTS — completed_at is a
      // timestamptz, and a bare local date would be read as midnight UTC (see
      // adaptiveVolumeWindows). "Now" comes from the app clock.
      const windows = adaptiveVolumeWindows(clockNow());
      const [currentWindow, previousWindow, earlierWindow] = windows;
      const oldestWindow = windows[windows.length - 1];

      // ALWAYS derive from set_logs. The weekly_muscle_volume stored-rows
      // fast-path (current + previous week) is gone: no production code ever
      // wrote that table, and stored aggregates would freeze stale-convention
      // (pre-group-cap) numbers over live derivation. Table dropped in
      // 20260730000001 so a future writer can't re-arm the trap.
      
      // Helper to process blocks into volume data
      const processBlocksIntoVolumeData = (
        blocks: ExerciseBlockFull[],
        weekStartStr: string
      ): MuscleVolumeData[] => {
        if (!blocks || blocks.length === 0) return [];

        // Calculate volume with the SHARED counter (retiring the old
        // primary-only tally): full credit to each coarse primary muscle,
        // 0.5x to coarse secondaries, so the learned table relearns on the
        // same counts every other surface displays. effectiveSets / RIR stay
        // primary-attributed (they gauge stimulus quality, not volume).
        const volumeByMuscle = new Map<MuscleGroup, { totalSets: number; effectiveSets: number; weightedSets: number; totalRIR: number; rirCount: number }>();
        const bump = (muscle: MuscleGroup) => {
          if (!volumeByMuscle.has(muscle)) {
            volumeByMuscle.set(muscle, { totalSets: 0, effectiveSets: 0, weightedSets: 0, totalRIR: 0, rirCount: 0 });
          }
          return volumeByMuscle.get(muscle)!;
        };

        blocks.forEach((block: ExerciseBlockFull) => {
          const exercise = block.exercises;
          if (!exercise?.primary_muscle) return;

          const workingSets = (block.set_logs || []).filter((s: SetLogRow) => !s.is_warmup);
          if (workingSets.length === 0) return;

          const effective = workingSets.filter((s: SetLogRow) => {
            const feedback = s.feedback as { repsInTank?: number; form?: string } | undefined;
            const rir = setRirOrFallback(s, 3);
            const form = feedback?.form ?? 'clean';
            return rir <= 3 && (form === 'clean' || form === 'some_breakdown');
          }).length;
          const rirValues = workingSets.map((s: SetLogRow) => setRirOrFallback(s, 2));
          // RIR-weighted Effective Volume for the same working sets (single
          // source of truth: services/effectiveVolume). Explicit feedback
          // RIR only — unknown weighs 1.0 (conservative, warned).
          const weightedVolume = sumEffectiveVolume(
            workingSets.map((s: SetLogRow) => rirFromFeedback(s.feedback)),
            exercise.name ?? exercise.primary_muscle ?? undefined
          );

          // Primary → coarse credit (weighted split for legacy coarse tags).
          const primaryCredits = resolvePrimaryMuscleCredits(exercise.primary_muscle);
          const primaryStd = new Set(primaryCredits.map((c) => c.muscle));
          const creditedCoarse = new Set<MuscleGroup>();
          for (const { muscle, weight } of primaryCredits) {
            const coarse = STANDARD_TO_COARSE[muscle] as MuscleGroup | undefined;
            if (!coarse) continue;
            const data = bump(coarse);
            data.totalSets += workingSets.length * weight;
            data.effectiveSets += effective * weight;
            data.weightedSets += weightedVolume * weight;
            for (const rir of rirValues) { data.totalRIR += rir * weight; data.rirCount += weight; }
            creditedCoarse.add(coarse);
          }

          // Secondary → 0.5x coarse credit (volume only), skipping any coarse
          // group the primary already fed. The weighted Effective Volume gets
          // the same fractional credit (it is a volume measure, unlike the
          // primary-attributed stimulus-quality fields).
          for (const secondary of exercise.secondary_muscles || []) {
            const standards = resolveMuscleToStandard(secondary);
            if (standards.length === 0) continue;
            const per = SECONDARY_MUSCLE_CREDIT / standards.length;
            for (const std of standards) {
              if (primaryStd.has(std)) continue;
              const coarse = STANDARD_TO_COARSE[std] as MuscleGroup | undefined;
              if (!coarse || creditedCoarse.has(coarse)) continue;
              const data = bump(coarse);
              data.totalSets += workingSets.length * per;
              data.weightedSets += weightedVolume * per;
            }
          }
        });

        return Array.from(volumeByMuscle.entries()).map(([muscle, data]) => ({
          id: `${muscle}-${weekStartStr}`,
          muscle,
          weekNumber: 1,
          mesocycleId: '',
          totalSets: Math.round(data.totalSets),
          workingSets: Math.round(data.totalSets),
          effectiveSets: Math.round(data.effectiveSets),
          effectiveVolumeSets: Math.round(data.weightedSets * 10) / 10,
          totalVolume: 0,
          averageRIR: data.rirCount > 0 ? data.totalRIR / data.rirCount : 2,
          averageFormScore: 0.8,
          exercisePerformance: [],
        }));
      };

      {
        // ONE fetch for all three windows, bucketed by the session's
        // completed_at. The windows tile exactly (half-open, calendar-day
        // steps), so a session lands in exactly one week.
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
              rpe,
              feedback
            )
          `)
          .eq('workout_sessions.user_id', userId!)
          .gte('workout_sessions.completed_at', oldestWindow.startISO)
          .lt('workout_sessions.completed_at', currentWindow.endISO)
          .eq('workout_sessions.state', 'completed');

        const blocksByWindow: ExerciseBlockFull[][] = windows.map(() => []);
        for (const block of (blocks as ExerciseBlockFull[] | null) ?? []) {
          const completedAt = (
            block.workout_sessions as { completed_at?: string | null } | null | undefined
          )?.completed_at;
          const index = adaptiveVolumeWindowIndex(completedAt, windows);
          if (index >= 0) blocksByWindow[index].push(block);
        }

        setVolumeData(processBlocksIntoVolumeData(blocksByWindow[0], currentWindow.startDay));
        // Week-over-week trend + fatigue history.
        setPreviousWeekData(
          processBlocksIntoVolumeData(blocksByWindow[1], previousWindow.startDay)
        );
        setEarlierWeekData(
          processBlocksIntoVolumeData(blocksByWindow[2], earlierWindow.startDay)
        );
      }
    } catch (err: unknown) {
      console.error('Failed to fetch volume data:', getErrorMessage(err));
    }
  }, [userId]);

  // Fetch latest mesocycle analysis
  const fetchLatestAnalysis = useCallback(async () => {
    if (!userId) return;

    try {
      const supabase = createUntypedClient();

      const { data } = await supabase
        .from('mesocycle_analyses')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setLatestAnalysis({
          id: data.id,
          mesocycleId: data.mesocycle_id,
          startDate: data.start_date,
          endDate: data.end_date,
          weeks: data.weeks,
          muscleVolumes: data.muscle_volumes || {},
          muscleOutcomes: data.muscle_outcomes || {},
          overallRecovery: data.overall_recovery || 'well_recovered',
        });
      }
    } catch {
      // Analysis might not exist yet - expected for new users
    }
  }, [userId]);

  // Fetch or create volume profile
  const fetchProfile = useCallback(async () => {
    if (!userId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // Try to fetch existing profile
      const { data: profileData, error: profileError } = await supabase
        .from('user_volume_profiles')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        // PGRST116 is "not found" - that's expected for new users
        throw profileError;
      }

      if (profileData) {
        // Parse stored profile
        const profile: UserVolumeProfile = {
          userId: profileData.user_id,
          updatedAt: new Date(profileData.updated_at),
          muscleTolerance: profileData.muscle_tolerance || {},
          globalRecoveryMultiplier: profileData.global_recovery_multiplier || 1.0,
          isEnhanced: profileData.is_enhanced || false,
          trainingAge: profileData.training_age || 'intermediate',
        };

        // One-time reset onto the secondary-credit counter: a profile stored
        // below the current counter version (or cleared to {} by the reset
        // migration) carries primary-only-calibrated thresholds. Rebuild
        // research baselines (preserving training age / enhanced flag) and
        // relearn from there, then persist so it happens once.
        const storedVersion = (profileData as { counter_version?: number }).counter_version ?? 0;
        const needsReset =
          storedVersion < VOLUME_COUNTER_VERSION ||
          Object.keys(profile.muscleTolerance).length === 0;
        if (needsReset) {
          const reset = resetVolumeProfileToBaseline(profile);
          setVolumeProfile(reset);
          await saveProfile(reset);
        } else {
          setVolumeProfile(profile);
        }
      } else {
        // Create initial profile based on user's experience level, seeded
        // with the canonical Enhanced Athlete Mode flag from the users row.
        const trainingAge = (userExperience || 'intermediate') as 'novice' | 'intermediate' | 'advanced';
        const { data: userRow } = await supabase
          .from('users')
          .select('enhanced_athlete_mode')
          .eq('id', userId!)
          .single();
        const initialProfile = createInitialVolumeProfile(
          userId!,
          trainingAge,
          userRow?.enhanced_athlete_mode === true
        );
        setVolumeProfile(initialProfile);

        // Optionally save to database
        await saveProfile(initialProfile);
      }

      // Fetch current week volume data
      await fetchVolumeData();

      // Fetch latest mesocycle analysis
      await fetchLatestAnalysis();

    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [userId, userExperience, fetchVolumeData, fetchLatestAnalysis]);

  // Save profile to database
  const saveProfile = async (profile: UserVolumeProfile) => {
    try {
      const supabase = createUntypedClient();

      await supabase
        .from('user_volume_profiles')
        .upsert({
          user_id: profile.userId,
          muscle_tolerance: profile.muscleTolerance,
          global_recovery_multiplier: profile.globalRecoveryMultiplier,
          is_enhanced: profile.isEnhanced,
          training_age: profile.trainingAge,
          counter_version: VOLUME_COUNTER_VERSION,
          updated_at: clockNow().toISOString(),
        });
    } catch (err: unknown) {
      console.error('Failed to save volume profile:', getErrorMessage(err));
    }
  };

  // Update profile
  const updateProfile = useCallback(async (updates: Partial<UserVolumeProfile>) => {
    if (!volumeProfile) return;

    const updated = { ...volumeProfile, ...updates, updatedAt: clockNow() };
    setVolumeProfile(updated);
    await saveProfile(updated);
  }, [volumeProfile]);

  // Calculate volume summary
  const volumeSummary = useMemo((): VolumeSummary[] => {
    if (!volumeProfile || volumeData.length === 0) {
      // Return default summary with baseline recommendations
      return MUSCLE_GROUPS.map(muscle => ({
        muscle,
        currentSets: 0,
        estimatedMEV: BASELINE_VOLUME_RECOMMENDATIONS[muscle]?.mev || 8,
        estimatedMRV: BASELINE_VOLUME_RECOMMENDATIONS[muscle]?.mrv || 20,
        percentOfMRV: 0,
        status: 'below_mev' as const,
        trend: 'stable' as const,
      }));
    }

    // Derive week-over-week trend from actual set_logs by comparing current
    // week (days 0–6) against previous week (days −13..−7). Previously this
    // was always [] because weekly_muscle_volume was never written; now real
    // data feeds the comparison so trend varies week to week.
    return getVolumeSummary(volumeData, previousWeekData, volumeProfile);
  }, [volumeProfile, volumeData, previousWeekData]);

  // Calculate fatigue alerts
  const fatigueAlerts = useMemo((): FatigueAlert[] => {
    if (!volumeProfile || volumeData.length === 0) return [];

    // The monitor compares weeks: it groups by muscle IN THE ORDER GIVEN and
    // skips any muscle with fewer than two entries. Handing it the current
    // week alone (as this did) meant every muscle had exactly one entry and
    // no alert could ever fire. Oldest week first, current week last.
    return assessCurrentFatigueStatus(
      [...earlierWeekData, ...previousWeekData, ...volumeData],
      volumeProfile
    );
  }, [volumeProfile, volumeData, previousWeekData, earlierWeekData]);

  // Load data on mount - only when user is available
  useEffect(() => {
    if (userId) {
      fetchProfile();
    }
  }, [userId, fetchProfile]);

  return {
    volumeProfile,
    isLoading,
    error,
    volumeSummary,
    fatigueAlerts,
    latestAnalysis,
    refreshProfile: fetchProfile,
    updateProfile,
  };
}


/**
 * Hook for getting volume tolerance for a specific muscle
 */
export function useMuscleTolerance(muscle: MuscleGroup) {
  const { volumeProfile, isLoading } = useAdaptiveVolume();

  const tolerance = useMemo(() => {
    if (!volumeProfile) {
      const baseline = BASELINE_VOLUME_RECOMMENDATIONS[muscle];
      return {
        estimatedMRV: baseline.mrv,
        estimatedMEV: baseline.mev,
        optimal: baseline.optimal,
        confidence: 'low' as const,
        dataPoints: 0,
      };
    }

    const t = volumeProfile.muscleTolerance[muscle];
    return {
      estimatedMRV: t.estimatedMRV,
      estimatedMEV: t.estimatedMEV,
      optimal: Math.round((t.estimatedMEV + t.estimatedMRV) / 2),
      confidence: t.confidence,
      dataPoints: t.dataPoints,
    };
  }, [volumeProfile, muscle]);

  return { tolerance, isLoading };
}
