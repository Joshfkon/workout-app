'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import { useUserStore } from '@/stores';
import { useAuthUser } from '@/hooks/useAuthUser';
import { getLocalDateString } from '@/lib/utils';
import {
  type UserVolumeProfile,
  type MuscleVolumeData,
  type MesocycleAnalysis,
  type FatigueAlert,
  type VolumeSummary,
  createInitialVolumeProfile,
  assessCurrentFatigueStatus,
  getVolumeSummary,
  analyzeMesocycle,
  updateVolumeProfile,
  resetVolumeProfileToBaseline,
  VOLUME_COUNTER_VERSION,
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';
import { MUSCLE_GROUPS, resolveMuscleToStandard } from '@/types/schema';
import { resolvePrimaryMuscleCredits, SECONDARY_MUSCLE_CREDIT } from '@/services/volumeTracker';
import { STANDARD_TO_COARSE } from '@/app/(dashboard)/dashboard/_lib/weeklyVolume';
import type {
  ExerciseBlockFull,
  WeeklyMuscleVolumeRow,
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

      // Calculate rolling 7-day period (last 7 days including today)
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 6); // 7 days ago (including today = 6 days back)
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = getLocalDateString(weekStart);

      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekStartStr = getLocalDateString(prevWeekStart);
      
      const weekEnd = new Date(now);
      weekEnd.setHours(23, 59, 59, 999);
      const weekEndStr = weekEnd.toISOString();

      // Fetch current week volume
      const { data: currentData } = await supabase
        .from('weekly_muscle_volume')
        .select('*')
        .eq('user_id', userId!)
        .eq('week_start', weekStartStr);

      // Fetch previous week volume
      const { data: prevData } = await supabase
        .from('weekly_muscle_volume')
        .select('*')
        .eq('user_id', userId!)
        .eq('week_start', prevWeekStartStr);

      // If no pre-computed data, calculate from set logs
      if (!currentData || currentData.length === 0) {
        // Fetch exercise blocks and sets for current week
        const { data: blocks, error: blocksError } = await supabase
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
          .gte('workout_sessions.completed_at', weekStartStr)
          .lte('workout_sessions.completed_at', weekEndStr)
          .eq('workout_sessions.state', 'completed');

        if (blocks && blocks.length > 0) {

          // Calculate volume with the SHARED counter (retiring the old
          // primary-only tally): full credit to each coarse primary muscle,
          // 0.5x to coarse secondaries, so the learned table relearns on the
          // same counts every other surface displays. effectiveSets / RIR stay
          // primary-attributed (they gauge stimulus quality, not volume).
          const volumeByMuscle = new Map<MuscleGroup, { totalSets: number; effectiveSets: number; totalRIR: number; rirCount: number }>();
          const bump = (muscle: MuscleGroup) => {
            if (!volumeByMuscle.has(muscle)) {
              volumeByMuscle.set(muscle, { totalSets: 0, effectiveSets: 0, totalRIR: 0, rirCount: 0 });
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
              const rir = feedback?.repsInTank ?? (s.rpe ? 10 - s.rpe : 3);
              const form = feedback?.form ?? 'clean';
              return rir <= 3 && (form === 'clean' || form === 'some_breakdown');
            }).length;
            const rirValues = workingSets.map((s: SetLogRow) => s.feedback?.repsInTank ?? (s.rpe ? 10 - s.rpe : 2));

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
              for (const rir of rirValues) { data.totalRIR += rir * weight; data.rirCount += weight; }
              creditedCoarse.add(coarse);
            }

            // Secondary → 0.5x coarse credit (volume only), skipping any coarse
            // group the primary already fed.
            for (const secondary of exercise.secondary_muscles || []) {
              const standards = resolveMuscleToStandard(secondary);
              if (standards.length === 0) continue;
              const per = SECONDARY_MUSCLE_CREDIT / standards.length;
              for (const std of standards) {
                if (primaryStd.has(std)) continue;
                const coarse = STANDARD_TO_COARSE[std] as MuscleGroup | undefined;
                if (!coarse || creditedCoarse.has(coarse)) continue;
                bump(coarse).totalSets += workingSets.length * per;
              }
            }
          });

          const calculatedData: MuscleVolumeData[] = Array.from(volumeByMuscle.entries()).map(([muscle, data]) => ({
            id: `${muscle}-${weekStartStr}`,
            muscle,
            weekNumber: 1,
            mesocycleId: '',
            totalSets: Math.round(data.totalSets),
            workingSets: Math.round(data.totalSets),
            effectiveSets: Math.round(data.effectiveSets),
            totalVolume: 0,
            averageRIR: data.rirCount > 0 ? data.totalRIR / data.rirCount : 2,
            averageFormScore: 0.8,
            exercisePerformance: [],
          }));

          setVolumeData(calculatedData);
        }
      } else {
        // Use pre-computed data
        const mapped: MuscleVolumeData[] = currentData.map((row: WeeklyMuscleVolumeRow) => ({
          id: row.id || `${row.muscle_group}-${weekStartStr}`,
          muscle: row.muscle_group as MuscleGroup,
          weekNumber: 1,
          mesocycleId: row.mesocycle_id || '',
          totalSets: row.total_sets,
          workingSets: row.total_sets,
          effectiveSets: row.effective_sets || row.total_sets,
          totalVolume: 0,
          averageRIR: row.average_rir || 2,
          averageFormScore: row.average_form_score || 0.8,
          exercisePerformance: [],
        }));
        setVolumeData(mapped);
      }

      if (prevData && prevData.length > 0) {
        const mapped: MuscleVolumeData[] = prevData.map((row: WeeklyMuscleVolumeRow) => ({
          id: row.id || `${row.muscle_group}-${prevWeekStartStr}`,
          muscle: row.muscle_group as MuscleGroup,
          weekNumber: 0,
          mesocycleId: row.mesocycle_id || '',
          totalSets: row.total_sets,
          workingSets: row.total_sets,
          effectiveSets: row.effective_sets || row.total_sets,
          totalVolume: 0,
          averageRIR: row.average_rir || 2,
          averageFormScore: row.average_form_score || 0.8,
          exercisePerformance: [],
        }));
        setPreviousWeekData(mapped);
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
          updated_at: new Date().toISOString(),
        });
    } catch (err: unknown) {
      console.error('Failed to save volume profile:', getErrorMessage(err));
    }
  };

  // Update profile
  const updateProfile = useCallback(async (updates: Partial<UserVolumeProfile>) => {
    if (!volumeProfile) return;

    const updated = { ...volumeProfile, ...updates, updatedAt: new Date() };
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

    return getVolumeSummary(volumeData, previousWeekData, volumeProfile);
  }, [volumeProfile, volumeData, previousWeekData]);

  // Calculate fatigue alerts
  const fatigueAlerts = useMemo((): FatigueAlert[] => {
    if (!volumeProfile || volumeData.length === 0) return [];

    // Get recent data (last 3 weeks would come from historical data)
    // For now, use current week data
    return assessCurrentFatigueStatus(volumeData, volumeProfile);
  }, [volumeProfile, volumeData]);

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
 * Run the end-of-mesocycle volume-learning loop.
 *
 * Closes the adaptive-volume feedback loop that was previously dead code:
 *   1. Aggregates that mesocycle's weekly_muscle_volume rows into per-muscle
 *      weekly series.
 *   2. Calls analyzeMesocycle() to score volume vs. outcomes.
 *   3. Persists the analysis into mesocycle_analyses (so /dashboard/volume/review
 *      can surface latestAnalysis).
 *   4. Calls updateVolumeProfile() to grow muscleTolerance.dataPoints / confidence
 *      and upserts the result into user_volume_profiles (same shape the hook reads).
 *
 * Pure-data-fetch + pure-service composition; safe to call once when a mesocycle
 * transitions to 'completed'. Idempotent at the DB layer thanks to the
 * UNIQUE(user_id, mesocycle_id) constraint on mesocycle_analyses.
 *
 * Returns true if an analysis was written, false otherwise (e.g. no volume data
 * yet, or an error — errors are swallowed/logged so the UI flow is never blocked).
 */
export async function runMesocycleCompletionAnalysis(
  userId: string,
  mesocycleId: string,
  options?: {
    startDate?: string | null;
    endDate?: string | null;
    experience?: 'novice' | 'intermediate' | 'advanced';
  }
): Promise<boolean> {
  if (!userId || !mesocycleId) return false;

  try {
    const supabase = createUntypedClient();

    // 1. Pull this mesocycle's weekly volume rows, ordered chronologically so
    //    each muscle's array is week-1 -> week-N (analyzeMesocycle is order-sensitive).
    //    NOTE: weekly_muscle_volume has no mesocycle_id column (the slim initial
    //    schema is the one that applied), so scope by the mesocycle's date window
    //    via week_start instead of filtering on mesocycle_id.
    let weeklyQuery = supabase
      .from('weekly_muscle_volume')
      .select('*')
      .eq('user_id', userId);
    if (options?.startDate) weeklyQuery = weeklyQuery.gte('week_start', options.startDate);
    if (options?.endDate) weeklyQuery = weeklyQuery.lte('week_start', options.endDate);
    const { data: weeklyRows, error: weeklyError } = await weeklyQuery.order('week_start', {
      ascending: true,
    });

    if (weeklyError) {
      console.error('runMesocycleCompletionAnalysis: failed to load weekly volume:', weeklyError);
      return false;
    }

    let rows = (weeklyRows as WeeklyMuscleVolumeRow[]) || [];
    if (rows.length === 0) {
      // No aggregated volume for this meso yet -> nothing to learn from.
      return false;
    }

    // Deload weeks must be excluded from MEV/MRV *learning* (a light week would
    // bias the learned landmarks downward), even though those same sets still
    // count on the volume displays. weekly_muscle_volume carries no deload
    // flag, so identify deload weeks from the sessions themselves: a week_start
    // bucket (its rolling 7-day window) whose completed sessions are ALL
    // deload-flagged is dropped from the learning input.
    const { data: windowSessions } = await supabase
      .from('workout_sessions')
      .select('completed_at, is_deload')
      .eq('user_id', userId)
      .eq('state', 'completed')
      .not('completed_at', 'is', null);

    const deloadWeekStarts = new Set<string>();
    const allWeekStarts = Array.from(new Set(rows.map((r) => r.week_start))).sort();
    if (windowSessions && windowSessions.length > 0) {
      for (const ws of allWeekStarts) {
        const start = new Date(`${ws}T00:00:00`);
        const end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        const inWeek = windowSessions.filter((s: { completed_at: string | null; is_deload?: boolean | null }) => {
          if (!s.completed_at) return false;
          const t = new Date(s.completed_at);
          return t >= start && t <= end;
        });
        if (inWeek.length > 0 && inWeek.every((s: { is_deload?: boolean | null }) => s.is_deload)) {
          deloadWeekStarts.add(ws);
        }
      }
    }
    if (deloadWeekStarts.size > 0) {
      rows = rows.filter((r) => !deloadWeekStarts.has(r.week_start));
      if (rows.length === 0) return false;
    }

    // Build Record<MuscleGroup, MuscleVolumeData[]> grouped by muscle, in week order.
    const muscleData: Record<MuscleGroup, MuscleVolumeData[]> = {} as Record<MuscleGroup, MuscleVolumeData[]>;
    const weekIndexByStart = new Map<string, number>();
    const orderedStarts = Array.from(new Set(rows.map((r) => r.week_start))).sort();
    orderedStarts.forEach((ws, idx) => weekIndexByStart.set(ws, idx + 1));

    for (const row of rows) {
      const muscle = row.muscle_group as MuscleGroup;
      if (!muscleData[muscle]) muscleData[muscle] = [];
      muscleData[muscle].push({
        id: row.id || `${muscle}-${row.week_start}`,
        muscle,
        weekNumber: weekIndexByStart.get(row.week_start) ?? muscleData[muscle].length + 1,
        mesocycleId,
        totalSets: row.total_sets,
        workingSets: row.total_sets,
        effectiveSets: row.effective_sets ?? row.total_sets,
        totalVolume: 0,
        averageRIR: row.average_rir ?? 2,
        averageFormScore: row.average_form_score ?? 0.8,
        exercisePerformance: [],
      });
    }

    // 2. Load (or synthesize) the user's current volume profile.
    const { data: profileData } = await supabase
      .from('user_volume_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    let currentProfile: UserVolumeProfile;
    if (profileData) {
      currentProfile = {
        userId: profileData.user_id,
        updatedAt: new Date(profileData.updated_at),
        muscleTolerance: profileData.muscle_tolerance || {},
        globalRecoveryMultiplier: profileData.global_recovery_multiplier || 1.0,
        isEnhanced: profileData.is_enhanced || false,
        trainingAge: profileData.training_age || 'intermediate',
      };
    } else {
      const trainingAge = (options?.experience || 'intermediate');
      currentProfile = createInitialVolumeProfile(userId, trainingAge, false);
    }

    // Date range for the analysis record. Fall back to the volume rows' span.
    const startDate = options?.startDate || orderedStarts[0];
    const endDate = options?.endDate || orderedStarts[orderedStarts.length - 1];

    // 3. Pure service: analyze the mesocycle.
    const analysis = analyzeMesocycle(mesocycleId, muscleData, currentProfile, startDate, endDate);

    // Persist analysis (UNIQUE(user_id, mesocycle_id) -> upsert is idempotent).
    const { error: analysisError } = await supabase
      .from('mesocycle_analyses')
      .upsert(
        {
          user_id: userId,
          mesocycle_id: mesocycleId,
          start_date: analysis.startDate,
          end_date: analysis.endDate,
          weeks: analysis.weeks,
          muscle_volumes: analysis.muscleVolumes,
          muscle_outcomes: analysis.muscleOutcomes,
          overall_recovery: analysis.overallRecovery,
        },
        { onConflict: 'user_id,mesocycle_id' }
      );

    if (analysisError) {
      console.error('runMesocycleCompletionAnalysis: failed to persist analysis:', analysisError);
      return false;
    }

    // 4. Pure service: learn from the analysis, then persist the grown profile
    //    using the same upsert shape useAdaptiveVolume.saveProfile uses.
    const learnedProfile = updateVolumeProfile(currentProfile, analysis);
    const { error: profileError } = await supabase
      .from('user_volume_profiles')
      .upsert({
        user_id: learnedProfile.userId,
        muscle_tolerance: learnedProfile.muscleTolerance,
        global_recovery_multiplier: learnedProfile.globalRecoveryMultiplier,
        is_enhanced: learnedProfile.isEnhanced,
        training_age: learnedProfile.trainingAge,
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error('runMesocycleCompletionAnalysis: failed to persist learned profile:', profileError);
      // Analysis was still written, so the review page populates. Treat as partial success.
    }

    return true;
  } catch (err) {
    console.error('runMesocycleCompletionAnalysis: unexpected error:', err);
    return false;
  }
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
