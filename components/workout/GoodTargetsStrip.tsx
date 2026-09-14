'use client';

import { useMemo } from 'react';
import { now as clockNow } from '@/lib/clock';
import { Slider } from '@/components/ui/Slider';
import {
  formatReadyEta,
  type ReadinessTarget,
  type NextReadyTarget,
} from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readiness';
import { futureInstant } from '@/app/(dashboard)/dashboard/workout/[id]/_lib/readinessPreview';

/** Compact duration for the header: "6h", "1d", "1d 6h". */
function formatHoursAhead(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest > 0 ? `${days}d ${rest}h` : `${days}d`;
}

/** "Tue 6:00 PM" — where the slider position lands on the calendar. */
function formatFutureLabel(instant: Date): string {
  const weekday = instant.toLocaleDateString(undefined, { weekday: 'short' });
  const time = instant.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${weekday} ${time}`;
}

/**
 * The "good targets" strip: the answer at a glance (fine children surface
 * here), derived from the SAME rows the badges below show, so a muscle can
 * never appear here as ready-now while its row reads Recovering. Carries the
 * look-ahead time slider (when a preview builder is available): dragging it
 * forward re-renders the whole body — strip, map and rows — as it will read
 * that many hours from now, with a one-line explanation of what the
 * projection assumes.
 */
export function GoodTargetsStrip({
  targets,
  nextUp,
  hoursAhead,
  maxHours,
  onHoursAheadChange,
  showSlider,
}: {
  targets: ReadinessTarget[];
  nextUp: NextReadyTarget | null;
  /** Current slider position; 0 = now (today's real numbers). */
  hoursAhead: number;
  maxHours: number;
  onHoursAheadChange: (hours: number) => void;
  showSlider: boolean;
}) {
  const previewing = hoursAhead > 0;
  // Visual-only label base (like RollingVolumeForecast's day labels); the
  // preview data itself is computed upstream against the surface's stamped
  // clock.
  const base = useMemo(() => clockNow(), []);
  const futureLabel = formatFutureLabel(futureInstant(base, hoursAhead));

  return (
    <>
      <div className="mb-2 rounded-lg bg-surface-800/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-wide text-surface-500">
            {previewing ? `Good targets in ${formatHoursAhead(hoursAhead)}` : 'Good targets today'}
          </p>
          {previewing && (
            <button
              onClick={() => onHoursAheadChange(0)}
              className="flex-shrink-0 text-[11px] font-medium text-primary-400 hover:text-primary-300"
              data-testid="readiness-time-reset"
            >
              Back to now
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

        {showSlider && (
          <div className="mt-2.5">
            <Slider
              min={0}
              max={maxHours}
              step={1}
              value={hoursAhead}
              onChange={(e) => onHoursAheadChange(Number(e.target.value))}
              showValue={false}
              aria-label="Preview hours ahead"
              data-testid="readiness-time-slider"
              className="h-1.5"
              marks={[
                { value: 0, label: 'Now' },
                { value: maxHours, label: `+${Math.round(maxHours / 24)}d` },
              ]}
            />
          </div>
        )}
      </div>

      {previewing && (
        <p
          className="mb-2 text-[11px] leading-relaxed text-surface-500"
          data-testid="readiness-preview-note"
        >
          Projected for {futureLabel}, assuming nothing new is logged: recovery
          advances by the hour and older sets age out of the rolling 7-day
          window as days pass.
        </p>
      )}
    </>
  );
}
