'use client';

import { memo, forwardRef, type HTMLAttributes } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { formatSocialCount, getProfileUrl } from '@/lib/social';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from './Avatar';
import type { UserProfile, FollowRelationship } from '@/types/social';

export interface ProfileCardProps extends HTMLAttributes<HTMLDivElement> {
  profile: UserProfile;
  followRelationship?: FollowRelationship;
  isOwnProfile?: boolean;
  variant?: 'compact' | 'full';
  onFollow?: () => void;
  onUnfollow?: () => void;
  isFollowLoading?: boolean;
}

const ProfileCard = forwardRef<HTMLDivElement, ProfileCardProps>(
  (
    {
      profile,
      followRelationship,
      isOwnProfile = false,
      variant = 'compact',
      onFollow,
      onUnfollow,
      isFollowLoading = false,
      className,
      ...props
    },
    ref
  ) => {
    const displayName = profile.display_name || profile.username;

    const renderFollowButton = () => {
      if (isOwnProfile) {
        return (
          <Link href="/profile/edit">
            <Button variant="outline" size="sm">
              Edit Profile
            </Button>
          </Link>
        );
      }

      if (!followRelationship) return null;

      if (followRelationship.is_following) {
        return (
          <Button
            variant="secondary"
            size="sm"
            onClick={onUnfollow}
            isLoading={isFollowLoading}
          >
            Following
          </Button>
        );
      }

      if (followRelationship.follow_status === 'pending') {
        return (
          <Button variant="secondary" size="sm" disabled>
            Requested
          </Button>
        );
      }

      return (
        <Button
          variant="primary"
          size="sm"
          onClick={onFollow}
          isLoading={isFollowLoading}
        >
          Follow
        </Button>
      );
    };

    if (variant === 'compact') {
      return (
        <div
          ref={ref}
          className={cn('flex items-center gap-3', className)}
          {...props}
        >
          <Link href={getProfileUrl(profile.username)}>
            <Avatar
              src={profile.avatar_url}
              name={displayName}
              size="md"
            />
          </Link>

          <div className="flex-1 min-w-0">
            <Link
              href={getProfileUrl(profile.username)}
              className="block hover:opacity-80 transition-opacity"
            >
              <p className="text-sm font-medium text-surface-100 truncate">
                {displayName}
              </p>
              <p className="text-xs text-surface-400 truncate">
                @{profile.username}
              </p>
            </Link>
          </div>

          {renderFollowButton()}
        </div>
      );
    }

    // Full variant
    return (
      <Card
        ref={ref}
        className={cn('overflow-hidden', className)}
        padding="none"
        {...props}
      >
        {/* Header with avatar */}
        <div className="p-4 pb-0">
          <div className="flex items-start gap-4">
            <Link href={getProfileUrl(profile.username)}>
              <Avatar
                src={profile.avatar_url}
                name={displayName}
                size="xl"
              />
            </Link>

            <div className="flex-1 min-w-0 pt-1">
              <Link
                href={getProfileUrl(profile.username)}
                className="block hover:opacity-80 transition-opacity"
              >
                <h3 className="text-lg font-semibold text-surface-100 truncate">
                  {displayName}
                </h3>
                <p className="text-sm text-surface-400 truncate">
                  @{profile.username}
                </p>
              </Link>

              {profile.bio && (
                <p className="mt-2 text-sm text-surface-300 line-clamp-2">
                  {profile.bio}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center justify-around p-4 mt-2 border-t border-surface-800">
          <div className="text-center">
            <p className="text-lg font-semibold text-surface-100">
              {formatSocialCount(profile.workout_count)}
            </p>
            <p className="text-xs text-surface-400">Workouts</p>
          </div>

          <div className="w-px h-8 bg-surface-800" />

          <Link
            href={`${getProfileUrl(profile.username)}/followers`}
            className="text-center hover:opacity-80 transition-opacity"
          >
            <p className="text-lg font-semibold text-surface-100">
              {formatSocialCount(profile.follower_count)}
            </p>
            <p className="text-xs text-surface-400">Followers</p>
          </Link>

          <div className="w-px h-8 bg-surface-800" />

          <Link
            href={`${getProfileUrl(profile.username)}/following`}
            className="text-center hover:opacity-80 transition-opacity"
          >
            <p className="text-lg font-semibold text-surface-100">
              {formatSocialCount(profile.following_count)}
            </p>
            <p className="text-xs text-surface-400">Following</p>
          </Link>
        </div>

        {/* Action button */}
        <div className="p-4 pt-0">
          {renderFollowButton()}
        </div>

        {/* Optional badges */}
        {profile.badges.length > 0 && (
          <div className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {profile.badges.slice(0, 3).map((badge) => (
                <span
                  key={badge.id}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-surface-800 rounded-full"
                  title={badge.description}
                >
                  <span>{badge.icon}</span>
                  <span className="text-surface-300">{badge.name}</span>
                </span>
              ))}
              {profile.badges.length > 3 && (
                <span className="inline-flex items-center px-2 py-1 text-xs text-surface-400 bg-surface-800 rounded-full">
                  +{profile.badges.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {/* Training info */}
        {(profile.training_experience || profile.gym_name) && (
          <div className="px-4 pb-4 flex flex-wrap gap-2 text-xs text-surface-400">
            {profile.training_experience && (
              <span className="capitalize">{profile.training_experience}</span>
            )}
            {profile.training_experience && profile.gym_name && (
              <span>•</span>
            )}
            {profile.gym_name && <span>{profile.gym_name}</span>}
          </div>
        )}
      </Card>
    );
  }
);

ProfileCard.displayName = 'ProfileCard';

const MemoizedProfileCard = memo(ProfileCard);
MemoizedProfileCard.displayName = 'ProfileCard';

export { MemoizedProfileCard as ProfileCard };
