'use client';

import { useState } from 'react';
import { MuscleReadinessContent } from './MuscleReadinessSheet';
import { useDashboardMuscleReadiness } from '@/hooks/useMuscleReadiness';
import { useWearableRecovery } from '@/hooks/useWearableRecovery';

/**
 * TrainReadinessCard — the Train dashboard's recovery card, rendering the same
 * read-only readiness body as the in-workout Muscle Readiness sheet and the
 * empty-workout inline placement: good-targets strip, body map with the
 * Recovery/Volume paint toggle, and per-muscle volume bars + recovery badges
 * (6-row cap with a "+N more" expander, shared across surfaces).
 *
 * No live session here, so it reads through `useDashboardMuscleReadiness` —
 * the same fetch and query key as the sheet, so opening a workout later hits a
 * warm cache. Lazy-mounted from the train page to keep the readiness assembly
 * out of its initial bundle.
 */
export function TrainReadinessCard() {
  // Stamp the clock once so every muscle is evaluated against the same instant.
  const [now] = useState(() => new Date());

  const { rows, targets, nextUp, isLoading } = useDashboardMuscleReadiness(now);
  const { state: wearableRecovery } = useWearableRecovery();

  return (
    <div
      className="rounded-2xl p-4 bg-surface-900 border border-surface-800"
      data-testid="train-readiness-card"
    >
      <h3 className="text-[15px] font-semibold text-surface-100 mb-3">Recovery</h3>
      <MuscleReadinessContent
        rows={rows}
        targets={targets}
        nextUp={nextUp}
        isLoading={isLoading}
        collapsible
        loadingTestId="train-readiness-loading"
        wearableNotice={wearableRecovery.reason}
      />
    </div>
  );
}

export default TrainReadinessCard;
