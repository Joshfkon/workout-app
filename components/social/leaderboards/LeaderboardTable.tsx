'use client';

import { LeaderboardEntry } from './LeaderboardEntry';
import { Button } from '@/components/ui/Button';
import type { LeaderboardEntryWithProfile, LeaderboardType } from '@/types/social';

interface LeaderboardTableProps {
  entries: LeaderboardEntryWithProfile[];
  type: LeaderboardType;
  units: 'kg' | 'lb';
  currentUserId?: string;
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function LeaderboardTable({
  entries,
  type,
  units,
  currentUserId,
  isLoading = false,
  hasMore = false,
  onLoadMore,
}: LeaderboardTableProps) {
  if (entries.length === 0 && !isLoading) {
    return (
      <div className="text-center py-12">
        <p className="text-5xl mb-4">🏆</p>
        <h3 className="text-lg font-semibold text-surface-100 mb-2">
          No rankings yet
        </h3>
        <p className="text-surface-400 max-w-sm mx-auto">
          Complete workouts this week to appear on the leaderboard!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <LeaderboardEntry
          key={entry.id}
          entry={entry}
          type={type}
          units={units}
          isCurrentUser={entry.user_id === currentUserId}
        />
      ))}

      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="animate-spin h-6 w-6 border-2 border-surface-500 border-t-primary-500 rounded-full" />
        </div>
      )}

      {!isLoading && hasMore && onLoadMore && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" size="sm" onClick={onLoadMore}>
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
