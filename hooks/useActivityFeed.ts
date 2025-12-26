'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { ActivityWithProfile, ActivityReaction, ReactionType, ProfileVisibility, ActivityVisibility } from '@/types/social';

interface FeedOptions {
  feedType: 'following' | 'discover' | 'user';
  userId?: string;
  limit?: number;
}

interface ActivityRow {
  id: string;
  user_id: string;
  activity_type: string;
  activity_data: Record<string, unknown>;
  visibility: string;
  reaction_count: number;
  comment_count: number;
  created_at: string;
  user_profiles: {
    id: string;
    user_id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    profile_visibility: string;
    follower_count: number;
    following_count: number;
    workout_count: number;
  };
}

export function useActivityFeed({ feedType, userId, limit = 20 }: FeedOptions) {
  const [activities, setActivities] = useState<ActivityWithProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);

  const fetchActivities = useCallback(async (loadMore = false) => {
    if (loadMore && !hasMore) return;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      // Build base query for activities
      let query = supabase
        .from('activities' as never)
        .select(`
          id,
          user_id,
          activity_type,
          activity_data,
          visibility,
          reaction_count,
          comment_count,
          created_at
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

      // Apply filters based on feed type
      if (feedType === 'user' && userId) {
        query = query.eq('user_id', userId);
      } else if (feedType === 'following' && user) {
        // Get activities from users we follow
        const { data: following } = (await supabase
          .from('follows' as never)
          .select('following_id')
          .eq('follower_id', user.id)
          .eq('status', 'accepted')) as { data: { following_id: string }[] | null };

        if (following && following.length > 0) {
          const followingIds = following.map(f => f.following_id);
          // Include own activities too
          followingIds.push(user.id);
          query = query.in('user_id', followingIds);
        } else {
          // Only show own activities if not following anyone
          query = query.eq('user_id', user.id);
        }
      } else {
        // Discover feed - show public activities
        query = query.eq('visibility', 'public');
      }

      // Cursor pagination
      if (loadMore && cursor) {
        query = query.lt('created_at', cursor);
      }

      const { data: activitiesData, error: fetchError } = await query as { data: any[] | null; error: any };

      if (fetchError) {
        console.error('[useActivityFeed] Query error:', fetchError);
        // Provide more helpful error messages
        if (fetchError.code === 'PGRST116' || fetchError.message?.includes('does not exist')) {
          throw new Error('Database tables not found. Please run the social features migrations in Supabase SQL Editor. See docs/SOCIAL_FEATURES_SETUP.md');
        }
        if (fetchError.code === '42703') {
          throw new Error(`Database column error: ${fetchError.message}. Please check if migrations were run correctly.`);
        }
        throw fetchError;
      }

      if (activitiesData && activitiesData.length > 0) {
        // Fetch user profiles for all activities
        const userIds = Array.from(new Set(activitiesData.map(a => a.user_id)));
        const { data: profilesData, error: profilesError } = await supabase
          .from('user_profiles' as never)
          .select('id, user_id, username, display_name, avatar_url, bio, profile_visibility, follower_count, following_count, workout_count')
          .in('user_id', userIds) as { data: any[] | null; error: any };

        if (profilesError) {
          console.error('[useActivityFeed] Profiles query error:', profilesError);
          // If user_profiles table doesn't exist, provide helpful error
          if (profilesError.code === 'PGRST116' || profilesError.message?.includes('does not exist')) {
            throw new Error('The user_profiles table does not exist. Please run migration 20241228000001_add_user_profiles.sql in Supabase SQL Editor. See docs/SOCIAL_FEATURES_SETUP.md');
          }
          // For other errors, we'll continue but activities without profiles won't show
        }

        // Create a map of user_id -> profile
        const profilesMap = new Map();
        if (profilesData && profilesData.length > 0) {
          profilesData.forEach(profile => {
            profilesMap.set(profile.user_id, profile);
          });
        }

        // Combine activities with profiles (only show activities that have profiles)
        const data: ActivityRow[] = activitiesData
          .filter(activity => {
            if (!profilesMap.has(activity.user_id)) {
              console.warn(`[useActivityFeed] Activity ${activity.id} has no user_profile for user ${activity.user_id}`);
              return false;
            }
            return true;
          })
          .map(activity => ({
            ...activity,
            user_profiles: profilesMap.get(activity.user_id)!,
          }));
        // Get current user's reactions for these activities
        let userReactions: Record<string, ActivityReaction> = {};

        if (user && data.length > 0) {
          const activityIds = data.map(a => a.id);
          const { data: reactions } = (await supabase
            .from('activity_reactions' as never)
            .select('activity_id, reaction_type')
            .eq('user_id', user.id)
            .in('activity_id', activityIds)) as { data: { activity_id: string; reaction_type: ReactionType }[] | null };

          if (reactions) {
            userReactions = reactions.reduce((acc, r) => {
              acc[r.activity_id] = {
                id: '',
                activity_id: r.activity_id,
                user_id: user.id,
                reaction_type: r.reaction_type,
                created_at: '',
              };
              return acc;
            }, {} as Record<string, ActivityReaction>);
          }
        }

        // Transform data
        const transformed: ActivityWithProfile[] = data.map(activity => ({
          id: activity.id,
          user_id: activity.user_id,
          activity_type: activity.activity_type as ActivityWithProfile['activity_type'],
          reference_type: null,
          reference_id: null,
          activity_data: activity.activity_data as unknown as ActivityWithProfile['activity_data'],
          visibility: activity.visibility as ActivityVisibility,
          reaction_count: activity.reaction_count,
          comment_count: activity.comment_count,
          created_at: activity.created_at,
          hidden_at: null,
          user_profile: {
            id: activity.user_profiles.id,
            user_id: activity.user_profiles.user_id,
            username: activity.user_profiles.username,
            display_name: activity.user_profiles.display_name,
            avatar_url: activity.user_profiles.avatar_url,
            bio: activity.user_profiles.bio,
            profile_visibility: activity.user_profiles.profile_visibility as ProfileVisibility,
            show_workouts: true,
            show_stats: true,
            show_progress_photos: false,
            follower_count: activity.user_profiles.follower_count,
            following_count: activity.user_profiles.following_count,
            workout_count: activity.user_profiles.workout_count,
            total_volume_kg: 0,
            training_experience: null,
            primary_goal: null,
            gym_name: null,
            badges: [],
            featured_achievement: null,
            created_at: '',
            updated_at: '',
          },
          user_reaction: userReactions[activity.id],
        }));

        if (loadMore) {
          setActivities(prev => [...prev, ...transformed]);
        } else {
          setActivities(transformed);
        }

        setHasMore(data.length === limit);
        if (data.length > 0) {
          setCursor(data[data.length - 1].created_at);
        } else {
          setHasMore(false);
        }
      } else {
        // No activities found
        if (loadMore) {
          setHasMore(false);
        } else {
          setActivities([]);
          setHasMore(false);
        }
      }
    } catch (err) {
      console.error('[useActivityFeed] Error loading activities:', err);
      const message = err instanceof Error ? err.message : 'Failed to load activities';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [feedType, userId, limit, hasMore, cursor]);

  // Initial load
  useEffect(() => {
    fetchActivities(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedType, userId]);

  const loadMore = useCallback(() => {
    fetchActivities(true);
  }, [fetchActivities]);

  const refresh = useCallback(() => {
    setCursor(null);
    setHasMore(true);
    fetchActivities(false);
  }, [fetchActivities]);

  const updateActivityReaction = useCallback((activityId: string, reaction: ActivityReaction | undefined) => {
    setActivities(prev => prev.map(activity => {
      if (activity.id === activityId) {
        const wasReacted = !!activity.user_reaction;
        const isReacted = !!reaction;
        return {
          ...activity,
          user_reaction: reaction,
          reaction_count: activity.reaction_count + (isReacted ? (wasReacted ? 0 : 1) : -1),
        };
      }
      return activity;
    }));
  }, []);

  return {
    activities,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    updateActivityReaction,
  };
}
