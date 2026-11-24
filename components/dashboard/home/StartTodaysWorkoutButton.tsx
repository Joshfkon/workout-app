'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { IconLoader2, IconPlayerPlay } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

const loadSheet = () => import('@/components/workout/SuggestedWorkoutSheet').then((m) => m.SuggestedWorkoutSheet);

const SuggestedWorkoutSheet = dynamic(loadSheet, { ssr: false });

/**
 * One tap to today's recommended workout: opens the suggested-workout sheet
 * in auto-start mode, which builds the same plan "Suggest one" previews and
 * starts it as soon as it's ready (the panel's "three-tap start": Start
 * workout → Suggest → Start). The sheet stays visible while it builds, so a
 * change of duration or gym there cancels the auto-start and leaves the
 * normal preview.
 *
 * The button answers the tap itself (spinner + "Building your workout…")
 * while the sheet's code loads, and that code is fetched once Home is idle
 * and again on pointer-down, so the sheet — with its step-by-step progress —
 * is up almost at once (UX panel rounds 19–20: the start read as a stall).
 */
export function StartTodaysWorkoutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const preload = () => void loadSheet().catch(() => {});
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 4000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(preload, 1500);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <>
      <button
        type="button"
        onPointerDown={() => void loadSheet().catch(() => {})}
        onClick={() => setOpen(true)}
        aria-busy={open || undefined}
        className={cn(
          'flex w-full min-h-[50px] items-center justify-center gap-2 rounded-button bg-action text-on-action text-headline transition-[filter,transform] hover:brightness-110 active:scale-[0.99] active:brightness-95',
          className
        )}
        data-testid="home-start-todays-workout"
      >
        {open ? (
          <>
            <IconLoader2 size={20} className="animate-spin" aria-hidden="true" />
            Building your workout…
          </>
        ) : (
          <>
            <IconPlayerPlay size={20} aria-hidden="true" />
            Start today’s workout
          </>
        )}
      </button>
      {open && <SuggestedWorkoutSheet isOpen={open} onClose={() => setOpen(false)} autoStart />}
    </>
  );
}
