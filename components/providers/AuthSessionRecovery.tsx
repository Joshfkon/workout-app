'use client';

/**
 * Keeps the Supabase session alive across background/foreground cycles and
 * surfaces re-auth EXPLICITLY when it can't (one login redirect, once) —
 * instead of letting a lapsed token silently empty every server-backed
 * screen. Mounted once at the dashboard layout.
 *
 * Native (Capacitor): the OS suspends JS timers in the background, so the
 * supabase-js auto-refresh timer misses its window on long background
 * stretches. On `appStateChange` we stop/start the auto-refresh loop (the
 * supabase-recommended pattern) AND proactively refresh a lapsed token on
 * foreground. Web/PWA gets the same proactive check on `visibilitychange`.
 *
 * Failure semantics (see lib/supabase/sessionRecovery.ts):
 *  - transient refresh failure → keep the session; screens show retry states
 *  - rejected refresh / SIGNED_OUT not caused by an explicit sign-out →
 *    redirect to /login with the "session expired" banner, exactly once
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { CapacitorApp, isNativePlatform } from '@/lib/integrations/capacitor-stub';
import {
  recoverSessionOnForeground,
  claimReauthSurface,
  resetReauthSurface,
  wasExplicitSignOut,
  SESSION_EXPIRED_LOGIN_URL,
} from '@/lib/supabase/sessionRecovery';

export function AuthSessionRecovery() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createUntypedClient();

    const surfaceReauth = () => {
      if (!claimReauthSurface()) return;
      router.replace(SESSION_EXPIRED_LOGIN_URL);
    };

    const recover = async () => {
      const outcome = await recoverSessionOnForeground(supabase);
      if (outcome === 'reauth-required') surfaceReauth();
      // 'no-session' is left to the SIGNED_OUT listener / route guards —
      // getSession() already removed a dead session and emitted the event.
    };

    // A dead refresh token makes supabase-js drop the session and emit
    // SIGNED_OUT (this also covers its own auto-refresh failing in the
    // background). Only an explicit, user-initiated sign-out may pass
    // silently — everything else gets the explicit re-auth screen.
    const { data: authSub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        resetReauthSurface();
      } else if (event === 'SIGNED_OUT' && !wasExplicitSignOut()) {
        surfaceReauth();
      }
    });

    // Native: pause the refresh timer in the background, restart + recover on
    // foreground. addListener returns a promise of a handle in Capacitor v6+.
    let appStateHandle: { remove: () => void } | null = null;
    if (isNativePlatform()) {
      // The timer may have been started before backgrounding was ever
      // observed; make sure it runs now, and reconcile a token that lapsed
      // while the app was closed.
      supabase.auth.startAutoRefresh?.();
      void recover();

      const registration = CapacitorApp.addListener(
        'appStateChange',
        ({ isActive }: { isActive: boolean }) => {
          if (isActive) {
            supabase.auth.startAutoRefresh?.();
            void recover();
          } else {
            supabase.auth.stopAutoRefresh?.();
          }
        }
      );
      void Promise.resolve(registration).then((handle) => {
        appStateHandle = handle;
      });
    }

    // Web/PWA foreground signal. Cheap: the common case is a local session
    // read with no network. Also fires in Capacitor webviews as a backstop
    // where appStateChange coverage differs by OS.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void recover();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      authSub?.subscription?.unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      appStateHandle?.remove();
    };
  }, [router]);

  return null;
}
