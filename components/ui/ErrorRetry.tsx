'use client';

import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { Button } from './Button';

interface ErrorRetryProps {
  /** Headline for the error state. */
  title?: string;
  /** Supporting line explaining what to do. */
  message?: string;
  /** Retry handler — re-runs the failed load. */
  onRetry: () => void;
  /** Whether a retry is currently in flight (disables the button). */
  isRetrying?: boolean;
  /** Full-viewport centering for page-level errors. */
  fullPage?: boolean;
}

/**
 * A recoverable error state with a Retry action.
 *
 * Used when a data/session *check* fails for a transient reason (network, a
 * 5xx from the server) — the user stays put and can retry, instead of being
 * bounced to the login screen. A failed check must never be mistaken for a
 * logout.
 */
export function ErrorRetry({
  title = 'Something went wrong',
  message = "We couldn't load this right now. Check your connection and try again.",
  onRetry,
  isRetrying = false,
  fullPage = false,
}: ErrorRetryProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 ${
        fullPage ? 'min-h-[70vh]' : 'py-12'
      }`}
      role="alert"
      data-testid="error-retry"
    >
      <div className="w-14 h-14 mb-4 rounded-2xl bg-danger-500/15 flex items-center justify-center">
        <IconAlertTriangle size={28} className="text-danger-400" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-bold text-surface-100">{title}</h2>
      <p className="mt-2 max-w-sm text-sm text-surface-400">{message}</p>
      <Button className="mt-6 min-h-[44px]" onClick={onRetry} disabled={isRetrying}>
        <span className="inline-flex items-center gap-2">
          <IconRefresh size={18} className={isRetrying ? 'animate-spin' : ''} aria-hidden="true" />
          {isRetrying ? 'Retrying…' : 'Try again'}
        </span>
      </Button>
    </div>
  );
}
