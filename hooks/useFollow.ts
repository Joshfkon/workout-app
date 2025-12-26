'use client';

import { useState, useCallback, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { FollowRelationship, FollowStatus } from '@/types/social';

interface UseFollowOptions {
  targetUserId: string;
  targetProfileVisibility?: 'public' | 'followers_only' | 'private';
  onFollowChange?: (isFollowing: boolean) => void;
}

interface UseFollowReturn {
  relationship: FollowRelationship;
  isLoading: boolean;
  follow: () => Promise<void>;
  unfollow: () => Promise<void>;
  acceptRequest: () => Promise<void>;
  rejectRequest: () => Promise<void>;
}

export function useFollow({
  targetUserId,
  targetProfileVisibility = 'public',
  onFollowChange,
}: UseFollowOptions): UseFollowReturn {
  const [relationship, setRelationship] = useState<FollowRelationship>({
    is_following: false,
    is_followed_by: false,
    follow_status: 'none',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Load initial relationship
  useEffect(() => {
    const loadRelationship = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user || user.id === targetUserId) {
        return;
      }

      setCurrentUserId(user.id);

      // Check if current user follows target
      const { data: followData } = await supabase
        .from('follows')
        .select('status')
        .eq('follower_id', user.id)
        .eq('following_id', targetUserId)
        .single();

      // Check if target follows current user
      const { data: followedByData } = await supabase
        .from('follows')
        .select('status')
        .eq('follower_id', targetUserId)
        .eq('following_id', user.id)
        .eq('status', 'accepted')
        .single();

      setRelationship({
        is_following: followData?.status === 'accepted',
        is_followed_by: !!followedByData,
        follow_status: (followData?.status as FollowStatus) ?? 'none',
      });
    };

    loadRelationship();
  }, [targetUserId]);

  const follow = useCallback(async () => {
    if (!currentUserId || isLoading) return;

    setIsLoading(true);
    const supabase = createClient();

    // Determine status based on target's profile visibility
    const status: FollowStatus = targetProfileVisibility === 'private' ? 'pending' : 'accepted';

    const { error } = await supabase.from('follows').insert({
      follower_id: currentUserId,
      following_id: targetUserId,
      status,
      accepted_at: status === 'accepted' ? new Date().toISOString() : null,
    });

    if (!error) {
      setRelationship((prev) => ({
        ...prev,
        is_following: status === 'accepted',
        follow_status: status,
      }));

      if (status === 'accepted') {
        onFollowChange?.(true);
      }
    }

    setIsLoading(false);
  }, [currentUserId, targetUserId, targetProfileVisibility, isLoading, onFollowChange]);

  const unfollow = useCallback(async () => {
    if (!currentUserId || isLoading) return;

    setIsLoading(true);
    const supabase = createClient();

    const wasFollowing = relationship.is_following;

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', currentUserId)
      .eq('following_id', targetUserId);

    if (!error) {
      setRelationship((prev) => ({
        ...prev,
        is_following: false,
        follow_status: 'none',
      }));

      if (wasFollowing) {
        onFollowChange?.(false);
      }
    }

    setIsLoading(false);
  }, [currentUserId, targetUserId, isLoading, relationship.is_following, onFollowChange]);

  const acceptRequest = useCallback(async () => {
    if (!currentUserId || isLoading) return;

    setIsLoading(true);
    const supabase = createClient();

    // This is for when someone sent US a request
    const { error } = await supabase
      .from('follows')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('follower_id', targetUserId)
      .eq('following_id', currentUserId)
      .eq('status', 'pending');

    if (!error) {
      setRelationship((prev) => ({
        ...prev,
        is_followed_by: true,
      }));
    }

    setIsLoading(false);
  }, [currentUserId, targetUserId, isLoading]);

  const rejectRequest = useCallback(async () => {
    if (!currentUserId || isLoading) return;

    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase
      .from('follows')
      .delete()
      .eq('follower_id', targetUserId)
      .eq('following_id', currentUserId)
      .eq('status', 'pending');

    if (!error) {
      // Request removed, no change to is_followed_by (was already false for pending)
    }

    setIsLoading(false);
  }, [currentUserId, targetUserId, isLoading]);

  return {
    relationship,
    isLoading,
    follow,
    unfollow,
    acceptRequest,
    rejectRequest,
  };
}
