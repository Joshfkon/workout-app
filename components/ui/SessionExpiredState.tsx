'use client';

import Link from 'next/link';
import { IconLock } from '@tabler/icons-react';
import { Button } from './Button';
import { ErrorRetry } from './ErrorRetry';
import {
  isSessionExpiredError,
  isSessionVerifyError,
} from '@/lib/supabase/sessionGate';
import { SESSION_EXPIRED_LOGIN_URL } from '@/lib/supabase/sessionRecovery';

interface SessionExpiredStateProps {
  /** Full-viewport centering for page-level use. */
  fullPage?: boolean;
}

/**
 * Explicit re-auth state for an expired/invalid session. Rendered wherever a
 * screen would otherwise have shown a "no data yet" empty state off the back
 * of an unauthenticated query — the copy reassures that nothing was deleted.
 */
export function SessionExpiredState({ fullPage = false }: SessionExpiredStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 ${
        fullPage ? 'min-h-[70vh]' : 'py-12'
      }`}
      role="alert"
      data-testid="session-expired"
    >
      <div className="w-14 h-14 mb-4 rounded-2xl bg-warning-500/15 flex items-center justify-center">
        <IconLock size={28} className="text-warning-400" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-bold text-surface-100">Session expired</h2>
      <p className="mt-2 max-w-sm text-sm text-surface-400">
        You&apos;ve been signed out, so we can&apos;t show your data right now. Your
        logged workouts and history are safe — sign in again to see them.
      </p>
      <Link href={SESSION_EXPIRED_LOGIN_URL}>
        <Button className="mt-6 min-h-[44px]">Sign in again</Button>
      </Link>
    </div>
  );
}

interface DataErrorStateProps {
  /** The error a data query settled with. */
  error: unknown;
  /** Re-runs the failed load (non-auth failures). */
  onRetry: () => void;
  isRetrying?: boolean;
  fullPage?: boolean;
}

/**
 * One-stop error render for gated data queries (lib/supabase/sessionGate.ts):
 * an expired session gets the explicit re-auth state; a transient verify or
 * fetch failure gets the retry state. Neither is ever an empty state.
 */
export function DataErrorState({
  error,
  onRetry,
  isRetrying = false,
  fullPage = false,
}: DataErrorStateProps) {
  if (isSessionExpiredError(error)) {
    return <SessionExpiredState fullPage={fullPage} />;
  }
  return (
    <ErrorRetry
      onRetry={onRetry}
      isRetrying={isRetrying}
      fullPage={fullPage}
      message={
        isSessionVerifyError(error)
          ? error.message
          : "We couldn't load this right now. Check your connection and try again."
      }
    />
  );
}
