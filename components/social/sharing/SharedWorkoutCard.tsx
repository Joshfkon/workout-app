'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/social/profile';
import { formatSocialCount, getProfileUrl } from '@/lib/social';
import { cn } from '@/lib/utils';
import { SaveWorkoutButton } from './SaveWorkoutButton';
import type { SharedWorkoutWithProfile } from '@/types/social';

export interface SharedWorkoutCardProps {
  workout: SharedWorkoutWithProfile;
  currentUserId?: string;
  onSave?: (workoutId: string, saved: boolean) => void;
  className?: string;
}

function SharedWorkoutCardComponent({
  workout,
  currentUserId,
  onSave,
  className,
}: SharedWorkoutCardProps) {
  const { user_profile } = workout;
  const displayName = user_profile.display_name || user_profile.username;

  const getDifficultyColor = (difficulty: string | null) => {
    switch (difficulty) {
      case 'beginner':
        return 'bg-success-500/20 text-success-400';
      case 'intermediate':
        return 'bg-warning-500/20 text-warning-400';
      case 'advanced':
        return 'bg-error-500/20 text-error-400';
      default:
        return 'bg-surface-700 text-surface-400';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'single_workout':
        return 'Workout';
      case 'template':
        return 'Template';
      case 'program':
        return 'Program';
      default:
        return type;
    }
  };

  return (
    <Card className={cn('overflow-hidden hover:bg-surface-800/50 transition-colors', className)}>
      <Link href={`/dashboard/workouts/shared/${workout.id}`} className="block p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-surface-100 truncate mb-1">
              {workout.title}
            </h3>
            <div className="flex items-center gap-2 text-sm">
              <Link
                href={getProfileUrl(user_profile.username)}
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1.5 hover:underline"
              >
                <Avatar
                  src={user_profile.avatar_url}
                  name={displayName}
                  size="xs"
                />
                <span className="text-surface-400">{displayName}</span>
              </Link>
            </div>
          </div>

          {currentUserId && currentUserId !== workout.user_id && (
            <SaveWorkoutButton
              workoutId={workout.id}
              isSaved={workout.is_saved}
              onToggle={onSave}
            />
          )}
        </div>

        {/* Description */}
        {workout.description && (
          <p className="text-sm text-surface-400 line-clamp-2 mb-3">
            {workout.description}
          </p>
        )}

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mb-3">
          <span className={cn(
            'px-2 py-0.5 rounded text-xs font-medium',
            getDifficultyColor(workout.difficulty)
          )}>
            {workout.difficulty || 'All Levels'}
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-500/20 text-primary-400">
            {getTypeLabel(workout.share_type)}
          </span>
          {workout.target_muscle_groups.slice(0, 3).map((group) => (
            <span
              key={group}
              className="px-2 py-0.5 rounded text-xs font-medium bg-surface-700 text-surface-300"
            >
              {group}
            </span>
          ))}
          {workout.target_muscle_groups.length > 3 && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-surface-700 text-surface-400">
              +{workout.target_muscle_groups.length - 3}
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-surface-400">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span>{formatSocialCount(workout.save_count)}</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>{formatSocialCount(workout.copy_count)}</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <span>{formatSocialCount(workout.view_count)}</span>
          </div>

          {/* Workout info */}
          <div className="ml-auto flex items-center gap-2 text-surface-500">
            <span>{workout.workout_data.exercises.length} exercises</span>
            <span>•</span>
            <span>{workout.workout_data.total_sets} sets</span>
          </div>
        </div>
      </Link>
    </Card>
  );
}

export const SharedWorkoutCard = memo(SharedWorkoutCardComponent);
SharedWorkoutCard.displayName = 'SharedWorkoutCard';
