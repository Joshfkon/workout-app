'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import { formatWeight } from '@/lib/utils';
import {
  MIN_SESSIONS_FOR_TREND,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';

interface LiftTrendsCardProps {
  summary: LiftTrendsSummary;
  units: 'lb' | 'kg';
}

/** Tiny per-lift E1RM trend line (same visual language as the Weight tile). */
function TrendSparkline({ points, direction, lowConfidence }: {
  points: number[];
  direction: LiftTrend['direction'];
  lowConfidence: boolean;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const polyline = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 26 - ((v - min) / range) * 20 - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const colorClass = lowConfidence
    ? 'text-surface-500'
    : direction === 'rising'
    ? 'text-success-400'
    : direction === 'down'
    ? 'text-danger-400'
    : 'text-surface-400';
  return (
    <svg
      viewBox="0 0 100 26"
      className={`w-24 h-6 flex-shrink-0 ${colorClass}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={polyline}
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

const DIRECTION_LABEL: Record<LiftTrend['direction'], string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%/wk`;

/**
 * Per-lift trend breakdown behind the home "Lifts" glance tile — the detail
 * view for "N rising of M". Rendered from the SAME LiftTrendsSummary shape
 * (computeLiftTrends) the tile aggregates, so the numbers can never disagree.
 * Anchored as #lift-trends for /dashboard/analytics?tab=strength&section=lift-trends.
 */
export function LiftTrendsCard({ summary, units }: LiftTrendsCardProps) {
  const confident = summary.rising + summary.flat + summary.down;
  const weeks = Math.round(summary.windowDays / 7);

  const aggregateParts: string[] = [];
  if (confident > 0) {
    aggregateParts.push(`${summary.rising} rising`, `${summary.flat} flat`, `${summary.down} down`);
  }
  if (summary.rebuilding > 0) aggregateParts.push(`${summary.rebuilding} rebuilding`);
  if (summary.insufficientData > 0) {
    aggregateParts.push(`${summary.insufficientData} building history`);
  }

  return (
    <Card id="lift-trends" className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Lift Trends</CardTitle>
        <p className="text-xs text-surface-500 mt-1">
          Top-set E1RM trend per lift over the last {weeks} weeks · {aggregateParts.join(' · ')}
        </p>
      </CardHeader>
      <CardContent>
        {summary.lifts.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-sm text-surface-400">
              No lift has enough history to fit a trend yet.
            </p>
            <p className="text-xs text-surface-500 mt-1">
              Trends need {MIN_SESSIONS_FOR_TREND}+ sessions per lift — keep logging and they&apos;ll
              appear within a couple of weeks.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {summary.lifts.map((lift) => (
              <Link
                key={lift.exerciseId}
                href={`/dashboard/history?exercise=${lift.exerciseId}`}
                className="flex items-center gap-3 p-3 -mx-1 rounded-lg hover:bg-surface-800/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-surface-200 truncate">{lift.name}</p>
                    {lift.lowConfidence ? (
                      <Badge size="sm" variant="default">Calibrating</Badge>
                    ) : (
                      <Badge
                        size="sm"
                        variant={
                          lift.direction === 'rising'
                            ? 'success'
                            : lift.direction === 'down'
                            ? 'danger'
                            : 'default'
                        }
                      >
                        {DIRECTION_LABEL[lift.direction]}
                      </Badge>
                    )}
                  </div>
                  {/* A calibrating lift shows NO rate — a fitted slope over a
                      program boundary or an equipment change is noise with a
                      decimal point. */}
                  <p className="text-xs text-surface-500 mt-0.5">
                    {lift.lowConfidence
                      ? `${formatWeight(lift.currentE1RMKg, units)} E1RM · ${lift.sessionCount} sessions · ${
                          lift.calibrationReason === 'equipment_change'
                            ? 'possible equipment change — trend rebuilding'
                            : 'new program — trend rebuilds over 2–3 sessions'
                        }`
                      : `${formatWeight(lift.currentE1RMKg, units)} E1RM · ${signedPct(lift.weeklyChangePct)} · ${lift.sessionCount} sessions`}
                  </p>
                </div>
                <TrendSparkline
                  points={lift.history.map((h) => h.e1rmKg)}
                  direction={lift.direction}
                  lowConfidence={lift.lowConfidence}
                />
              </Link>
            ))}
          </div>
        )}
        {summary.insufficientData > 0 && summary.lifts.length > 0 && (
          <p className="text-xs text-surface-500 mt-3">
            {summary.insufficientData} more lift{summary.insufficientData === 1 ? '' : 's'} trained
            recently but with fewer than {MIN_SESSIONS_FOR_TREND} sessions — trends appear once
            enough history accrues.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
