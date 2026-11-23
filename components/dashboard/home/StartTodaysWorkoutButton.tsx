'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { IconPlayerPlay } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

const SuggestedWorkoutSheet = dynamic(
  () => import('@/components/workout/SuggestedWorkoutSheet').then((m) => m.SuggestedWorkoutSheet),
  { ssr: false }
);

/**
 * One tap to today's recommended workout: opens the suggested-workout sheet
 * in auto-start mode, which builds the same plan "Suggest one" previews and
 * starts it as soon as it's ready (the panel's "three-tap start": Start
 * workout → Suggest → Start). The sheet stays visible while it builds, so a
 * change of duration or gym there cancels the auto-start and leaves the
 * normal preview.
 */
export function StartTodaysWorkoutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'flex w-full min-h-[50px] items-center justify-center gap-2 rounded-button bg-action text-on-action text-headline transition-[filter,transform] hover:brightness-110 active:scale-[0.99] active:brightness-95',
          className
        )}
        data-testid="home-start-todays-workout"
      >
        <IconPlayerPlay size={20} aria-hidden="true" />
        Start today’s workout
      </button>
      {open && <SuggestedWorkoutSheet isOpen={open} onClose={() => setOpen(false)} autoStart />}
    </>
  );
}
