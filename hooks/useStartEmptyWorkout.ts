'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { resolveAuthState } from '@/lib/supabase/authState';
import { getOrCreateTodaySession } from '@/app/(dashboard)/dashboard/workout/_lib/adhocSession';

/**
 * Start (or reuse) today's empty workout and open it — one tap, no confirm
 * screen. Same path as Train's "Start empty workout": repeat taps reuse the
 * session, so nothing litters empties.
 */
export function useStartEmptyWorkout() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const auth = await resolveAuthState(supabase);
      if (auth.status === 'unauthenticated') {
        router.push('/login');
        return;
      }
      if (auth.status === 'error') {
        setError("Couldn't verify your session. Check your connection and try again.");
        setIsStarting(false);
        return;
      }
      const { sessionId } = await getOrCreateTodaySession(supabase, auth.userId);
      router.push(`/dashboard/workout/${sessionId}?fromCreate=true`);
    } catch (err) {
      console.error('Failed to start empty workout:', err);
      setError('Failed to start workout. Please try again.');
      setIsStarting(false);
    }
  };

  return { start, isStarting, error };
}
