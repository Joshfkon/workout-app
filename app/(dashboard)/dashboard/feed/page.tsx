'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { ActivityCard } from '@/components/social/feed';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useReactions } from '@/hooks/useReactions';
import { useUserStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { ReactionType, ActivityReaction } from '@/types/social';

type FeedType = 'following' | 'discover';

export default function FeedPage() {
  const [feedType, setFeedType] = useState<FeedType>('following');
  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');
  const userId = useUserStore((state) => state.user?.id);

  const {
    activities,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    updateActivityReaction,
  } = useActivityFeed({ feedType });

  const { addReaction, removeReaction } = useReactions();

  const handleReact = useCallback(async (activityId: string, reactionType: string) => {
    if (!userId) return;

    const typedReaction = reactionType as ReactionType;

    // Optimistic update
    updateActivityReaction(activityId, {
      id: '',
      activity_id: activityId,
      user_id: userId,
      reaction_type: typedReaction,
      created_at: new Date().toISOString(),
    });

    const result = await addReaction(activityId, typedReaction);
    if (!result.success) {
      // Revert on failure
      updateActivityReaction(activityId, undefined);
    }
  }, [userId, addReaction, updateActivityReaction]);

  const handleUnreact = useCallback(async (activityId: string) => {
    const activity = activities.find(a => a.id === activityId);
    const previousReaction = activity?.user_reaction;

    // Optimistic update
    updateActivityReaction(activityId, undefined);

    const result = await removeReaction(activityId);
    if (!result.success && previousReaction) {
      // Revert on failure
      updateActivityReaction(activityId, previousReaction);
    }
  }, [activities, removeReaction, updateActivityReaction]);

  const handleComment = useCallback((activityId: string) => {
    // Comment section is now integrated into ActivityCard
    // This callback can be used for scrolling to comments or other actions
    const element = document.getElementById(`activity-${activityId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const handleCommentAdded = useCallback(() => {
    // Refresh activities to update comment counts
    refresh();
  }, [refresh]);

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-surface-100">Activity Feed</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={isLoading}
            >
              <svg
                className={cn('w-5 h-5', isLoading && 'animate-spin')}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </Button>
          </div>

          {/* Feed tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setFeedType('following')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                feedType === 'following'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Following
            </button>
            <button
              onClick={() => setFeedType('discover')}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-colors',
                feedType === 'discover'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-800 text-surface-400 hover:text-surface-200'
              )}
            >
              Discover
            </button>
          </div>
        </div>
      </header>

      {/* Feed content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        {error && (
          <div className="text-center py-8">
            <p className="text-error-400 mb-4">{error}</p>
            <Button onClick={refresh}>Try Again</Button>
          </div>
        )}

        {!error && activities.length === 0 && !isLoading && (
          <div className="text-center py-16">
            <p className="text-5xl mb-4">
              {feedType === 'following' ? '👥' : '🌎'}
            </p>
            <h2 className="text-xl font-semibold text-surface-100 mb-2">
              {feedType === 'following'
                ? 'No activities yet'
                : 'Nothing to discover'}
            </h2>
            <p className="text-surface-400 max-w-sm mx-auto">
              {feedType === 'following'
                ? 'Follow other lifters to see their workouts and achievements here.'
                : 'Be the first to share your workout with the community!'}
            </p>
            {feedType === 'following' && (
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => setFeedType('discover')}
              >
                Discover Lifters
              </Button>
            )}
          </div>
        )}

        {/* Activity list */}
        <div className="space-y-4">
          {activities.map((activity) => (
            <div key={activity.id} id={`activity-${activity.id}`}>
              <ActivityCard
                activity={activity}
                currentUserId={userId}
                units={units}
                onReact={handleReact}
                onUnreact={handleUnreact}
                onComment={handleComment}
                onCommentAdded={handleCommentAdded}
              />
            </div>
          ))}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center py-8">
            <div className="animate-spin h-8 w-8 border-2 border-surface-500 border-t-primary-500 rounded-full" />
          </div>
        )}

        {/* Load more */}
        {!isLoading && hasMore && activities.length > 0 && (
          <div className="flex justify-center py-8">
            <Button
              variant="outline"
              onClick={loadMore}
            >
              Load More
            </Button>
          </div>
        )}

        {/* End of feed */}
        {!isLoading && !hasMore && activities.length > 0 && (
          <p className="text-center text-surface-500 py-8">
            You&apos;re all caught up! 💪
          </p>
        )}
      </main>
    </div>
  );
}
