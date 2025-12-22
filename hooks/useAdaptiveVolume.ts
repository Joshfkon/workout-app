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

  const { user: storeUser } = useUserStore();
  const [user, setUser] = useState(storeUser);
  
  // Also try to get user directly from Supabase auth as fallback
  useEffect(() => {
    async function loadUser() {
      if (storeUser?.id) {
        setUser(storeUser);
        return;
      }
      
      // Fallback: get user directly from Supabase
      try {
        const supabase = createUntypedClient();
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          console.log(`[useAdaptiveVolume] Got user from Supabase auth:`, authUser.id);
          setUser({ id: authUser.id } as any);
        }
      } catch (err) {
        console.error(`[useAdaptiveVolume] Error getting user from auth:`, err);
      }
    }
    loadUser();
  }, [storeUser]);

  // Fetch volume data for current and previous week
  const fetchVolumeData = useCallback(async () => {
    console.log(`[useAdaptiveVolume] fetchVolumeData called, user:`, user?.id);
    if (!user?.id) {
      console.log(`[useAdaptiveVolume] No user ID in fetchVolumeData, returning early`);
      return;
    }

    try {
      const supabase = createUntypedClient();

      // Calculate rolling 7-day period (last 7 days including today)
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 6); // 7 days ago (including today = 6 days back)
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      const prevWeekStart = new Date(weekStart);
      prevWeekStart.setDate(prevWeekStart.getDate() - 7);
      const prevWeekStartStr = prevWeekStart.toISOString().split('T')[0];
      
      const weekEnd = new Date(now);
      weekEnd.setHours(23, 59, 59, 999);
      const weekEndStr = weekEnd.toISOString();

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

      // If no pre-computed data, calculate from set logs
      if (!currentData || currentData.length === 0) {
        console.log(`[useAdaptiveVolume] No pre-computed data found, calculating from set logs for rolling 7-day period`);
        console.log(`[useAdaptiveVolume] Date calculation:`, {
          now: now.toISOString(),
          weekStart: weekStart.toISOString(),
          weekStartStr,
          weekEnd: weekEnd.toISOString(),
          weekEndStr,
          user_id: user.id
        });
        
        console.log(`[useAdaptiveVolume] Rolling 7-day range: ${weekStartStr} to ${weekEndStr}`);

        // Fetch exercise blocks and sets for current week
        console.log(`[useAdaptiveVolume] Querying exercise_blocks with filters:`, {
          user_id: user.id,
          completed_at_gte: weekStartStr,
          completed_at_lte: weekEndStr,
          state: 'completed'
        });
        
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
          .eq('workout_sessions.user_id', user.id)
          .gte('workout_sessions.completed_at', weekStartStr)
          .lte('workout_sessions.completed_at', weekEndStr)
          .eq('workout_sessions.state', 'completed');

        if (blocksError) {
          console.error('[useAdaptiveVolume] Error fetching blocks:', blocksError);
        }
        
        console.log(`[useAdaptiveVolume] Query result:`, {
          blocksCount: blocks?.length || 0,
          blocks: blocks?.slice(0, 3).map((b: any) => ({
            id: b.id,
            exercise_name: b.exercises?.name,
            primary_muscle: b.exercises?.primary_muscle,
            completed_at: b.workout_sessions?.completed_at,
            state: b.workout_sessions?.state,
            set_logs_count: b.set_logs?.length || 0
          }))
        });
        
        console.log(`[useAdaptiveVolume] Found ${blocks?.length || 0} exercise blocks for rolling 7-day period`);

        if (blocks && blocks.length > 0) {
          console.log(`[useAdaptiveVolume] Processing ${blocks.length} blocks`);
          
          // Calculate volume from blocks
          const volumeByMuscle = new Map<string, { totalSets: number; effectiveSets: number; totalRIR: number; rirCount: number }>();
          let processedBlocks = 0;
          let skippedBlocks = 0;
          
          blocks.forEach((block: any, index: number) => {
            if (index < 5) {
              console.log(`[useAdaptiveVolume] Block ${index + 1}/${blocks.length}:`, {
                block_id: block.id,
                exercise_id: block.exercise_id,
                exercise: block.exercises ? {
                  id: block.exercises.id,
                  name: block.exercises.name,
                  primary_muscle: block.exercises.primary_muscle
                } : null,
                workout_session: block.workout_sessions ? {
                  id: block.workout_sessions.id,
                  completed_at: block.workout_sessions.completed_at,
                  state: block.workout_sessions.state,
                  user_id: block.workout_sessions.user_id
                } : null,
                set_logs_count: block.set_logs?.length || 0,
                set_logs: block.set_logs?.slice(0, 2).map((s: any) => ({
                  id: s.id,
                  is_warmup: s.is_warmup,
                  weight_kg: s.weight_kg,
                  reps: s.reps
                }))
              });
            }
            
            const exercise = block.exercises;
            if (!exercise) {
              console.log(`[useAdaptiveVolume] Block ${block.id} has no exercise`);
              skippedBlocks++;
              return;
            }
            
            const allSets = block.set_logs || [];
            const workingSets = allSets.filter((s: any) => !s.is_warmup);
            
            if (workingSets.length === 0) {
              if (index < 5) {
                console.log(`[useAdaptiveVolume] Block ${block.id} (${exercise.name}) has no working sets (total sets: ${allSets.length}, warmups: ${allSets.filter((s: any) => s.is_warmup).length})`);
              }
              skippedBlocks++;
              return;
            }

            const primaryMuscle = exercise.primary_muscle?.toLowerCase();
            if (!primaryMuscle) {
              console.log(`[useAdaptiveVolume] Exercise ${exercise.name} has no primary_muscle`);
              skippedBlocks++;
              return;
            }
            
            if (index < 5) {
              console.log(`[useAdaptiveVolume] Block ${block.id}: ${exercise.name} (${primaryMuscle}) - ${workingSets.length} working sets`);
            }
            
            if (!volumeByMuscle.has(primaryMuscle)) {
              volumeByMuscle.set(primaryMuscle, { totalSets: 0, effectiveSets: 0, totalRIR: 0, rirCount: 0 });
            }
            const data = volumeByMuscle.get(primaryMuscle)!;
            data.totalSets += workingSets.length;
            
            // Count effective sets (RPE 7+ or RIR 0-3 with clean/some_breakdown form)
            const effective = workingSets.filter((s: any) => {
              const rir = s.feedback?.repsInTank ?? (s.rpe ? 10 - s.rpe : 3);
              const form = s.feedback?.form ?? 'clean';
              return rir <= 3 && (form === 'clean' || form === 'some_breakdown');
            });
            data.effectiveSets += effective.length;
            
            // Calculate average RIR
            workingSets.forEach((s: any) => {
              const rir = s.feedback?.repsInTank ?? (s.rpe ? 10 - s.rpe : 2);
              data.totalRIR += rir;
              data.rirCount += 1;
            });
            
            processedBlocks++;
          });

          console.log(`[useAdaptiveVolume] Processing summary:`, {
            totalBlocks: blocks.length,
            processedBlocks,
            skippedBlocks,
            musclesFound: volumeByMuscle.size,
            volumeByMuscle: Array.from(volumeByMuscle.entries()).map(([m, d]) => ({
              muscle: m,
              totalSets: d.totalSets,
              effectiveSets: d.effectiveSets
            }))
          });
          
          console.log(`[useAdaptiveVolume] Calculated volume for ${volumeByMuscle.size} muscles:`, Array.from(volumeByMuscle.entries()).map(([m, d]) => `${m}: ${d.totalSets} sets`));

          // Convert to MuscleVolumeData format
          const calculatedData: MuscleVolumeData[] = Array.from(volumeByMuscle.entries()).map(([muscle, data]) => ({
            id: `${muscle}-${weekStartStr}`,
            muscle: muscle as MuscleGroup,
            weekNumber: 1,
            mesocycleId: '',
            totalSets: data.totalSets,
            workingSets: data.totalSets,
            effectiveSets: data.effectiveSets,
            totalVolume: 0,
            averageRIR: data.rirCount > 0 ? data.totalRIR / data.rirCount : 2,
            averageFormScore: 0.8,
            exercisePerformance: [],
          }));
          
          console.log(`[useAdaptiveVolume] Setting volume data:`, calculatedData.map(d => `${d.muscle}: ${d.workingSets} sets`));
          setVolumeData(calculatedData);
        } else {
          console.log(`[useAdaptiveVolume] No blocks found for week ${weekStartStr}`);
        }
      } else {
        // Use pre-computed data
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

      if (prevData && prevData.length > 0) {
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

  // Fetch or create volume profile
  const fetchProfile = useCallback(async () => {
    console.log(`[useAdaptiveVolume] fetchProfile called, user:`, user?.id);
    if (!user?.id) {
      console.log(`[useAdaptiveVolume] No user ID, returning early`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createUntypedClient();

      // Try to fetch existing profile
      console.log(`[useAdaptiveVolume] Fetching existing profile for user ${user.id}`);
      const { data: profileData, error: profileError } = await supabase
        .from('user_volume_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profileError && profileError.code !== 'PGRST116') {
        // PGRST116 is "not found" - that's expected for new users
        console.error(`[useAdaptiveVolume] Error fetching profile:`, profileError);
        throw profileError;
      }

      if (profileData) {
        console.log(`[useAdaptiveVolume] Found existing profile`);
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
        console.log(`[useAdaptiveVolume] No existing profile, creating initial profile`);
        // Create initial profile based on user's experience level
        const trainingAge = user.experience || 'intermediate';
        const initialProfile = createInitialVolumeProfile(user.id, trainingAge, false);
        console.log(`[useAdaptiveVolume] Created initial profile:`, initialProfile);
        setVolumeProfile(initialProfile);

        // Optionally save to database
        await saveProfile(initialProfile);
        console.log(`[useAdaptiveVolume] Saved initial profile to database`);
      }

      // Fetch current week volume data
      console.log(`[useAdaptiveVolume] Calling fetchVolumeData`);
      await fetchVolumeData();

      // Fetch latest mesocycle analysis
      await fetchLatestAnalysis();

    } catch (err) {
      console.error(`[useAdaptiveVolume] Error in fetchProfile:`, err);
      setError(err instanceof Error ? err.message : 'Failed to load volume profile');
    } finally {
      setIsLoading(false);
      console.log(`[useAdaptiveVolume] fetchProfile completed, isLoading: false`);
    }
  }, [user?.id, user?.experience, fetchVolumeData, fetchLatestAnalysis]);

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
    console.log(`[useAdaptiveVolume] Calculating volumeSummary:`, {
      hasProfile: !!volumeProfile,
      volumeDataLength: volumeData.length,
      volumeData: volumeData.map(d => `${d.muscle}: ${d.workingSets} sets`),
    });
    
    if (!volumeProfile || volumeData.length === 0) {
      console.log(`[useAdaptiveVolume] Returning default summary (no profile or no data)`);
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

    const summary = getVolumeSummary(volumeData, previousWeekData, volumeProfile);
    console.log(`[useAdaptiveVolume] Calculated summary:`, summary.map(s => `${s.muscle}: ${s.currentSets}/${s.estimatedMEV} sets, status: ${s.status}`));
    return summary;
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
    console.log(`[useAdaptiveVolume] useEffect triggered:`, {
      hasUser: !!user,
      userId: user?.id,
      fetchProfileExists: !!fetchProfile,
      userObject: user
    });
    
    if (user?.id) {
      console.log(`[useAdaptiveVolume] User available (${user.id}), calling fetchProfile`);
      fetchProfile().catch(err => {
        console.error(`[useAdaptiveVolume] Error in fetchProfile:`, err);
      });
    } else {
      console.log(`[useAdaptiveVolume] User not available yet, waiting... (user:`, user, `)`);
    }
  }, [user, fetchProfile]);

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
