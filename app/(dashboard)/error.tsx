'use client';

/**
 * Error boundary for every dashboard route.
 *
 * It renders INSIDE the dashboard layout, so the sidebar / bottom navigation
 * stay on screen and the user can move to another tab. Without it a render
 * error bubbled to app/error.tsx, which replaces the whole shell.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import {
  isStaleDeploymentError,
  beginStaleDeployRecovery,
} from '@/lib/utils/staleDeployRecovery';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    console.error('Dashboard error:', error);

    // A chunk from an older deployment: clear caches and reload (rate-limited
    // inside the helper), same as the root boundary.
    if (!isStaleDeploymentError(error)) return;
    if (beginStaleDeployRecovery()) setRecovering(true);
  }, [error]);

  if (recovering) {
    return (
      <div className="flex items-center justify-center py-24" data-testid="dashboard-error-recovering">
        <div className="text-center max-w-md">
          <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-surface-700 border-t-surface-200 animate-spin" />
          <p className="text-surface-300">Updating to the latest version…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-16" role="alert" data-testid="dashboard-error">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-danger-500/15 flex items-center justify-center">
          <svg className="w-7 h-7 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-surface-100 mb-2">This screen hit a problem</h2>
        <p className="text-surface-400 mb-6">
          Your data is safe. Try again, or use the navigation to open another tab.
        </p>
        {error.digest && (
          <p className="text-xs text-surface-600 mb-4 font-mono">Ref: {error.digest}</p>
        )}
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </div>
  );
}
