'use client';

import { memo, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { LogBloodPressureModal } from '@/components/dashboard/LogBloodPressureModal';
import { useBloodPressureLog } from '@/hooks/useBloodPressureLog';
import { formatDistanceToNow, getLocalDateString } from '@/lib/utils';
import { formatReading } from '@/services/bloodPressure';
import { BLOOD_PRESSURE_CONTEXT_LABELS } from '@/types/schema';
import type { BloodPressureCategory as BPCategory } from '@/services/bloodPressure';

/**
 * BloodPressureCard — the Wellness-tab card: latest reading + category, when
 * it was taken, optional pulse, and 7-/30-day averages once enough readings
 * exist. A "Log" button opens the entry sheet; the card links to the full
 * history/trends page. Self-contained (reads the shared BP query cache), so it
 * can drop into any dashboard grid.
 */

/** Category tone -> badge classes on the app's token scale. */
const TONE_BADGE: Record<BPCategory['tone'], string> = {
  success: 'bg-status-ok/15 text-status-ok',
  primary: 'bg-action/15 text-action',
  warning: 'bg-status-warn/15 text-status-warn',
  danger: 'bg-status-bad/15 text-status-bad',
};

export const BloodPressureCard = memo(function BloodPressureCard() {
  const {
    latest,
    latestCategory,
    sevenDayAverage,
    thirtyDayAverage,
    entries,
    isLoading,
  } = useBloodPressureLog();
  const [showLog, setShowLog] = useState(false);

  const takenLabel = useMemo(() => {
    if (!latest) return null;
    return getLocalDateString(new Date(latest.measuredAt)) === getLocalDateString()
      ? 'Today'
      : formatDistanceToNow(latest.measuredAt);
  }, [latest]);

  return (
    <Card data-testid="blood-pressure-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Blood pressure</CardTitle>
        <Button size="sm" variant="ghost" onClick={() => setShowLog(true)}>
          + Log
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && !latest ? (
          <div className="h-16 animate-pulse rounded-lg bg-fill" />
        ) : !latest || !latestCategory ? (
          <div className="py-2">
            <p className="text-subhead text-ink-2">No readings yet.</p>
            <p className="text-caption text-ink-3 mt-1">
              Log your first reading to start tracking your trend.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Latest reading */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-large-title font-bold text-ink tabular-nums"
                    data-testid="bp-latest-reading"
                  >
                    {formatReading(latest.systolic, latest.diastolic)}
                  </span>
                  <span className="text-caption text-ink-3">mmHg</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-3">
                  <span>{takenLabel}</span>
                  {latest.pulse != null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>♥ {latest.pulse} bpm</span>
                    </>
                  )}
                  {latest.context && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{BLOOD_PRESSURE_CONTEXT_LABELS[latest.context]}</span>
                    </>
                  )}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-caption font-medium ${TONE_BADGE[latestCategory.tone]}`}
                data-testid="bp-latest-category"
              >
                {latestCategory.label}
              </span>
            </div>

            {/* Crisis-level guidance — calm but clear. */}
            {latestCategory.id === 'crisis' && (
              <p
                className="rounded-lg border border-status-bad/30 bg-status-bad/10 px-3 py-2 text-caption text-status-bad"
                role="alert"
              >
                {latestCategory.advice}
              </p>
            )}

            {/* Averages (only when enough readings exist) */}
            {(sevenDayAverage || thirtyDayAverage) && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <AvgTile
                  label="7-day avg"
                  avg={sevenDayAverage}
                />
                <AvgTile
                  label="30-day trend"
                  avg={thirtyDayAverage}
                />
              </div>
            )}

            <Link
              href="/dashboard/blood-pressure"
              className="inline-block text-caption font-medium text-action"
            >
              View history & trends →
            </Link>
          </div>
        )}
      </CardContent>

      <LogBloodPressureModal isOpen={showLog} onClose={() => setShowLog(false)} />
    </Card>
  );
});

BloodPressureCard.displayName = 'BloodPressureCard';

function AvgTile({
  label,
  avg,
}: {
  label: string;
  avg: { systolic: number; diastolic: number; count: number } | null;
}) {
  return (
    <div className="rounded-lg bg-fill px-3 py-2">
      <p className="text-caption text-ink-3">{label}</p>
      {avg && avg.count > 1 ? (
        <p className="text-subhead font-semibold text-ink tabular-nums">
          {formatReading(avg.systolic, avg.diastolic)}
          <span className="ml-1 text-caption font-normal text-ink-3">
            ({avg.count})
          </span>
        </p>
      ) : (
        <p className="text-subhead text-ink-3">—</p>
      )}
    </div>
  );
}
