'use client';

import type { ReactNode } from 'react';
import { IconInfoCircle } from '@tabler/icons-react';
import { Sheet } from '@/components/ui';

interface TodaySheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Recovery section: Apple Health / wearable card (sleep, steps, HRV). */
  recovery: ReactNode;
  /** This week section: the glance tiles and the weekly-set detail. */
  week: ReactNode;
}

/**
 * One tap from Home's Today card: the depth that used to stack on Home —
 * Apple Health, the metric tiles, weekly sets and the low-volume alert —
 * plus a short plain-words note for the science terms that appear in here.
 */
export function TodaySheet({ isOpen, onClose, recovery, week }: TodaySheetProps) {
  return (
    <Sheet isOpen={isOpen} onClose={onClose} title="Today" size="lg" grouped>
      <div className="space-y-6">
        <section aria-labelledby="today-recovery">
          <h3 id="today-recovery" className="mx-1 mb-2 text-headline text-ink">
            Recovery
          </h3>
          {recovery}
        </section>
        <section aria-labelledby="today-week" className="space-y-3">
          <h3 id="today-week" className="mx-1 text-headline text-ink">
            This week
          </h3>
          {week}
        </section>
        <div className="flex gap-2.5 rounded-card bg-card shadow-card px-4 py-3">
          <IconInfoCircle size={18} className="mt-0.5 flex-shrink-0 text-ink-2" aria-hidden="true" />
          <p className="text-subhead text-ink-2">
            <span className="font-semibold text-ink">The science.</span> Your weekly range runs from the
            minimum that still builds muscle (MEV) to the most you can recover from (MRV). &ldquo;Effective&rdquo;
            sets count fully when you stop within about 3 reps of failure.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
