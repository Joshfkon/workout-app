'use client';

import { useState } from 'react';
import Link from 'next/link';
import { IconInfoCircle } from '@tabler/icons-react';
import { ListGroup, Sheet, Sparkline } from '@/components/ui';
import { formatWeight } from '@/lib/utils';
import {
  MIN_SESSIONS_FOR_TREND,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { UNASSIGNED_TRACK_KEY } from '@/services/locationTracks';

interface LiftTrendsCardProps {
  summary: LiftTrendsSummary;
  units: 'lb' | 'kg';
  /** Lifts with an active plateau alert (names), for the "need attention" line. */
  attentionNames?: string[];
  /** Opens the plateau ideas (PlateauAlertList) — shown with the attention line. */
  onSeeIdeas?: () => void;
}

const DIRECTION_LABEL: Record<LiftTrend['direction'], string> = {
  rising: 'Rising',
  flat: 'Flat',
  down: 'Down',
};

const signedPct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%/wk`;

/** "Nov 1" from a local YYYY-MM-DD day. */
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function historyHref(lift: LiftTrend): string {
  return lift.locationLabel
    ? `/dashboard/history?exercise=${lift.exerciseId}&gym=${lift.locationId ?? UNASSIGNED_TRACK_KEY}`
    : `/dashboard/history?exercise=${lift.exerciseId}`;
}

function statusOf(lift: LiftTrend): { label: string; pill: string; stroke: string } {
  if (lift.lowConfidence) return { label: 'Calibrating', pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
  if (lift.direction === 'rising') return { label: DIRECTION_LABEL.rising, pill: 'bg-status-ok-tint text-status-ok', stroke: 'stroke-status-ok' };
  if (lift.direction === 'down') return { label: DIRECTION_LABEL.down, pill: 'bg-status-warn-tint text-status-warn', stroke: 'stroke-status-warn' };
  return { label: DIRECTION_LABEL.flat, pill: 'bg-fill text-ink-2', stroke: 'stroke-ink-3' };
}

function subtitleOf(lift: LiftTrend, units: 'lb' | 'kg'): string {
  // A calibrating lift shows NO rate — a fitted slope over a program boundary
  // or an equipment change is noise with a decimal point.
  if (lift.lowConfidence) {
    return `${formatWeight(lift.currentE1RMKg, units)} est. max · ${
      lift.calibrationReason === 'equipment_change' ? 'equipment changed — rebuilding' : 'new program — rebuilding'
    }`;
  }
  return `${formatWeight(lift.currentE1RMKg, units)} est. max · ${signedPct(lift.weeklyChangePct)}`;
}

/** One lift's trend, opened from its row: big number, chart, recent sessions. */
function LiftDetailSheet({ lift, units, onClose }: { lift: LiftTrend | null; units: 'lb' | 'kg'; onClose: () => void }) {
  const status = lift ? statusOf(lift) : null;
  const points = lift?.history ?? [];
  const values = points.map((p) => p.e1rmKg);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  return (
    <Sheet isOpen={!!lift} onClose={onClose} title={lift?.name} size="lg" grouped>
      {lift && status && (
        <div className="space-y-4" data-testid="lift-detail">
          <div className="rounded-card bg-card p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-caption text-ink-2">Estimated max</p>
                <p className="text-[34px] font-bold leading-10 tracking-tight text-ink tabular-nums">
                  {formatWeight(lift.currentE1RMKg, units)}
                </p>
                <p className="text-subhead text-ink-2">
                  {lift.lowConfidence ? 'Trend rebuilding' : signedPct(lift.weeklyChangePct)} · {lift.sessionCount} sessions
                  {lift.locationLabel ? ` · ${lift.locationLabel}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-caption font-semibold ${status.pill}`}>{status.label}</span>
            </div>
            <Sparkline values={values} width={320} height={110} colorClassName="stroke-action" className="mt-4 w-full" />
            {values.length >= 2 && (
              <div className="mt-1 flex justify-between text-caption text-ink-3 tabular-nums">
                <span>{shortDay(points[0].date)}</span>
                <span>
                  {formatWeight(min, units)}–{formatWeight(max, units)}
                </span>
                <span>{shortDay(points[points.length - 1].date)}</span>
              </div>
            )}
          </div>

          <ListGroup title="Recent sessions">
            {points
              .slice(-5)
              .reverse()
              .map((p) => (
                <div key={p.date} className="flex min-h-[48px] items-center px-4 text-body tabular-nums">
                  <span className="flex-1 text-ink">{formatWeight(p.e1rmKg, units)}</span>
                  <span className="text-subhead text-ink-2">
                    {lift.excludedDates.includes(p.date) ? 'outlier · ' : ''}
                    {shortDay(p.date)}
                  </span>
                </div>
              ))}
          </ListGroup>

          <Link
            href={historyHref(lift)}
            className="flex min-h-[50px] items-center justify-center rounded-card bg-card text-body font-semibold text-action shadow-card"
          >
            All {lift.name} workouts
          </Link>

          <p className="flex gap-2 px-1 text-subhead text-ink-2">
            <IconInfoCircle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>
              Estimated max (e1RM) is the most you could lift for one rep, worked out from your best set each session.
            </span>
          </p>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Strength tab front door (design system "Progress · Strength"): a summary
 * card ("3 of 5 lifts rising" + segmented bar + an attention line that opens
 * plateau ideas), then one row per lift with its trend line and status. A row
 * opens that lift's detail sheet, which links on to its workout history.
 */
export function LiftTrendsCard({ summary, units, attentionNames = [], onSeeIdeas }: LiftTrendsCardProps) {
  const [openLift, setOpenLift] = useState<LiftTrend | null>(null);
  const confident = summary.rising + summary.flat + summary.down;
  const weeks = Math.round(summary.windowDays / 7);
  const rebuilding = summary.rebuilding;

  const attention =
    attentionNames.length > 0
      ? `${attentionNames.length} lift${attentionNames.length === 1 ? ' needs' : 's need'} attention: ${attentionNames
          .slice(0, 2)
          .join(' and ')
          .toLowerCase()}${attentionNames.length > 2 ? ` and ${attentionNames.length - 2} more` : ''}.`
      : summary.stalled
        ? `${summary.stalled.name} has been flat for ${summary.stalled.weeks} week${summary.stalled.weeks === 1 ? '' : 's'}.`
        : null;

  return (
    <section id="lift-trends" className="scroll-mt-4 space-y-4">
      <div className="rounded-card bg-card p-4 shadow-card" data-testid="lift-trends-summary">
        <p className="text-caption text-ink-2">Last {weeks} weeks</p>
        <p className="mt-0.5 text-headline text-ink">
          {confident > 0 ? `${summary.rising} of ${confident} lifts rising` : 'Learning your lifts'}
        </p>
        {confident + rebuilding > 0 && (
          <div className="mt-2.5 flex gap-[3px]" aria-hidden="true">
            {summary.rising > 0 && <div className="h-2 rounded-full bg-status-ok" style={{ flex: summary.rising }} />}
            {summary.flat > 0 && <div className="h-2 rounded-full bg-ink-3" style={{ flex: summary.flat }} />}
            {summary.down > 0 && <div className="h-2 rounded-full bg-status-warn" style={{ flex: summary.down }} />}
            {rebuilding > 0 && <div className="h-2 rounded-full bg-fill" style={{ flex: rebuilding }} />}
          </div>
        )}
        {attention && (
          <p className="mt-2.5 text-subhead text-ink-2">
            {attention}{' '}
            {onSeeIdeas && attentionNames.length > 0 && (
              <button type="button" onClick={onSeeIdeas} className="font-semibold text-action">
                See ideas
              </button>
            )}
          </p>
        )}
        {summary.lifts.some((l) => l.locationLabel) && (
          <p className="mt-1.5 text-caption text-ink-2">Machine lifts trained at more than one gym are trended per gym.</p>
        )}
      </div>

      {summary.lifts.length === 0 ? (
        <div className="rounded-card bg-card p-6 text-center shadow-card">
          <p className="text-body text-ink">No lift has enough history for a trend yet.</p>
          <p className="mt-1 text-subhead text-ink-2">
            Trends need {MIN_SESSIONS_FOR_TREND}+ sessions per lift — keep logging and they&apos;ll appear within a
            couple of weeks.
          </p>
        </div>
      ) : (
        <ListGroup>
          {summary.lifts.map((lift) => {
            const status = statusOf(lift);
            return (
              <button
                key={lift.seriesKey ?? lift.exerciseId}
                type="button"
                onClick={() => setOpenLift(lift)}
                className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-fill"
                data-testid={`lift-row-${lift.seriesKey ?? lift.exerciseId}`}
              >
                <span className="min-w-0 flex-1 py-2.5">
                  <span className="block truncate text-body font-semibold text-ink">
                    {lift.name}
                    {lift.locationLabel && (
                      <span className="font-normal text-ink-2" data-testid="lift-trend-gym">
                        {' '}· {lift.locationLabel}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-subhead text-ink-2 tabular-nums">{subtitleOf(lift, units)}</span>
                </span>
                <Sparkline values={lift.history.map((h) => h.e1rmKg)} colorClassName={status.stroke} />
                <span className={`w-[76px] flex-shrink-0 rounded-full py-1 text-center text-caption font-semibold ${status.pill}`}>
                  {status.label}
                </span>
              </button>
            );
          })}
        </ListGroup>
      )}

      {summary.insufficientData > 0 && summary.lifts.length > 0 && (
        <p className="px-1 text-subhead text-ink-2">
          {summary.insufficientData} more lift{summary.insufficientData === 1 ? '' : 's'} trained recently with fewer than{' '}
          {MIN_SESSIONS_FOR_TREND} sessions — trends appear once there&apos;s enough history.
        </p>
      )}

      <LiftDetailSheet lift={openLift} units={units} onClose={() => setOpenLift(null)} />
    </section>
  );
}
