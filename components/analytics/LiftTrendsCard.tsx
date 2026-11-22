'use client';

import Link from 'next/link';
import { ListGroup, Sparkline } from '@/components/ui';
import { formatWeight } from '@/lib/utils';
import {
  MIN_SESSIONS_FOR_TREND,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { liftHref, signedPct, statusOf } from './liftTrendFormat';

interface LiftTrendsCardProps {
  summary: LiftTrendsSummary;
  units: 'lb' | 'kg';
  /** Lifts with an active plateau alert (names), for the "need attention" line. */
  attentionNames?: string[];
  /** Opens the plateau ideas (PlateauAlertList) — shown with the attention line. */
  onSeeIdeas?: () => void;
}

/**
 * A row's two facts, kept as separate pieces so each can wrap onto its own
 * line at phone width instead of being ellipsized ("+3.0…").
 */
function subtitleParts(lift: LiftTrend, units: 'lb' | 'kg'): { max: string; change: string } {
  const max = `${formatWeight(lift.currentE1RMKg, units)} est. max`;
  // A calibrating lift shows NO rate — a fitted slope over a program boundary
  // or an equipment change is noise with a decimal point.
  if (lift.lowConfidence) {
    return {
      max,
      change: lift.calibrationReason === 'equipment_change' ? 'equipment changed — rebuilding' : 'new program — rebuilding',
    };
  }
  return { max, change: signedPct(lift.weeklyChangePct) };
}

/** Plain explanation of "est. max", shown once where the term first appears. */
export const EST_MAX_EXPLAINER =
  'Est. max = the heaviest single rep your recent sets suggest you could lift.';

/**
 * Strength tab front door (design system "Progress · Strength"): a summary
 * card ("3 of 5 lifts rising" + segmented bar + an attention line that opens
 * plateau ideas), then one row per lift with its trend line and status. A row
 * pushes that lift's own screen (app/(dashboard)/dashboard/analytics/lift).
 */
export function LiftTrendsCard({ summary, units, attentionNames = [], onSeeIdeas }: LiftTrendsCardProps) {
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
          {confident > 0 ? `${summary.rising} of ${confident} lifts rising` : rebuilding > 0
              ? 'Your lift trends are rebuilding'
              : 'No strength trends yet'}
        </p>
        {summary.lifts.length > 0 && (
          <p className="mt-0.5 text-caption text-ink-2" data-testid="est-max-explainer">
            {EST_MAX_EXPLAINER}
          </p>
        )}
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

      {summary.lifts.length === 0 && (summary.earlyLifts?.length ?? 0) > 0 ? (
        <div className="space-y-2" data-testid="lift-early-bests">
          <p className="px-1 text-subhead text-ink-2">
            For now you can see your best set on each lift. Log a lift in {MIN_SESSIONS_FOR_TREND} workouts and
            its strength trend line appears here.
          </p>
          <ListGroup>
            {(summary.earlyLifts ?? []).map((l) => (
              <div key={l.name} className="flex min-h-[52px] items-center gap-3 px-4 py-2">
                <span className="min-w-0 flex-1 break-words text-body font-semibold text-ink" data-testid="early-lift-name">
                  {l.name}
                </span>
                <span className="flex-shrink-0 text-body text-ink tabular-nums">
                  {l.bestWeightKg > 0 ? `${formatWeight(l.bestWeightKg, units)} × ${l.bestReps}` : `${l.bestReps} reps`}
                </span>
                <span className="w-[76px] flex-shrink-0 text-right text-caption text-ink-2">
                  {l.sessions} of {MIN_SESSIONS_FOR_TREND} workouts
                </span>
              </div>
            ))}
          </ListGroup>
        </div>
      ) : summary.lifts.length === 0 ? (
        <div className="rounded-card bg-card p-6 text-center shadow-card">
          <p className="text-body text-ink">No lift has enough history for a trend yet.</p>
          <p className="mt-1 text-subhead text-ink-2">
            Log a lift in {MIN_SESSIONS_FOR_TREND} workouts and its trend shows up here.
          </p>
        </div>
      ) : (
        <ListGroup>
          {summary.lifts.map((lift) => {
            const status = statusOf(lift);
            return (
              <Link
                key={lift.seriesKey ?? lift.exerciseId}
                href={liftHref(lift)}
                className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-fill"
                data-testid={`lift-row-${lift.seriesKey ?? lift.exerciseId}`}
              >
                <span className="min-w-0 flex-1 py-2.5">
                  {/* Names wrap (up to 2 lines) rather than ellipsize. */}
                  <span className="line-clamp-2 break-words text-body font-semibold text-ink" data-testid="lift-trend-name">
                    {lift.name}
                    {lift.locationLabel && (
                      <span className="font-normal text-ink-2" data-testid="lift-trend-gym">
                        {' '}· {lift.locationLabel}
                      </span>
                    )}
                  </span>
                  {/* Max and weekly change are separate pieces that wrap
                      onto their own lines when the row is narrow. */}
                  <span className="flex flex-wrap gap-x-1.5 text-subhead text-ink-2 tabular-nums">
                    <span className="whitespace-nowrap">{subtitleParts(lift, units).max}</span>
                    <span className="whitespace-nowrap" data-testid="lift-trend-change">
                      {subtitleParts(lift, units).change}
                    </span>
                  </span>
                </span>
                <Sparkline values={lift.history.map((h) => h.e1rmKg)} colorClassName={status.stroke} />
                <span className={`w-[76px] flex-shrink-0 rounded-full py-1 text-center text-caption font-semibold ${status.pill}`}>
                  {status.label}
                </span>
              </Link>
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

    </section>
  );
}
