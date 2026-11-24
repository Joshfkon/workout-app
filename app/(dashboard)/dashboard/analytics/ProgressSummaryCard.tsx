'use client';

import { useState } from 'react';
import { IconChevronDown, IconInfoCircle } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import type { LiftBreakdownRow, ProgressSummary } from './progressSummary';

const TONE_CLASS: Record<LiftBreakdownRow['tone'], string> = {
  up: 'text-status-ok',
  flat: 'text-ink-2',
  down: 'text-status-warn',
  neutral: 'text-ink-2',
};

/**
 * "Are you progressing?" at the top of Progress: the weight line, and the
 * strength line with a "See each lift" list (name, first → latest best set,
 * direction) so "4 of 6 lifts up" names which four. How the trends are
 * worked out sits behind one info toggle at the bottom.
 */
export function ProgressSummaryCard({ summary }: { summary: ProgressSummary }) {
  const [open, setOpen] = useState(false);
  const listId = 'progress-summary-lifts';
  return (
    <div className="rounded-card bg-card p-4 shadow-card" data-testid="progress-summary">
      <p className="text-caption text-ink-2">Are you progressing?</p>
      {summary.weight && (
        <p className="mt-0.5 text-body text-ink" data-testid="progress-summary-weight">
          {summary.weight}
        </p>
      )}
      {summary.strength && (
        <p className="mt-2 text-body text-ink" data-testid="progress-summary-strength">
          {summary.strength}
        </p>
      )}
      {summary.strengthContext && (
        <p className="mt-0.5 text-subhead text-ink-2" data-testid="progress-summary-strength-context">
          {summary.strengthContext}
        </p>
      )}
      {summary.strength && summary.strengthNames && (
        <p className="mt-0.5 text-subhead text-ink-2" data-testid="progress-summary-strength-names">
          {summary.strengthNames}
        </p>
      )}
      {summary.lifts.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            data-testid="progress-summary-lifts-toggle"
            className="mt-1 -ml-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-subhead font-semibold text-action"
          >
            {open ? 'Hide lifts' : `See each lift (${summary.lifts.length})`}
            <IconChevronDown
              size={16}
              aria-hidden="true"
              className={cn('transition-transform', open && 'rotate-180')}
            />
          </button>
          {open && (
            <div id={listId} data-testid={listId}>
              <p className="text-caption text-ink-2">
                Best set of your first workout in this window, then of your latest.
              </p>
              <ul className="mt-1 divide-y divide-sep">
                {summary.lifts.map((lift) => (
                  <li key={lift.key} className="py-2" data-testid="progress-summary-lift">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-body font-medium text-ink">{lift.name}</span>
                      <span className={cn('shrink-0 text-subhead font-semibold', TONE_CLASS[lift.tone])}>
                        {lift.direction}
                      </span>
                    </div>
                    <p className="text-subhead text-ink-2 tabular-nums">
                      {lift.then} <span aria-hidden="true">→</span>
                      <span className="sr-only">then</span> {lift.now}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <TrendHelp weightMethod={summary.weightMethod} liftMethod={summary.liftMethod} />
    </div>
  );
}

/**
 * How the trends are worked out, ONCE for the whole page and closed by
 * default (UX panel r19: the method text repeated under every chart was
 * wordy clutter, and nobody could tell what made a lift "flat").
 */
function TrendHelp({ weightMethod, liftMethod }: { weightMethod: string | null; liftMethod: string | null }) {
  if (!weightMethod && !liftMethod) return null;
  return (
    <details className="group" data-testid="progress-trend-help">
      <summary className="-ml-1 inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 px-1 text-subhead font-semibold text-action [&::-webkit-details-marker]:hidden">
        <IconInfoCircle size={16} aria-hidden="true" />
        How trends are worked out
        <IconChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1.5 pb-1 text-subhead text-ink-2">
        {weightMethod && <p data-testid="progress-summary-weight-method">{weightMethod}</p>}
        {liftMethod && <p data-testid="progress-summary-lift-method">{liftMethod}</p>}
      </div>
    </details>
  );
}
