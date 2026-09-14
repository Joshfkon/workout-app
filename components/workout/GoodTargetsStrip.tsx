'use client';

import {
  formatReadyEta,
  type ReadinessTarget,
  type NextReadyTarget,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';

/**
 * The "good targets" strip: the answer at a glance (fine children surface
 * here), derived from the SAME rows the badges below show, so a muscle can
 * never appear here as ready-now while its row reads Recovering. Carries the
 * today/tomorrow toggle (when a next-day preview is available) and, while
 * previewing, the one-line explanation of what the projection assumes.
 */
export function GoodTargetsStrip({
  targets,
  nextUp,
  previewing,
  showToggle,
  onToggleDay,
}: {
  targets: ReadinessTarget[];
  nextUp: NextReadyTarget | null;
  previewing: boolean;
  showToggle: boolean;
  onToggleDay: () => void;
}) {
  return (
    <>
      <div className="mb-2 rounded-lg bg-surface-800/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-surface-500">
            Good targets {previewing ? 'tomorrow' : 'today'}
          </p>
          {showToggle && (
            <button
              onClick={onToggleDay}
              className="flex-shrink-0 text-[11px] font-medium text-primary-400 hover:text-primary-300"
              data-testid="readiness-day-toggle"
              aria-pressed={previewing}
            >
              {previewing ? '‹ Back to today' : 'Preview tomorrow ›'}
            </button>
          )}
        </div>
        <p className="text-sm text-surface-100 mt-0.5" data-testid="readiness-targets">
          {targets.length > 0 ? (
            targets.map((t, i) => (
              <span key={`${t.muscle}-${t.isChild ? 'c' : 'r'}`}>
                {i > 0 && <span className="text-surface-500">, </span>}
                {t.tier === 'soon' ? (
                  // Ready-soon pick: muted + parenthetical ETA, visibly distinct
                  // from fully-Fresh picks (a legitimate target for a session
                  // planned a little ahead, not a ready-now recommendation).
                  <span className="text-surface-400">
                    {t.displayName}{' '}
                    <span className="text-surface-500">(ready {formatReadyEta(t.readyInHours)})</span>
                  </span>
                ) : (
                  t.displayName
                )}
              </span>
            ))
          ) : nextUp ? (
            `Nothing urgent — lagging muscles are still recovering. Next up: ${nextUp.displayName} in ${formatReadyEta(nextUp.hoursUntilReady)}.`
          ) : (
            "You're on top of volume — nothing behind and recovered right now."
          )}
        </p>
      </div>

      {previewing && (
        <p
          className="mb-2 text-[11px] leading-relaxed text-surface-500"
          data-testid="readiness-preview-note"
        >
          Projected for tomorrow, assuming nothing new is logged: older sets age
          out of the rolling 7-day window and recovery advances a day.
        </p>
      )}
    </>
  );
}

