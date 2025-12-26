'use client';

import { memo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/social/profile';
import { formatRelativeTime, getProfileUrl, getReactionEmoji } from '@/lib/social';
import { formatWeight } from '@/lib/utils';
import { ReactionBar } from './ReactionBar';
import { CommentSection } from './CommentSection';
import type { ActivityWithProfile, WorkoutCompletedData, PersonalRecordData, StreakMilestoneData } from '@/types/social';

export interface ActivityCardProps {
  activity: ActivityWithProfile;
  currentUserId?: string;
  units?: 'kg' | 'lb';
  onReact?: (activityId: string, reactionType: string) => void;
  onUnreact?: (activityId: string) => void;
  onComment?: (activityId: string) => void;
  onCommentAdded?: () => void;
}

function ActivityCardComponent({
  activity,
  currentUserId,
  units = 'kg',
  onReact,
  onUnreact,
  onComment,
  onCommentAdded,
}: ActivityCardProps) {
  const { user_profile } = activity;
  const displayName = user_profile.display_name || user_profile.username;

  const renderActivityContent = () => {
    switch (activity.activity_type) {
      case 'workout_completed':
        return <WorkoutContent data={activity.activity_data as WorkoutCompletedData} units={units} />;
      case 'personal_record':
        return <PRContent data={activity.activity_data as PersonalRecordData} units={units} />;
      case 'streak_milestone':
        return <StreakContent data={activity.activity_data as StreakMilestoneData} />;
      default:
        return <DefaultContent type={activity.activity_type} />;
    }
  };

  const getActivityIcon = () => {
    switch (activity.activity_type) {
      case 'workout_completed':
        return '🏋️';
      case 'personal_record':
        return '🏆';
      case 'streak_milestone':
        return '🔥';
      case 'badge_earned':
        return '🎖️';
      case 'mesocycle_completed':
        return '📈';
      default:
        return '💪';
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <Link href={getProfileUrl(user_profile.username)}>
            <Avatar
              src={user_profile.avatar_url}
              name={displayName}
              size="md"
            />
          </Link>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={getProfileUrl(user_profile.username)}
                className="font-medium text-surface-100 hover:underline truncate"
              >
                {displayName}
              </Link>
              <span className="text-lg">{getActivityIcon()}</span>
            </div>
            <p className="text-sm text-surface-400">
              {formatRelativeTime(activity.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-4">
        {renderActivityContent()}
      </div>

      {/* Reactions */}
      <div className="px-4 pb-3 border-t border-surface-800 pt-3">
        <ReactionBar
          activityId={activity.id}
          reactionCount={activity.reaction_count}
          commentCount={activity.comment_count}
          userReaction={activity.user_reaction}
          currentUserId={currentUserId}
          onReact={onReact}
          onUnreact={onUnreact}
          onComment={onComment}
        />
      </div>

      {/* Comments Section */}
      <CommentSection
        activityId={activity.id}
        commentCount={activity.comment_count}
        currentUserId={currentUserId}
        onCommentAdded={onCommentAdded}
      />
    </Card>
  );
}

// Workout completed content
function WorkoutContent({ data, units }: { data: WorkoutCompletedData; units: 'kg' | 'lb' }) {
  return (
    <div className="space-y-3">
      <p className="text-surface-100">
        Completed <span className="font-semibold">{data.workout_name}</span>
      </p>

      {/* Stats row */}
      <div className="flex gap-4 text-sm">
        {data.duration_minutes && (
          <div>
            <span className="text-surface-400">Duration:</span>{' '}
            <span className="text-surface-200">{Math.round(data.duration_minutes)} min</span>
          </div>
        )}
        <div>
          <span className="text-surface-400">Sets:</span>{' '}
          <span className="text-surface-200">{data.total_sets}</span>
        </div>
        <div>
          <span className="text-surface-400">Volume:</span>{' '}
          <span className="text-surface-200">{formatWeight(data.total_volume_kg, units, 0)}</span>
        </div>
      </div>

      {/* Exercise list */}
      {data.exercises && data.exercises.length > 0 && (
        <div className="bg-surface-800 rounded-lg p-3 space-y-2">
          {data.exercises.map((exercise, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-surface-200">{exercise.name}</span>
              <span className="text-surface-400">
                {exercise.sets} sets • {formatWeight(exercise.top_set.weight_kg, units, 0)} × {exercise.top_set.reps}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* RPE if available */}
      {data.session_rpe && (
        <p className="text-sm text-surface-400">
          Session RPE: <span className="text-surface-200">{data.session_rpe}/10</span>
        </p>
      )}
    </div>
  );
}

// Personal record content
function PRContent({ data, units }: { data: PersonalRecordData; units: 'kg' | 'lb' }) {
  const formatValue = () => {
    if (data.unit === 'reps') return `${data.new_value} reps`;
    return formatWeight(data.new_value, units, 1);
  };

  const formatImprovement = () => {
    if (!data.previous_value) return null;
    const diff = data.new_value - data.previous_value;
    if (data.unit === 'reps') return `+${diff} reps`;
    return `+${formatWeight(diff, units, 1)}`;
  };

  return (
    <div className="space-y-2">
      <p className="text-surface-100">
        New <span className="font-semibold text-primary-400">{data.pr_type.toUpperCase()}</span> PR on{' '}
        <span className="font-semibold">{data.exercise_name}</span>!
      </p>

      <div className="flex items-center gap-3">
        <span className="text-3xl font-bold text-primary-400">{formatValue()}</span>
        {formatImprovement() && (
          <span className="text-success-400 text-sm font-medium">
            {formatImprovement()}
          </span>
        )}
      </div>
    </div>
  );
}

// Streak milestone content
function StreakContent({ data }: { data: StreakMilestoneData }) {
  const getMilestoneText = () => {
    switch (data.milestone_type) {
      case 'week':
        return `${data.streak_days} day streak! 🔥`;
      case 'month':
        return `${data.streak_days} days strong! 💪`;
      case 'hundred':
        return `${data.streak_days} day milestone! 🏆`;
      default:
        return `${data.streak_days} day streak!`;
    }
  };

  return (
    <div className="text-center py-2">
      <p className="text-2xl font-bold text-surface-100">{getMilestoneText()}</p>
      <p className="text-sm text-surface-400 mt-1">Consistency is key!</p>
    </div>
  );
}

// Default content for other activity types
function DefaultContent({ type }: { type: string }) {
  const messages: Record<string, string> = {
    badge_earned: 'Earned a new badge!',
    mesocycle_completed: 'Completed a training block!',
    followed_user: 'Started following someone new',
    shared_workout: 'Shared a workout',
  };

  return (
    <p className="text-surface-200">{messages[type] || 'Activity'}</p>
  );
}

export const ActivityCard = memo(ActivityCardComponent);
ActivityCard.displayName = 'ActivityCard';
