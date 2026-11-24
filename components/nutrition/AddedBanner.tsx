'use client';

import { useEffect, useState } from 'react';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';

/** What a successful one-tap add reports back, shown where the tap was. */
export interface QuickAddConfirmation {
  /** "Added White Rice (1 cup) to Dinner" */
  added: string;
  /** "Day total 283 / 1,872 kcal · 11 / 144 g protein" */
  totals: string;
  /** Shown after Undo: "Removed White Rice (1 cup) from Dinner" */
  removed: string;
  /** The amount that was logged, on its own line: "150 g · 248 kcal · 46 g protein". */
  amount?: string;
  /** Removes what was just added. */
  onUndo?: () => Promise<void> | void;
  /** Opens the logged entry to change its amount (single-food adds only). */
  onEdit?: () => Promise<void> | void;
  /**
   * The add is shown (and counted in the totals) before the database answers.
   * This settles when the save lands; if it rejects the add has been rolled
   * back and the banner says so instead.
   */
  saved?: Promise<unknown>;
  /** Shown when `saved` rejects: "Couldn't save White Rice. Try again." */
  failed?: string;
}

type Phase = 'added' | 'undone' | 'failed';

/**
 * The in-flow confirmation for a one-tap add: what, how much, which meal, and
 * where the day now stands, with Undo. It sits where the tap was (under the
 * Eat page's quick-add chips; at the top of the Add food sheet's list), never
 * over other controls. Renders immediately — the add is optimistic — and
 * turns into an error line if the save fails.
 */
export function AddedBanner({
  confirmation,
  testIdPrefix = 'quick-add-status',
  onFailed,
}: {
  confirmation: QuickAddConfirmation;
  testIdPrefix?: string;
  /** Called once if the save behind this confirmation fails. */
  onFailed?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('added');

  useEffect(() => {
    setPhase('added');
    if (!confirmation.saved) return undefined;
    let current = true;
    confirmation.saved.catch(() => {
      if (!current) return;
      setPhase('failed');
      onFailed?.();
    });
    return () => {
      current = false;
    };
    // onFailed is a callback prop; re-subscribing on its identity would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmation]);

  async function handleUndo() {
    if (!confirmation.onUndo) return;
    try {
      await confirmation.onUndo();
    } catch (err) {
      console.error('[AddedBanner] undo failed:', err);
      return;
    }
    setPhase('undone');
  }

  async function handleEdit() {
    if (!confirmation.onEdit) return;
    try {
      await confirmation.onEdit();
    } catch (err) {
      console.error('[AddedBanner] edit failed:', err);
    }
  }

  if (phase === 'failed') {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-status-bad/40 bg-status-bad/10 px-3 py-2.5"
        data-testid={`${testIdPrefix}-failed`}
      >
        <IconAlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-status-bad" aria-hidden="true" />
        <p className="text-body font-semibold text-ink">
          {confirmation.failed ?? 'That didn’t save. Check your connection and try again.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-ok/40 bg-status-ok/15 px-3 py-2.5 motion-safe:animate-row-added">
      {/* A solid check, big enough to read at a glance. */}
      <span
        className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-status-ok text-white"
        aria-hidden="true"
      >
        <IconCheck size={18} stroke={3} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold text-ink" data-testid={`${testIdPrefix}-added`}>
          {phase === 'undone' ? confirmation.removed : confirmation.added}
        </p>
        {phase === 'added' && confirmation.amount && (
          <p className="text-body font-medium text-ink tabular-nums" data-testid={`${testIdPrefix}-amount`}>
            {confirmation.amount}
          </p>
        )}
        {phase === 'added' && (
          <p className="text-subhead text-ink-2 tabular-nums" data-testid={`${testIdPrefix}-totals`}>
            {confirmation.totals}
          </p>
        )}
      </div>
      {phase === 'added' && (confirmation.onEdit || confirmation.onUndo) && (
        <div className="-my-1 flex flex-shrink-0 flex-col items-end">
          {confirmation.onEdit && (
            <button
              type="button"
              onClick={() => void handleEdit()}
              className="min-h-[44px] px-2 text-body font-semibold text-action hover:underline"
              data-testid={`${testIdPrefix}-edit`}
            >
              Edit
            </button>
          )}
          {confirmation.onUndo && (
            <button
              type="button"
              onClick={() => void handleUndo()}
              className="min-h-[44px] px-2 text-body font-semibold text-action hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
