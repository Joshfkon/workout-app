import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SharedWorkoutWithProfile, ShareType, Difficulty } from '@/types/social';

interface UseSharedWorkoutsOptions {
  shareType?: ShareType | 'all';
  difficulty?: Difficulty | 'all';
  muscleGroups?: string[];
  searchQuery?: string;
  sortBy?: 'recent' | 'popular' | 'saves';
  limit?: number;
}

interface UseSharedWorkoutsReturn {
  workouts: SharedWorkoutWithProfile[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  saveWorkout: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
  unsaveWorkout: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
}

export function useSharedWorkouts(options: UseSharedWorkoutsOptions = {}): UseSharedWorkoutsReturn {
  const {
    shareType = 'all',
    difficulty = 'all',
    muscleGroups = [],
    searchQuery = '',
    sortBy = 'recent',
    limit = 20,
  } = options;

  const [workouts, setWorkouts] = useState<SharedWorkoutWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  const fetchWorkouts = useCallback(async (isLoadMore = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Query shared workouts first (without user_profiles join)
      let query = supabase
        .from('shared_workouts' as never)
        .select('*')
        .eq('is_public', true);

      // Apply filters
      if (shareType !== 'all') {
        query = query.eq('share_type', shareType);
      }
      if (difficulty !== 'all') {
        query = query.eq('difficulty', difficulty);
      }
      if (muscleGroups.length > 0) {
        query = query.overlaps('target_muscle_groups', muscleGroups);
      }
      if (searchQuery.trim()) {
        query = query.ilike('title', `%${searchQuery.trim()}%`);
      }

      // Apply sorting
      switch (sortBy) {
        case 'popular':
          query = query.order('view_count', { ascending: false });
          break;
        case 'saves':
          query = query.order('save_count', { ascending: false });
          break;
        case 'recent':
        default:
          query = query.order('created_at', { ascending: false });
          break;
      }

      // Apply pagination
      if (isLoadMore && cursor) {
        query = query.lt('created_at', cursor);
      }
      query = query.limit(limit);

      const { data: workoutsData, error: fetchError } = await query;

      if (fetchError) {
        console.error('Error fetching shared workouts:', fetchError);
        throw new Error(`Failed to load workouts: ${fetchError.message || fetchError.code || 'Unknown error'}`);
      }

      if (!workoutsData || workoutsData.length === 0) {
        setWorkouts([]);
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      // Get unique user IDs from workouts
      const userIds = Array.from(new Set(workoutsData.map((w: any) => w.user_id)));

      // Fetch user profiles and saved workouts in parallel (not sequentially)
      const [profilesResult, savedResult] = await Promise.all([
        // Fetch user profiles
        supabase
          .from('user_profiles' as never)
          .select('id, user_id, username, display_name, avatar_url, training_experience')
          .in('user_id', userIds),
        // Fetch saved workouts for current user (only if authenticated)
        user
          ? supabase
              .from('saved_workouts' as never)
              .select('shared_workout_id')
              .eq('user_id', user.id)
          : Promise.resolve({ data: null, error: null }),
      ]);

      const { data: profilesData, error: profilesError } = profilesResult;
      if (profilesError) {
        console.error('Error fetching user profiles:', profilesError);
        // Continue without profiles rather than failing completely
      }

      // Create a map of user_id -> profile
      const profilesMap = new Map();
      if (profilesData) {
        profilesData.forEach((profile: any) => {
          profilesMap.set(profile.user_id, profile);
        });
      }

      // Extract saved workout IDs
      const savedWorkouts = savedResult.data as Array<{ shared_workout_id: string }> | null;
      const savedIds: string[] = savedWorkouts?.map((s) => s.shared_workout_id) || [];

      // Transform data - filter out workouts without profiles
      const transformedWorkouts: SharedWorkoutWithProfile[] = (workoutsData || [])
        .filter((workout: any) => profilesMap.has(workout.user_id))
        .map((workout: any) => {
          const profile = profilesMap.get(workout.user_id);
          return {
            ...workout,
            user_profile: {
              id: profile.id,
              user_id: profile.user_id,
              username: profile.username,
              display_name: profile.display_name,
              avatar_url: profile.avatar_url,
              bio: null,
              profile_visibility: 'public' as const,
              show_workouts: true,
              show_stats: true,
              show_progress_photos: false,
              follower_count: 0,
              following_count: 0,
              workout_count: 0,
              total_volume_kg: 0,
              training_experience: profile.training_experience,
              primary_goal: null,
              gym_name: null,
              badges: [],
              featured_achievement: null,
              created_at: '',
              updated_at: '',
            },
            is_saved: savedIds.includes(workout.id),
          };
        });

      if (isLoadMore) {
        setWorkouts(prev => [...prev, ...transformedWorkouts]);
      } else {
        setWorkouts(transformedWorkouts);
      }

      setHasMore(transformedWorkouts.length === limit);
      if (transformedWorkouts.length > 0) {
        setCursor(transformedWorkouts[transformedWorkouts.length - 1].created_at);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workouts');
    } finally {
      setIsLoading(false);
    }
  }, [shareType, difficulty, muscleGroups, searchQuery, sortBy, limit, cursor]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchWorkouts(true);
  }, [hasMore, isLoading, fetchWorkouts]);

  const refresh = useCallback(async () => {
    setCursor(null);
    await fetchWorkouts(false);
  }, [fetchWorkouts]);

  const saveWorkout = useCallback(async (workoutId: string) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return { success: false, error: 'Must be logged in to save workouts' };
      }

      const { error: saveError } = await supabase
        .from('saved_workouts' as never)
        .insert({
          user_id: user.id,
          shared_workout_id: workoutId,
        } as never);

      if (saveError) {
        if (saveError.code === '23505') {
          return { success: false, error: 'Already saved' };
        }
        throw saveError;
      }

      // Update local state
      setWorkouts(prev =>
        prev.map(w =>
          w.id === workoutId
            ? { ...w, is_saved: true, save_count: w.save_count + 1 }
            : w
        )
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save' };
    }
  }, []);

  const unsaveWorkout = useCallback(async (workoutId: string) => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        return { success: false, error: 'Must be logged in' };
      }

      const { error: deleteError } = await supabase
        .from('saved_workouts' as never)
        .delete()
        .eq('user_id', user.id)
        .eq('shared_workout_id', workoutId);

      if (deleteError) throw deleteError;

      // Update local state
      setWorkouts(prev =>
        prev.map(w =>
          w.id === workoutId
            ? { ...w, is_saved: false, save_count: Math.max(0, w.save_count - 1) }
            : w
        )
      );

      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to unsave' };
    }
  }, []);

  useEffect(() => {
    setCursor(null);
    fetchWorkouts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareType, difficulty, muscleGroups.join(','), searchQuery, sortBy]);

  return {
    workouts,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    saveWorkout,
    unsaveWorkout,
  };
}
