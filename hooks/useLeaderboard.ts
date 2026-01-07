import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/errors';
import type { LeaderboardType, LeaderboardEntryWithProfile } from '@/types/social';

interface UseLeaderboardOptions {
  type: LeaderboardType;
  exerciseId?: string;
  limit?: number;
}

interface UserRank {
  rank: number;
  score: number;
  previous_rank: number | null;
  rank_change: number;
  total_participants: number;
}

interface UseLeaderboardReturn {
  entries: LeaderboardEntryWithProfile[];
  userRank: UserRank | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
}

export function useLeaderboard({
  type,
  exerciseId,
  limit = 50,
}: UseLeaderboardOptions): UseLeaderboardReturn {
  const [entries, setEntries] = useState<LeaderboardEntryWithProfile[]>([]);
  const [userRank, setUserRank] = useState<UserRank | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const fetchLeaderboard = useCallback(async (loadMore = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const currentOffset = loadMore ? offset : 0;

      // Fetch leaderboard entries
      const { data, error: fetchError } = await supabase.rpc('get_leaderboard' as never, {
        p_type: type,
        p_exercise_id: exerciseId || null,
        p_limit: limit,
        p_offset: currentOffset,
      } as never);

      if (fetchError) throw fetchError;

      // Transform data to match our types
      const leaderboardData = (data || []) as Array<{
        id: string;
        user_id: string;
        score: number;
        rank: number;
        previous_rank: number | null;
        period_start: string;
        period_end: string;
        rank_change: number;
        username: string;
        display_name: string | null;
        avatar_url: string | null;
      }>;
      const transformedEntries: LeaderboardEntryWithProfile[] = leaderboardData.map((entry) => ({
        id: entry.id,
        user_id: entry.user_id,
        leaderboard_type: type,
        exercise_id: exerciseId || null,
        score: entry.score,
        rank: entry.rank,
        previous_rank: entry.previous_rank,
        period_start: entry.period_start,
        period_end: entry.period_end,
        rank_change: entry.rank_change,
        user_profile: {
          id: '',
          user_id: entry.user_id,
          username: entry.username,
          display_name: entry.display_name,
          avatar_url: entry.avatar_url,
          bio: null,
          profile_visibility: 'public' as const,
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
        },
      }));

      if (loadMore) {
        setEntries(prev => [...prev, ...transformedEntries]);
      } else {
        setEntries(transformedEntries);
      }

      setHasMore(transformedEntries.length === limit);
      setOffset(currentOffset + transformedEntries.length);

      // Fetch user's own rank if logged in
      if (user && !loadMore) {
        const { data: rankData } = await supabase.rpc('get_user_rank' as never, {
          p_user_id: user.id,
          p_type: type,
          p_exercise_id: exerciseId || null,
        } as never);

        const userRankData = rankData as UserRank[] | null;
        if (userRankData && userRankData.length > 0) {
          setUserRank(userRankData[0]);
        } else {
          setUserRank(null);
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [type, exerciseId, limit, offset]);

  const refresh = useCallback(async () => {
    setOffset(0);
    await fetchLeaderboard(false);
  }, [fetchLeaderboard]);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    await fetchLeaderboard(true);
  }, [hasMore, isLoading, fetchLeaderboard]);

  useEffect(() => {
    setOffset(0);
    fetchLeaderboard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, exerciseId]);

  return {
    entries,
    userRank,
    isLoading,
    error,
    refresh,
    loadMore,
    hasMore,
  };
}
