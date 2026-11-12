'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import { useAuthUser } from '@/hooks/useAuthUser';
import {
  blockUser as blockUserRequest,
  unblockUser as unblockUserRequest,
  getBlockedUserIds,
  getServerBlockedUserIds,
  loadBlockedUserIds,
  subscribeBlockedUsers,
} from '@/lib/moderation';

/**
 * The set of users the signed-in user has blocked, shared across every
 * mounted consumer (blocking in one place hides that user everywhere).
 */
export function useBlockedUsers() {
  const { user } = useAuthUser();
  const userId = user?.id ?? null;

  const blockedIds = useSyncExternalStore(
    subscribeBlockedUsers,
    getBlockedUserIds,
    getServerBlockedUserIds
  );

  useEffect(() => {
    if (!userId) return;
    void loadBlockedUserIds(createUntypedClient(), userId);
  }, [userId]);

  const isBlocked = useCallback(
    (targetUserId: string | null | undefined) => !!targetUserId && blockedIds.has(targetUserId),
    [blockedIds]
  );

  const blockUser = useCallback(
    async (targetUserId: string) => {
      if (!userId) return { success: false as const, error: 'Must be logged in' };
      return blockUserRequest(createUntypedClient(), userId, targetUserId);
    },
    [userId]
  );

  const unblockUser = useCallback(
    async (targetUserId: string) => {
      if (!userId) return { success: false as const, error: 'Must be logged in' };
      return unblockUserRequest(createUntypedClient(), userId, targetUserId);
    },
    [userId]
  );

  return { currentUserId: userId, blockedIds, isBlocked, blockUser, unblockUser };
}
