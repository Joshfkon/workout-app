'use client';

import { useState, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuthUser } from '@/hooks/useAuthUser';
import { fetchUserProfiles } from '@/lib/profiles';
import { feedCursorFilter, nextReactionCount, type FeedCursor } from '@/lib/social';
import {
  getBlockedUserIds,
  getServerBlockedUserIds,
  loadBlockedUserIds,
  subscribeBlockedUsers,
  toPostgrestInList,
} from '@/lib/moderation';
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
  const [cursor, setCursor] = useState<FeedCursor | null>(null);
  const { user: authUser, isLoading: isAuthLoading } = useAuthUser();
  const authUserId = authUser?.id ?? null;
  // Users the viewer has blocked: excluded in the query (so pages stay full)
  // and filtered again here so a block hides their posts immediately.
  const blockedIds = useSyncExternalStore(
    subscribeBlockedUsers,
    getBlockedUserIds,
    getServerBlockedUserIds
  );

  // Monotonic request id. Only the latest in-flight fetch is allowed to commit
  // results, so out-of-order responses and post-unmount responses are ignored.
  const requestIdRef = useRef(0);

  const fetchActivities = useCallback(async (loadMore = false) => {
    if (loadMore && !hasMore) return;

    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const user = authUser;

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
        // Tiebreak so the (created_at, id) cursor below never skips rows
        // that share a timestamp.
        .order('id', { ascending: false })
        .limit(limit);

      if (user) {
        const blocked = await loadBlockedUserIds(supabase, user.id);
        if (blocked.size > 0) {
          query = query.not('user_id', 'in', toPostgrestInList(blocked));
        }
      }

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
        query = query.or(feedCursorFilter(cursor));
      }

      const { data: activitiesData, error: fetchError } = await query as { data: any[] | null; error: any };

      // Ignore stale/out-of-order responses before doing any further work.
      if (!isCurrent()) return;

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
        const profilesMap = await fetchUserProfiles(supabase, userIds, 'full');

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

        // A later request may have superseded this one while we fetched
        // profiles/reactions; bail before committing if so.
        if (!isCurrent()) return;

        if (loadMore) {
          setActivities(prev => [...prev, ...transformed]);
        } else {
          setActivities(transformed);
        }

        // Page from the RAW rows, not the profile-filtered ones: a row dropped
        // for a missing profile must neither end pagination early nor move the
        // cursor backwards.
        const lastRow = activitiesData[activitiesData.length - 1];
        setHasMore(activitiesData.length === limit);
        setCursor({ createdAt: lastRow.created_at, id: lastRow.id });
      } else {
        // No activities found
        if (!isCurrent()) return;
        if (loadMore) {
          setHasMore(false);
        } else {
          setActivities([]);
          setHasMore(false);
        }
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('[useActivityFeed] Error loading activities:', err);
      const message = err instanceof Error ? err.message : 'Failed to load activities';
      setError(message);
    } finally {
      if (isCurrent()) {
        setIsLoading(false);
      }
    }
  }, [feedType, userId, limit, hasMore, cursor, authUser]);

  // Initial load. Waits for the session read: before it resolves `authUser`
  // is null and the "following" feed would fall through to the public feed.
  // Re-runs when the signed-in user changes.
  useEffect(() => {
    if (isAuthLoading) return;
    fetchActivities(false);
    // Invalidate any in-flight request on unmount / dependency change so its
    // response is discarded and never sets state on an unmounted component.
    return () => {
      requestIdRef.current++;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedType, userId, isAuthLoading, authUserId]);

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
          reaction_count: nextReactionCount(activity.reaction_count, wasReacted, isReacted),
        };
      }
      return activity;
    }));
  }, []);

  const visibleActivities = useMemo(
    () => (blockedIds.size === 0 ? activities : activities.filter(a => !blockedIds.has(a.user_id))),
    [activities, blockedIds]
  );

  return {
    activities: visibleActivities,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    updateActivityReaction,
  };
}
