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

/** The podium (top three) gets a tinted rank pill; everyone else a plain number. */
function isPodium(rank: number): boolean {
  return rank >= 1 && rank <= 3;
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
  const rankChange = entry.rank_change;

  return (
    <div
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg transition-colors',
        isCurrentUser
          ? 'bg-action-tint'
          : 'bg-fill/50 hover:bg-fill'
      )}
    >
      {/* Rank */}
      <div className="w-10 flex-shrink-0 text-center">
        {isPodium(entry.rank) ? (
          <span
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-action-tint text-headline tabular-nums text-action"
            aria-label={`Rank ${entry.rank}`}
          >
            {entry.rank}
          </span>
        ) : (
          <span className="text-headline tabular-nums text-ink-2">#{entry.rank}</span>
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
          <p className="text-body font-medium text-ink truncate">
            {entry.user_profile.display_name || entry.user_profile.username}
            {isCurrentUser && (
              <span className="ml-2 text-caption text-action">(You)</span>
            )}
          </p>
          <p className="text-caption text-ink-3">@{entry.user_profile.username}</p>
        </div>
      </Link>

      {/* Score */}
      <div className="text-right">
        <p className="text-headline tabular-nums text-ink">
          {formatScore(entry.score, type, units)}
        </p>
        {rankChange !== 0 && (
          <p
            className={cn(
              'text-caption flex items-center justify-end gap-0.5',
              rankChange > 0 ? 'text-status-ok' : 'text-status-bad'
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
