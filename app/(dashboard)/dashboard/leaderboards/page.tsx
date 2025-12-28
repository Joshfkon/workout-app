'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { LeaderboardTable, UserRankCard } from '@/components/social/leaderboards';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useUserStore } from '@/stores';
import { cn } from '@/lib/utils';
import type { LeaderboardType } from '@/types/social';

type TimeFrame = 'week' | 'month';

const LEADERBOARD_TABS: Array<{
  id: LeaderboardType;
  label: string;
  timeFrame: TimeFrame;
  description: string;
}> = [
  {
    id: 'total_volume_week',
    label: 'Weekly Volume',
    timeFrame: 'week',
    description: 'Total weight lifted this week',
  },
  {
    id: 'workouts_completed_week',
    label: 'Weekly Workouts',
    timeFrame: 'week',
    description: 'Workouts completed this week',
  },
  {
    id: 'total_volume_month',
    label: 'Monthly Volume',
    timeFrame: 'month',
    description: 'Total weight lifted this month',
  },
  {
    id: 'workouts_completed_month',
    label: 'Monthly Workouts',
    timeFrame: 'month',
    description: 'Workouts completed this month',
  },
];

export default function LeaderboardsPage() {
  const [selectedType, setSelectedType] = useState<LeaderboardType>('total_volume_week');
  const userId = useUserStore((state) => state.user?.id);
  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');

  const {
    entries,
    userRank,
    isLoading,
    error,
    refresh,
    loadMore,
    hasMore,
  } = useLeaderboard({ type: selectedType });

  const selectedTab = LEADERBOARD_TABS.find(t => t.id === selectedType);

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-surface-950/95 backdrop-blur-sm border-b border-surface-800">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-surface-100">Leaderboards</h1>
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

          {/* Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
            {LEADERBOARD_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedType(tab.id)}
                className={cn(
                  'px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors',
                  selectedType === tab.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-800 text-surface-400 hover:text-surface-200'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Description */}
        {selectedTab && (
          <p className="text-surface-400 text-sm">{selectedTab.description}</p>
        )}

        {/* User's rank card */}
        <UserRankCard userRank={userRank} type={selectedType} units={units} />

        {/* Error state */}
        {error && (
          <Card>
            <CardContent className="text-center py-8">
              <p className="text-error-400 mb-4">{error}</p>
              <Button onClick={refresh}>Try Again</Button>
            </CardContent>
          </Card>
        )}

        {/* Leaderboard */}
        {!error && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-2xl">🏆</span>
                Top Lifters
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeaderboardTable
                entries={entries}
                type={selectedType}
                units={units}
                currentUserId={userId}
                isLoading={isLoading}
                hasMore={hasMore}
                onLoadMore={loadMore}
              />
            </CardContent>
          </Card>
        )}

        {/* Info card */}
        <Card className="bg-surface-800/50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <svg
                className="w-5 h-5 text-surface-400 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-sm text-surface-400">
                <p className="font-medium text-surface-300 mb-1">How rankings work</p>
                <p>
                  Leaderboards update throughout the week as you complete workouts.
                  Only users who have opted in to leaderboards in their privacy settings are shown.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
