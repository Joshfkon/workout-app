'use client';

import { memo, useState, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { useFollow } from '@/hooks/useFollow';
import type { ProfileVisibility } from '@/types/social';

export interface FollowButtonProps {
  targetUserId: string;
  targetProfileVisibility?: ProfileVisibility;
  initialIsFollowing?: boolean;
  initialFollowStatus?: 'none' | 'pending' | 'accepted' | 'rejected';
  size?: 'sm' | 'md' | 'lg';
  onFollowChange?: (isFollowing: boolean) => void;
  className?: string;
}

function FollowButtonComponent({
  targetUserId,
  targetProfileVisibility = 'public',
  size = 'sm',
  onFollowChange,
  className,
}: FollowButtonProps) {
  const [showUnfollowConfirm, setShowUnfollowConfirm] = useState(false);

  const { relationship, isLoading, follow, unfollow } = useFollow({
    targetUserId,
    targetProfileVisibility,
    onFollowChange,
  });

  const handleClick = useCallback(() => {
    if (relationship.is_following) {
      // Show confirmation or directly unfollow
      if (showUnfollowConfirm) {
        unfollow();
        setShowUnfollowConfirm(false);
      } else {
        setShowUnfollowConfirm(true);
        // Auto-reset after 3 seconds
        setTimeout(() => setShowUnfollowConfirm(false), 3000);
      }
    } else if (relationship.follow_status === 'pending') {
      // Cancel pending request
      unfollow();
    } else {
      // Follow
      follow();
    }
  }, [relationship, showUnfollowConfirm, follow, unfollow]);

  // Determine button appearance
  let variant: 'primary' | 'secondary' | 'danger' = 'primary';
  let label = 'Follow';

  if (relationship.is_following) {
    variant = showUnfollowConfirm ? 'danger' : 'secondary';
    label = showUnfollowConfirm ? 'Unfollow?' : 'Following';
  } else if (relationship.follow_status === 'pending') {
    variant = 'secondary';
    label = 'Requested';
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      isLoading={isLoading}
      className={className}
      onMouseLeave={() => setShowUnfollowConfirm(false)}
    >
      {label}
    </Button>
  );
}

export const FollowButton = memo(FollowButtonComponent);
FollowButton.displayName = 'FollowButton';
