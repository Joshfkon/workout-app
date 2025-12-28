'use client';

import Link from 'next/link';
import { Avatar } from '@/components/social/profile/Avatar';
import { formatWeight } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { LeaderboardEntryWithProfile, LeaderboardType } from '@/types/social';

interface LeaderboardEntryProps {
  entry: LeaderboardEntryWithProfile;
  type: LeaderboardType;
  units: 'kg' | 'lb';
  isCurrentUser?: boolean;
}

function getRankBadge(rank: number): { emoji: string; className: string } | null {
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

function formatScore(score: number, type: LeaderboardType, units: 'kg' | 'lb'): string {
  switch (type) {
    case 'total_volume_week':
    case 'total_volume_month':
      return formatWeight(score, units, 0);
    case 'exercise_1rm':
      return formatWeight(score, units, 1);
    case 'workouts_completed_week':
    case 'workouts_completed_month':
      return `${Math.floor(score)} workouts`;
    case 'workout_streak':
      return `${Math.floor(score)} days`;
    default:
      return score.toLocaleString();
  }
}

export function LeaderboardEntry({
  entry,
  type,
  units,
  isCurrentUser = false,
}: LeaderboardEntryProps) {
  const rankBadge = getRankBadge(entry.rank);
  const rankChange = entry.rank_change;

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg transition-colors',
        isCurrentUser
          ? 'bg-primary-500/10 border border-primary-500/30'
          : 'bg-surface-800/50 hover:bg-surface-800'
      )}
    >
      {/* Rank */}
      <div className="w-10 flex-shrink-0 text-center">
        {rankBadge ? (
          <span className="text-2xl">{rankBadge.emoji}</span>
        ) : (
          <span className="text-lg font-bold text-surface-400">#{entry.rank}</span>
        )}
      </div>

      {/* User info */}
      <Link
        href={`/dashboard/profile/${entry.user_profile.username}`}
        className="flex items-center gap-3 flex-1 min-w-0"
      >
        <Avatar
          src={entry.user_profile.avatar_url}
          name={entry.user_profile.display_name || entry.user_profile.username}
          size="sm"
        />
        <div className="min-w-0">
          <p className="font-medium text-surface-100 truncate">
            {entry.user_profile.display_name || entry.user_profile.username}
            {isCurrentUser && (
              <span className="ml-2 text-xs text-primary-400">(You)</span>
            )}
          </p>
          <p className="text-xs text-surface-500">@{entry.user_profile.username}</p>
        </div>
      </Link>

      {/* Score */}
      <div className="text-right">
        <p className="font-bold text-surface-100">
          {formatScore(entry.score, type, units)}
        </p>
        {rankChange !== 0 && (
          <p
            className={cn(
              'text-xs flex items-center justify-end gap-0.5',
              rankChange > 0 ? 'text-success-400' : 'text-error-400'
            )}
          >
            {rankChange > 0 ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                +{rankChange}
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {rankChange}
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
