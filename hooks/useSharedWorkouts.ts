'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { SharedWorkoutWithProfile, ShareType, Difficulty, UserProfile } from '@/types/social';

interface SharedWorkoutsOptions {
  type?: ShareType;
  difficulty?: Difficulty;
  muscleGroups?: string[];
  searchQuery?: string;
  limit?: number;
  userId?: string; // For viewing a specific user's shared workouts
  savedOnly?: boolean; // For viewing saved workouts
}

interface SharedWorkoutRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  workout_data: Record<string, unknown>;
  share_type: string;
  difficulty: string | null;
  duration_weeks: number | null;
  target_muscle_groups: string[];
  tags: string[];
  save_count: number;
  copy_count: number;
  view_count: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  user_profiles: {
    id: string;
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  };
}

export function useSharedWorkouts(options: SharedWorkoutsOptions = {}) {
  const { type, difficulty, muscleGroups, searchQuery, limit = 20, userId, savedOnly } = options;

  const [workouts, setWorkouts] = useState<SharedWorkoutWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  const fetchWorkouts = useCallback(async (loadMore = false) => {
    if (loadMore && !hasMore) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      let query;

      if (savedOnly && user) {
        // Fetch saved workouts
        query = supabase
          .from('saved_workouts' as never)
          .select(`
            shared_workout_id,
            shared_workouts!inner (
              id,
              user_id,
              title,
              description,
              workout_data,
              share_type,
              difficulty,
              duration_weeks,
              target_muscle_groups,
              tags,
              save_count,
              copy_count,
              view_count,
              is_public,
              created_at,
              updated_at,
              user_profiles!inner (
                id,
                user_id,
                username,
                display_name,
                avatar_url
              )
            )
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(limit);
      } else {
        // Fetch public workouts
        query = supabase
          .from('shared_workouts' as never)
          .select(`
            id,
            user_id,
            title,
            description,
            workout_data,
            share_type,
            difficulty,
            duration_weeks,
            target_muscle_groups,
            tags,
            save_count,
            copy_count,
            view_count,
            is_public,
            created_at,
            updated_at,
            user_profiles!inner (
              id,
              user_id,
              username,
              display_name,
              avatar_url
            )
          `)
          .eq('is_public', true)
          .order('created_at', { ascending: false })
          .limit(limit);

        // Apply filters
        if (userId) {
          query = query.eq('user_id', userId);
        }
        if (type) {
          query = query.eq('share_type', type);
        }
        if (difficulty) {
          query = query.eq('difficulty', difficulty);
        }
        if (muscleGroups && muscleGroups.length > 0) {
          query = query.overlaps('target_muscle_groups', muscleGroups);
        }
      }

      // Cursor pagination
      if (loadMore && cursor) {
        query = query.lt('created_at', cursor);
      }

      const { data, error: fetchError } = await query as { data: SharedWorkoutRow[] | null; error: Error | null };

      if (fetchError) throw fetchError;

      if (data) {
        // Get user's saved workout IDs
        let savedIds: Set<string> = new Set();
        if (user) {
          const { data: savedData } = (await supabase
            .from('saved_workouts' as never)
            .select('shared_workout_id')
            .eq('user_id', user.id)) as { data: { shared_workout_id: string }[] | null };

          if (savedData) {
            savedIds = new Set(savedData.map(s => s.shared_workout_id));
          }
        }

        // Transform data
        const transformed: SharedWorkoutWithProfile[] = data.map(workout => {
          // Handle saved workouts structure vs direct workouts
          const workoutData = savedOnly
            ? (workout as unknown as { shared_workouts: SharedWorkoutRow }).shared_workouts
            : workout;

          return {
            id: workoutData.id,
            user_id: workoutData.user_id,
            source_workout_id: null,
            source_mesocycle_id: null,
            title: workoutData.title,
            description: workoutData.description,
            workout_data: workoutData.workout_data as unknown as SharedWorkoutWithProfile['workout_data'],
            share_type: workoutData.share_type as ShareType,
            difficulty: workoutData.difficulty as Difficulty | null,
            duration_weeks: workoutData.duration_weeks,
            target_muscle_groups: workoutData.target_muscle_groups,
            save_count: workoutData.save_count,
            copy_count: workoutData.copy_count,
            view_count: workoutData.view_count,
            is_public: workoutData.is_public,
            created_at: workoutData.created_at,
            updated_at: workoutData.updated_at,
            user_profile: {
              id: workoutData.user_profiles.id,
              user_id: workoutData.user_profiles.user_id,
              username: workoutData.user_profiles.username,
              display_name: workoutData.user_profiles.display_name,
              avatar_url: workoutData.user_profiles.avatar_url,
              bio: null,
              profile_visibility: 'public',
              show_workouts: true,
              show_stats: true,
              show_progress_photos: false,
              follower_count: 0,
              following_count: 0,
              workout_count: 0,
              total_volume_kg: 0,
              training_experience: null,
              primary_goal: null,
              gym_name: null,
              badges: [],
              featured_achievement: null,
              created_at: '',
              updated_at: '',
            } as UserProfile,
            is_saved: savedIds.has(workoutData.id),
          };
        });

        if (loadMore) {
          setWorkouts(prev => [...prev, ...transformed]);
        } else {
          setWorkouts(transformed);
        }

        setHasMore(data.length === limit);
        if (data.length > 0) {
          const lastWorkout = savedOnly
            ? (data[data.length - 1] as unknown as { shared_workouts: SharedWorkoutRow }).shared_workouts
            : data[data.length - 1];
          setCursor(lastWorkout.created_at);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workouts';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [type, difficulty, muscleGroups, searchQuery, limit, userId, savedOnly, hasMore, cursor]);

  // Initial load and refetch when filters change
  useEffect(() => {
    setCursor(null);
    setHasMore(true);
    fetchWorkouts(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, difficulty, JSON.stringify(muscleGroups), searchQuery, userId, savedOnly]);

  const loadMore = useCallback(() => {
    fetchWorkouts(true);
  }, [fetchWorkouts]);

  const refresh = useCallback(() => {
    setCursor(null);
    setHasMore(true);
    fetchWorkouts(false);
  }, [fetchWorkouts]);

  const updateSavedStatus = useCallback((workoutId: string, saved: boolean) => {
    setWorkouts(prev => prev.map(w =>
      w.id === workoutId
        ? { ...w, is_saved: saved, save_count: w.save_count + (saved ? 1 : -1) }
        : w
    ));
  }, []);

  return {
    workouts,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    updateSavedStatus,
  };
}
