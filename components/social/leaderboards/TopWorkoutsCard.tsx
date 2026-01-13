'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/social/profile/Avatar';
import { useSharedWorkouts } from '@/hooks/useSharedWorkouts';
import { cn } from '@/lib/utils';

function getRankDisplay(rank: number): { emoji: string; className: string } | null {
  switch (rank) {
    case 1:
      return { emoji: '🥇', className: 'bg-yellow-500/20 text-yellow-400' };
    case 2:
      return { emoji: '🥈', className: 'bg-gray-400/20 text-gray-300' };
    case 3:
      return { emoji: '🥉', className: 'bg-amber-600/20 text-amber-500' };
    default:
      return null;
  }
}

export function TopWorkoutsCard() {
  const { workouts, isLoading, error, refresh } = useSharedWorkouts({
    sortBy: 'popular',
    limit: 10,
  });

  if (error) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <p className="text-error-400 mb-4">{error}</p>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
          >
            Try Again
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-2xl">🔥</span>
          Top 10 Workouts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="flex items-center gap-3 p-3 bg-surface-800/50 rounded-lg">
                  <div className="w-10 h-6 bg-surface-700 rounded" />
                  <div className="w-8 h-8 bg-surface-700 rounded-full" />
                  <div className="flex-1">
                    <div className="h-4 bg-surface-700 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-surface-700 rounded w-1/2" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : workouts.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-surface-400 mb-2">No shared workouts yet</p>
            <p className="text-sm text-surface-500">
              Be the first to share a workout and appear on the leaderboard!
            </p>
            <Link
              href="/dashboard/discover"
              className="inline-block mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
            >
              Share a Workout
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {workouts.map((workout, index) => {
              const rank = index + 1;
              const rankDisplay = getRankDisplay(rank);

              return (
                <Link
                  key={workout.id}
                  href={`/dashboard/discover/${workout.id}`}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg transition-colors',
                    'bg-surface-800/50 hover:bg-surface-800'
                  )}
                >
                  {/* Rank */}
                  <div className="w-10 flex-shrink-0 text-center">
                    {rankDisplay ? (
                      <span className="text-2xl">{rankDisplay.emoji}</span>
                    ) : (
                      <span className="text-lg font-bold text-surface-400">#{rank}</span>
                    )}
                  </div>

                  {/* Creator avatar */}
                  <Avatar
                    src={workout.user_profile.avatar_url}
                    name={workout.user_profile.display_name || workout.user_profile.username}
                    size="sm"
                  />

                  {/* Workout info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-surface-100 truncate">
                      {workout.title}
                    </p>
                    <p className="text-xs text-surface-500 truncate">
                      by @{workout.user_profile.username}
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-xs text-surface-400 flex-shrink-0">
                    <span className="flex items-center gap-1" title="Views">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      {workout.view_count}
                    </span>
                    <span className="flex items-center gap-1" title="Saves">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                      </svg>
                      {workout.save_count}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
