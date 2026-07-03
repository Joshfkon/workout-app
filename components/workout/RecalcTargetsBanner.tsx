'use client';

/**
 * P1-3 recalc banner. Shown on a not-yet-started planned session when one or
 * more targets were computed from history the user has since edited
 * (detection A). "Recalculate" opens a confirm dialog listing every old -> new
 * target change (mitigation a: all targets are engine output — no manual
 * override UI exists — so every stale block is eligible; the confirm keeps the
 * user in control). Purely presentational; the page owns detection + the write.
 */

import { useState } from 'react';
import type { RecalcChange } from '@/app/(dashboard)/dashboard/workout/_lib/staleTargets';
import { formatWeight } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

export interface RecalcTargetsBannerProps {
  staleCount: number;
  /** Old -> new target changes, precomputed by the page (may be empty). */
  changes: RecalcChange[];
  unit: WeightUnit;
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}

export function RecalcTargetsBanner({
  staleCount,
  changes,
  unit,
  isApplying,
  onApply,
  onDismiss,
}: RecalcTargetsBannerProps) {
  const [confirming, setConfirming] = useState(false);

  if (staleCount <= 0) return null;

  return (
    <div className="rounded-xl border border-warning-500/45 bg-warning-500/10 px-4 py-3" role="status">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-warning-400 mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-warning-300">
            Targets use data you&rsquo;ve edited
          </p>
          <p className="text-[13px] text-surface-400 mt-0.5">
            {staleCount} exercise{staleCount !== 1 ? 's' : ''} {staleCount !== 1 ? 'have' : 'has'} target
            weights based on past sets you changed after this workout was planned.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={isApplying || changes.length === 0}
              className="min-h-[44px] px-4 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-40"
            >
              {changes.length === 0 ? 'No changes to apply' : 'Recalculate'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={isApplying}
              className="min-h-[44px] px-2 text-sm text-surface-400 hover:text-surface-200"
            >
              Keep as is
            </button>
          </div>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => !isApplying && setConfirming(false)} />
          <div className="relative w-full max-w-sm bg-surface-900 rounded-2xl border border-surface-800 p-5">
            <h3 className="text-base font-semibold text-surface-100">Recalculate targets?</h3>
            <p className="text-[13px] text-surface-400 mt-1">
              These target weights will be updated from your corrected history:
            </p>
            <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {changes.map((c) => (
                <li key={c.blockId} className="flex items-center justify-between text-sm">
                  <span className="text-surface-200 truncate pr-2">{c.exerciseName}</span>
                  <span className="tabular-nums text-surface-400 flex-shrink-0">
                    {formatWeight(c.oldKg, unit, 0)} → <span className="text-primary-300">{formatWeight(c.newKg, unit, 0)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isApplying}
                className="flex-1 min-h-[44px] rounded-lg bg-surface-800 text-surface-200 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { onApply(); setConfirming(false); }}
                disabled={isApplying}
                className="flex-1 min-h-[44px] rounded-lg bg-primary-500 text-white text-sm font-semibold disabled:opacity-40"
              >
                {isApplying ? 'Applying…' : `Update ${changes.length}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecalcTargetsBanner;
