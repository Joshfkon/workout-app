'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/social/profile/Avatar';
import { SaveWorkoutButton } from './SaveWorkoutButton';
import { formatDistanceToNow } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { SharedWorkoutWithProfile, Difficulty } from '@/types/social';

interface SharedWorkoutCardProps {
  workout: SharedWorkoutWithProfile;
  onSave?: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
  onUnsave?: (workoutId: string) => Promise<{ success: boolean; error?: string }>;
  onCopy?: (workout: SharedWorkoutWithProfile) => void;
  showFullDetails?: boolean;
}

const difficultyColors: Record<Difficulty, string> = {
  beginner: 'bg-success-500/20 text-success-400',
  intermediate: 'bg-warning-500/20 text-warning-400',
  advanced: 'bg-error-500/20 text-error-400',
};

export function SharedWorkoutCard({
  workout,
  onSave,
  onUnsave,
  onCopy,
  showFullDetails = false,
}: SharedWorkoutCardProps) {
  const [isExpanded, setIsExpanded] = useState(showFullDetails);

  const exerciseCount = workout.workout_data?.exercises?.length || 0;
  const totalSets = workout.workout_data?.total_sets || 0;
  const duration = workout.workout_data?.estimated_duration_minutes || 0;

  return (
    <Card className="overflow-hidden hover:border-surface-700 transition-colors">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={`/dashboard/profile/${workout.user_profile.username}`}>
              <Avatar
                src={workout.user_profile.avatar_url}
                name={workout.user_profile.display_name || workout.user_profile.username}
                size="sm"
              />
            </Link>
            <div className="min-w-0">
              <Link
                href={`/dashboard/profile/${workout.user_profile.username}`}
                className="text-sm font-medium text-surface-200 hover:text-surface-100"
              >
                {workout.user_profile.display_name || workout.user_profile.username}
              </Link>
              <p className="text-xs text-surface-500">
                @{workout.user_profile.username} &middot; {formatDistanceToNow(workout.created_at)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {workout.difficulty && (
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                  difficultyColors[workout.difficulty]
                )}
              >
                {workout.difficulty}
              </span>
            )}
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-800 text-surface-400 capitalize">
              {workout.share_type.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Title and description */}
        <div className="mt-3">
          <Link
            href={`/dashboard/discover/${workout.id}`}
            className="text-lg font-semibold text-surface-100 hover:text-primary-400 transition-colors"
          >
            {workout.title}
          </Link>
          {workout.description && (
            <p className="mt-1 text-sm text-surface-400 line-clamp-2">
              {workout.description}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="mt-4 flex items-center gap-4 text-sm text-surface-400">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span>{exerciseCount} exercises</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <span>{totalSets} sets</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{duration} min</span>
          </div>
        </div>

        {/* Muscle groups */}
        {workout.target_muscle_groups && workout.target_muscle_groups.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {workout.target_muscle_groups.slice(0, 5).map((muscle) => (
              <span
                key={muscle}
                className="px-2 py-0.5 rounded-full text-xs bg-primary-500/10 text-primary-400 capitalize"
              >
                {muscle}
              </span>
            ))}
            {workout.target_muscle_groups.length > 5 && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-surface-800 text-surface-400">
                +{workout.target_muscle_groups.length - 5} more
              </span>
            )}
          </div>
        )}

        {/* Expandable exercise list */}
        {isExpanded && workout.workout_data?.exercises && (
          <div className="mt-4 p-3 bg-surface-800/50 rounded-lg">
            <p className="text-xs font-medium text-surface-400 mb-2">Exercises</p>
            <div className="space-y-2">
              {workout.workout_data.exercises.map((exercise, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-surface-200">{exercise.exercise_name}</span>
                  <span className="text-surface-400">
                    {exercise.sets} x {exercise.rep_range[0]}-{exercise.rep_range[1]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-4 py-3 bg-surface-800/30 border-t border-surface-800 flex items-center justify-between">
        <div className="flex items-center gap-4 text-xs text-surface-500">
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            {workout.save_count} saves
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {workout.copy_count} copies
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-3 py-1.5 text-xs font-medium text-surface-400 hover:text-surface-200 transition-colors"
          >
            {isExpanded ? 'Less' : 'More'}
          </button>
          {onCopy && (
            <button
              onClick={() => onCopy(workout)}
              className="px-3 py-1.5 text-xs font-medium bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg transition-colors"
            >
              Copy
            </button>
          )}
          {(onSave || onUnsave) && (
            <SaveWorkoutButton
              workoutId={workout.id}
              isSaved={workout.is_saved}
              onSave={onSave}
              onUnsave={onUnsave}
            />
          )}
        </div>
      </div>
    </Card>
  );
}
