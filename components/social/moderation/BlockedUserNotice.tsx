'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';

/** Shown in place of a profile the viewer has blocked. */
export function BlockedUserNotice({ userId, username }: { userId: string; username: string }) {
  const { unblockUser } = useBlockedUsers();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnblock = async () => {
    setIsLoading(true);
    setError(null);
    const result = await unblockUser(userId);
    setIsLoading(false);
    if (!result.success) setError(result.error);
  };

  return (
    <Card>
      <CardContent className="py-8 text-center">
        <h3 className="text-lg font-semibold text-surface-100 mb-2">You blocked @{username}</h3>
        <p className="text-surface-400 mb-4">
          Their profile, posts, comments and shared workouts are hidden from you.
        </p>
        {error && <p className="text-sm text-error-400 mb-3">{error}</p>}
        <Button variant="secondary" size="sm" onClick={handleUnblock} isLoading={isLoading}>
          Unblock
        </Button>
      </CardContent>
    </Card>
  );
}
