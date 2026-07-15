'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, Button, ConfirmModal } from '@/components/ui';
import { LogBloodPressureModal } from '@/components/dashboard/LogBloodPressureModal';
import { useBloodPressureLog } from '@/hooks/useBloodPressureLog';
import {
  filterByPeriod,
  summarizeReadings,
  groupByDay,
  classifyBloodPressure,
  formatReading,
  type BloodPressurePeriod,
} from '@/services/bloodPressure';
import { formatDate } from '@/lib/utils';
import { BLOOD_PRESSURE_CONTEXT_LABELS } from '@/types/schema';
import type { BloodPressureEntry } from '@/types/schema';

// Chart pulls in Recharts — load it on demand so the list paints instantly.
const BloodPressureGraph = dynamic(
  () =>
    import('@/components/analytics/BloodPressureGraph').then(
      (m) => m.BloodPressureGraph
    ),
  { ssr: false, loading: () => <div className="h-48" /> }
);

const PERIODS: { id: BloodPressurePeriod; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All' },
];

const TONE_BADGE: Record<string, string> = {
  success: 'bg-success-500/15 text-success-300',
  primary: 'bg-primary-500/15 text-primary-300',
  warning: 'bg-warning-500/15 text-warning-300',
  danger: 'bg-danger-500/15 text-danger-300',
};
const TONE_DOT: Record<string, string> = {
  success: 'bg-success-400',
  primary: 'bg-primary-400',
  warning: 'bg-warning-400',
  danger: 'bg-danger-400',
};

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function BloodPressurePage() {
  const { entries, isLoading, deleteReading } = useBloodPressureLog();
  const [period, setPeriod] = useState<BloodPressurePeriod>('30d');
  const [showLog, setShowLog] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BloodPressureEntry | null>(null);

  const filtered = useMemo(() => filterByPeriod(entries, period), [entries, period]);
  const summary = useMemo(() => summarizeReadings(filtered), [filtered]);
  const days = useMemo(() => groupByDay(filtered), [filtered]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    await deleteReading(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <div className="space-y-4 animate-fade-in pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-[17px] font-medium text-surface-100">Blood Pressure</h1>
        <Button size="sm" onClick={() => setShowLog(true)}>
          + Log reading
        </Button>
      </div>

      {/* Period filter */}
      <div className="flex gap-1 bg-surface-800 rounded-lg p-0.5 w-fit">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              period === p.id
                ? 'bg-primary-500 text-white'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading && entries.length === 0 ? (
        <Card>
          <CardContent>
            <div className="h-32 animate-pulse rounded-lg bg-surface-800" />
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-surface-300 font-medium">No readings yet</p>
            <p className="text-sm text-surface-500 mt-1 mb-4">
              Log your first blood pressure reading to start tracking your trend.
            </p>
            <Button onClick={() => setShowLog(true)}>Log your first reading</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary stats */}
          {summary && (
            <Card>
              <CardContent>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-xs text-surface-500">Average this period</p>
                    <p className="text-2xl font-bold text-surface-100 tabular-nums">
                      {formatReading(summary.avgSystolic, summary.avgDiastolic)}
                      <span className="ml-1.5 text-xs font-normal text-surface-500">
                        mmHg
                      </span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_BADGE[summary.category.tone]}`}
                  >
                    {summary.category.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <Stat
                    label="Systolic min/max"
                    value={`${summary.minSystolic}–${summary.maxSystolic}`}
                  />
                  <Stat
                    label="Diastolic min/max"
                    value={`${summary.minDiastolic}–${summary.maxDiastolic}`}
                  />
                  <Stat
                    label="Avg pulse"
                    value={summary.avgPulse != null ? `${summary.avgPulse} bpm` : '—'}
                  />
                  <Stat label="Readings" value={String(summary.count)} />
                </div>
                {/* Non-diagnostic footnote. */}
                <p className="text-[11px] text-surface-500 mt-3 leading-relaxed">
                  Ranges are informational and not a diagnosis. Talk to a clinician
                  about persistent high readings or any concerning symptoms.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Trend chart */}
          <Card>
            <CardContent>
              <p className="text-sm font-medium text-surface-200 mb-2">Trend</p>
              <BloodPressureGraph readings={filtered} period={period} />
            </CardContent>
          </Card>

          {/* History grouped by day */}
          <div className="space-y-3">
            <h2 className="text-[15px] font-medium text-surface-100">History</h2>
            {days.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-center text-sm text-surface-400">
                  No readings in this period.
                </CardContent>
              </Card>
            ) : (
              days.map((day) => (
                <Card key={day.localDay}>
                  <CardContent>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium text-surface-200">
                        {formatDate(day.localDay, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      {day.readings.length > 1 && (
                        <p className="text-xs text-surface-500">
                          Daily avg{' '}
                          <span className="font-medium text-surface-300 tabular-nums">
                            {formatReading(day.average.systolic, day.average.diastolic)}
                          </span>
                        </p>
                      )}
                    </div>
                    <ul className="divide-y divide-surface-800">
                      {day.readings.map((r) => {
                        const cat = classifyBloodPressure(r.systolic, r.diastolic);
                        return (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-3 py-2"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[cat.tone]}`}
                                aria-hidden="true"
                              />
                              <div className="min-w-0">
                                <p className="text-sm text-surface-100 tabular-nums">
                                  {formatReading(r.systolic, r.diastolic)}
                                  {r.pulse != null && (
                                    <span className="ml-2 text-xs text-surface-500">
                                      ♥ {r.pulse}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-surface-500 truncate">
                                  {timeLabel(r.measuredAt)}
                                  {r.context && (
                                    <> · {BLOOD_PRESSURE_CONTEXT_LABELS[r.context]}</>
                                  )}
                                  {r.notes && <> · {r.notes}</>}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => setPendingDelete(r)}
                              className="shrink-0 text-xs text-surface-500 hover:text-danger-400 transition-colors"
                              aria-label="Delete reading"
                            >
                              Delete
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </>
      )}

      <LogBloodPressureModal isOpen={showLog} onClose={() => setShowLog(false)} />
      <ConfirmModal
        isOpen={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDelete}
        title="Delete reading?"
        message="This removes the reading permanently."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-800 px-2 py-2">
      <p className="text-[11px] text-surface-500">{label}</p>
      <p className="text-sm font-semibold text-surface-100 tabular-nums">{value}</p>
    </div>
  );
}
