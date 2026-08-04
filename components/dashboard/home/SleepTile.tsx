'use client';

import { useMemo } from 'react';
import { IconMoon } from '@tabler/icons-react';
import { getLocalDateString } from '@/lib/utils';
import { formatSleepHours } from '@/lib/sleep/formatSleep';
import { SLEEP_QUALITY_DOT_CLASS, SLEEP_QUALITY_LABELS } from '@/components/dashboard/SleepQuickLog';
import type { SleepLogEntry } from '@/types/schema';
import { MetricTile } from './MetricTile';

/** Data for the glance Sleep tile (from useSleepLog). */
export interface SleepGlance {
  /** Trailing entries, newest first. */
  entries: SleepLogEntry[];
  /** Entry for today or yesterday's local day, if logged. */
  lastNight: SleepLogEntry | null;
  /** Mean hours over the trailing 7 local days. */
  sevenDayAvgHours: number | null;
}

/** "7.5h" / "8h" — no trailing .0. Shared with the workout page's history card. */
const formatHours = formatSleepHours;

/** Tiny trend line of the trailing week's hours (same shape as the Weight tile's). */
function SleepSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 26"
      className="w-full h-6 mt-1.5 text-primary-400"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="sleep-sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Glance Sleep tile: last night's hours + quality dot, the 7-day average and
 * a trailing-week sparkline. Tapping anywhere opens the two-field inline log
 * sheet. Empty state is a quiet "Log sleep" affordance — same neutral border
 * and colors as every other tile, never a warning nag.
 */
export function SleepTile({ sleep, onLog }: { sleep: SleepGlance; onLog: () => void }) {
  const { entries, lastNight, sevenDayAvgHours } = sleep;

  // Trailing-week values, oldest → newest, for the sparkline.
  const weekValues = useMemo(() => {
    const today = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - 6);
    const cutoffStr = getLocalDateString(cutoff);
    return entries
      .filter((e) => e.localDay >= cutoffStr)
      .sort((a, b) => a.localDay.localeCompare(b.localDay))
      .map((e) => e.hours);
  }, [entries]);

  return (
    <MetricTile icon={IconMoon} label="Sleep" onClick={onLog}>
      {lastNight ? (
        <div className="text-xl font-semibold text-surface-100 flex items-baseline gap-1.5">
          {formatHours(lastNight.hours)}
          <span
            className={`w-2 h-2 rounded-full self-center ${SLEEP_QUALITY_DOT_CLASS[lastNight.quality]}`}
            title={`Quality: ${SLEEP_QUALITY_LABELS[lastNight.quality]}`}
            data-testid="sleep-quality-dot"
          />
          <span className="text-sm text-surface-500 font-normal">last night</span>
        </div>
      ) : (
        <div className="text-xl font-semibold text-surface-300">
          Log sleep
          <span className="text-sm text-primary-400 font-normal ml-1.5">+</span>
        </div>
      )}
      <SleepSparkline values={weekValues} />
      {sevenDayAvgHours != null && (
        <div className="text-[11px] text-surface-500 mt-1" data-testid="sleep-avg">
          {formatHours(Math.round(sevenDayAvgHours * 10) / 10)} avg this week
        </div>
      )}
    </MetricTile>
  );
}
