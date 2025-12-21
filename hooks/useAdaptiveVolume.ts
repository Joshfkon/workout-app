'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore } from '@/stores';
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
  BASELINE_VOLUME_RECOMMENDATIONS,
} from '@/src/lib/training/adaptive-volume';
import type { MuscleGroup } from '@/types/schema';
import { MUSCLE_GROUPS } from '@/types/schema';

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

  const { user } = useUserStore();

  // Fetch or create volume profile
  const fetchProfile = useCallback(async () => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // Try to fetch existing profile
      const { data: profileData, error: profileError } = await supabase
        .from('user_volume_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

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
        setVolumeProfile(profile);
      } else {
        // Create initial profile based on user's experience level
        const trainingAge = user.experience || 'intermediate';
        const initialProfile = createInitialVolumeProfile(user.id, trainingAge, false);
        setVolumeProfile(initialProfile);

        // Optionally save to database
        await saveProfile(initialProfile);
      }

      // Fetch current week volume data
      await fetchVolumeData();

      // Fetch latest mesocycle analysis
      await fetchLatestAnalysis();

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load volume profile');
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, user?.experience]);

  // Fetch volume data for current and previous week
  const fetchVolumeData = useCallback(async () => {
    if (!user?.id) return;

    try {
      const supabase = createUntypedClient();

      // Calculate week boundaries
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now);
      weekStart.setDate(diff);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];

      // Fetch current week volume
      const { data: currentData } = await supabase
        .from('weekly_muscle_volume')
        .select('*')
        .eq('user_id', user.id)
        .eq('week_start', weekStartStr);

      // Fetch previous week volume
      const { data: prevData } = await supabase
        .from('weekly_muscle_volume')
        .select('*')
        .eq('user_id', user.id)
        .eq('week_start', prevWeekStartStr);

      if (currentData) {
        const mapped: MuscleVolumeData[] = currentData.map((row: any) => ({
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

      if (prevData) {
        const mapped: MuscleVolumeData[] = prevData.map((row: any) => ({
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
    } catch (err) {
      console.error('Failed to fetch volume data:', err);
    }
  }, [user?.id]);

  // Fetch latest mesocycle analysis
  const fetchLatestAnalysis = useCallback(async () => {
    if (!user?.id) return;

    try {
      const supabase = createUntypedClient();

      const { data } = await supabase
        .from('mesocycle_analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

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
    } catch (err) {
      // Analysis might not exist yet
      console.debug('No mesocycle analysis found:', err);
    }
  }, [user?.id]);

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
          updated_at: new Date().toISOString(),
        });
    } catch (err) {
      console.error('Failed to save volume profile:', err);
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
        estimatedMRV: BASELINE_VOLUME_RECOMMENDATIONS[muscle]?.mrv || 20,
        percentOfMRV: 0,
        status: 'low' as const,
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

  // Load data on mount
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

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
