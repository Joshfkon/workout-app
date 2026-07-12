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
 * Deduplicates the session-read pattern used across many hooks.
 *
 * Reads the LOCALLY persisted session (`getSession()`) instead of the
 * `getUser()` network round trip: several of this hook's consumers mount at
 * boot, and supabase-js serializes every auth read (including the token reads
 * REST calls make) behind one lock — so each getUser() here pushed the app's
 * first data fetch back by a full auth-server round trip. Consumers only use
 * this for identity (what to fetch / whose id to write); RLS still validates
 * the token on every actual request.
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
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) return;

        setState({ user: session?.user ?? null, isLoading: false, error: null });
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
