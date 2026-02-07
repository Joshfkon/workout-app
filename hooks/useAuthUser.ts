'use client';

import { useState, useEffect } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthUserState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Shared hook for getting the currently authenticated Supabase user.
 * Deduplicates the auth.getUser() pattern used across many hooks.
 *
 * Usage:
 *   const { user, isLoading } = useAuthUser();
 *   if (isLoading) return <Spinner />;
 *   if (!user) return <LoginPrompt />;
 */
export function useAuthUser(): AuthUserState {
  const [state, setState] = useState<AuthUserState>({
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchUser() {
      try {
        const supabase = createUntypedClient();
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser();

        if (cancelled) return;

        if (error) {
          setState({ user: null, isLoading: false, error: error.message });
        } else {
          setState({ user, isLoading: false, error: null });
        }
      } catch (err) {
        if (cancelled) return;
        setState({
          user: null,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to get user',
        });
      }
    }

    fetchUser();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
