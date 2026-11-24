'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** The query flag the builder adds after a save (`/dashboard/mesocycle?saved=1`). */
export const SAVED_BLOCK_PARAM = 'saved';

/** Whether a URL search string carries the builder's saved flag. Pure. */
export function hasSavedBlockFlag(search: string): boolean {
  return new URLSearchParams(search).get(SAVED_BLOCK_PARAM) === '1';
}

/**
 * Confirms a block the builder just saved and says where it lives, then
 * drops the flag from the URL so a reload doesn't confirm it again (UX panel
 * round 20: the lifter couldn't tell the block was saved, or where to find
 * it). Read from window.location: no Suspense boundary needed for
 * useSearchParams on this client page.
 */
export function SavedBlockBanner() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!hasSavedBlockFlag(window.location.search)) return;
    setShow(true);
    router.replace('/dashboard/mesocycle', { scroll: false });
  }, [router]);
  if (!show) return null;
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-card border border-status-ok/30 bg-status-ok/10 p-3"
      role="status"
      data-testid="mesocycle-saved-banner"
    >
      <div>
        <p className="text-subhead font-semibold text-ink">✓ Training block saved</p>
        <p className="text-caption text-ink-2 mt-0.5">
          It&apos;s your active plan now. This page (Train → Plan) shows it week by week, and Train&apos;s
          &ldquo;today&rdquo; card follows it.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="min-h-[36px] px-2 text-caption font-semibold text-action"
        aria-label="Dismiss"
      >
        OK
      </button>
    </div>
  );
}
