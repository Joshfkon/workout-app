'use client';

import { Card } from '@/components/ui/Card';
import { formatWeight } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { LeaderboardType } from '@/types/social';

interface UserRank {
  rank: number;
  score: number;
  previous_rank: number | null;
  rank_change: number;
  total_participants: number;
}

interface UserRankCardProps {
  userRank: UserRank | null;
  type: LeaderboardType;
  units: 'kg' | 'lb';
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
      return `${Math.floor(score)}`;
    case 'workout_streak':
      return `${Math.floor(score)}`;
    default:
      return score.toLocaleString();
  }
}

function getScoreLabel(type: LeaderboardType): string {
  switch (type) {
    case 'total_volume_week':
    case 'total_volume_month':
      return 'Total Volume';
    case 'exercise_1rm':
      return 'Estimated 1RM';
    case 'workouts_completed_week':
    case 'workouts_completed_month':
      return 'Workouts';
    case 'workout_streak':
      return 'Streak';
    default:
      return 'Score';
  }
}

export function UserRankCard({ userRank, type, units }: UserRankCardProps) {
  if (!userRank) {
    return (
      <Card className="p-4 bg-fill/50">
        <div className="text-center">
          <p className="text-ink-2">
            Complete workouts to appear on the leaderboard!
          </p>
        </div>
      </Card>
    );
  }

  const { rank, score, rank_change, total_participants } = userRank;
  const percentile = Math.round((1 - (rank / total_participants)) * 100);

  return (
    <Card className="p-4 bg-action/10 border-action/20">
      <div className="flex items-center justify-between">
        {/* Rank */}
        <div className="text-center">
          <p className="text-3xl font-bold text-ink">#{rank}</p>
          <p className="text-xs text-ink-2">Your Rank</p>
          {rank_change !== 0 && (
            <p
              className={cn(
                'text-xs flex items-center justify-center gap-0.5 mt-1',
                rank_change > 0 ? 'text-status-ok' : 'text-error-400'
              )}
            >
              {rank_change > 0 ? (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                  </svg>
                  Up {rank_change}
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  Down {Math.abs(rank_change)}
                </>
              )}
            </p>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-12 bg-sep" />

        {/* Score */}
        <div className="text-center">
          <p className="text-2xl font-bold text-ink">
            {formatScore(score, type, units)}
          </p>
          <p className="text-xs text-ink-2">{getScoreLabel(type)}</p>
        </div>

        {/* Divider */}
        <div className="w-px h-12 bg-sep" />

        {/* Percentile — suppressed for tiny cohorts (P2: "Top 1% of 1 lifters") */}
        <div className="text-center">
          {total_participants >= 10 ? (
            <>
              <p className="text-2xl font-bold text-action">
                Top {percentile > 0 ? percentile : 1}%
              </p>
              <p className="text-xs text-ink-2">
                of {total_participants} lifters
              </p>
            </>
          ) : (
            <>
              <p className="text-2xl font-bold text-action">
                {rank} of {total_participants}
              </p>
              <p className="text-xs text-ink-2">this board</p>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
