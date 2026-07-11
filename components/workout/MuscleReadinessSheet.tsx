'use client';

import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useMuscleReadiness } from '@/hooks/useMuscleReadiness';
import type { ReadinessRow, VolumeStatus } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import type { RecoveryStatus } from '@/services/muscleRecovery';
import type { SetLog } from '@/types/schema';
import type { ExerciseBlockWithExercise } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/types';

/**
 * MuscleReadinessSheet — the in-workout "which muscles should I hit today?"
 * overlay. Lazy-mounted (the page renders it only once opened), READ-ONLY over
 * workout history and the live session: it never touches the workout store.
 *
 * Each row pairs weekly volume (sets vs MEV, with a zone-colored bar) with a
 * recovery badge, sorted so the best targets (behind on volume AND recovered)
 * float to the top.
 */

interface MuscleReadinessSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Non-skipped blocks of the live session (read-only). */
  liveBlocks: ExerciseBlockWithExercise[];
  /** Sets logged so far in the live session (read-only). */
  liveSets: SetLog[];
}

const RECOVERY_BADGE: Record<RecoveryStatus, { label: string; className: string }> = {
  fresh: { label: 'Fresh', className: 'bg-success-500/15 text-success-400' },
  recovering: { label: 'Recovering', className: 'bg-warning-500/15 text-warning-400' },
  fatigued: { label: 'Fatigued', className: 'bg-surface-700 text-surface-400' },
};

const VOLUME_BAR_COLOR: Record<VolumeStatus, string> = {
  low: 'bg-warning-500',
  optimal: 'bg-success-500',
  high: 'bg-danger-500',
};

/** "ready in ~Xh" — coarse, human-readable time until Fresh. */
function formatReadyIn(hours: number): string {
  if (hours <= 0) return '';
  if (hours < 1) return 'ready in <1h';
  if (hours < 24) return `ready in ~${Math.round(hours)}h`;
  const days = Math.round(hours / 24);
  return `ready in ~${days}d`;
}

function ReadinessRowView({ row }: { row: ReadinessRow }) {
  const badge = RECOVERY_BADGE[row.recovery.status];
  const fillPct = row.target > 0 ? Math.min(100, Math.round((row.sets / row.target) * 100)) : 0;
  const readyIn = row.recovery.status === 'fresh' ? '' : formatReadyIn(row.recovery.hoursUntilReady);

  return (
    <div
      className="flex items-center gap-3 py-2.5"
      data-testid={`readiness-row-${row.muscle}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-surface-100 truncate">{row.displayName}</span>
          <span className="text-[11px] tabular-nums text-surface-400 flex-shrink-0">
            <span data-testid={`readiness-sets-${row.muscle}`}>{row.sets}</span>
            <span className="text-surface-600">/{row.target}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1 rounded-full bg-surface-800 overflow-hidden">
          <div
            className={`h-full rounded-full ${VOLUME_BAR_COLOR[row.volumeStatus]}`}
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0 w-[92px]">
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.className}`}
          data-testid={`readiness-badge-${row.muscle}`}
        >
          {badge.label}
        </span>
        {readyIn && <span className="text-[10px] text-surface-500">{readyIn}</span>}
      </div>
    </div>
  );
}

export function MuscleReadinessSheet({
  isOpen,
  onClose,
  liveBlocks,
  liveSets,
}: MuscleReadinessSheetProps) {
  // Stamp the clock once when the sheet mounts so every muscle is evaluated
  // against the same instant (and re-stamped on each fresh open).
  const [now] = useState(() => new Date());

  const { rows, targets, isLoading } = useMuscleReadiness({
    liveBlocks,
    liveSets,
    now,
    enabled: isOpen,
  });

  const targetNames = targets.map((t) => t.displayName).join(', ');

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Muscle readiness">
      <div data-testid="readiness-sheet">
        {/* Top strip: the answer at a glance. */}
        <div className="mb-2 rounded-lg bg-surface-800/60 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-surface-500">Good targets today</p>
          <p className="text-sm text-surface-100 mt-0.5" data-testid="readiness-targets">
            {targets.length > 0
              ? targetNames
              : "You're on top of volume — nothing behind and recovered right now."}
          </p>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-sm text-surface-500" data-testid="readiness-sheet-loading">
            Loading readiness…
          </div>
        ) : (
          <div className="divide-y divide-surface-800/70">
            {rows.map((row) => (
              <ReadinessRowView key={row.muscle} row={row} />
            ))}
          </div>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-surface-600">
          Sorted by what to train now: recovered muscles behind on weekly volume
          come first; fatigued muscles sink to the bottom. Recovery is a simple
          planning estimate, not a medical readout.
        </p>
      </div>
    </BottomSheet>
  );
}

export default MuscleReadinessSheet;
