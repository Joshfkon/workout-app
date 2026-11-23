'use client';

import Link from 'next/link';
import { ListGroup, Sparkline } from '@/components/ui';
import {
  MIN_SESSIONS_FOR_TREND,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import {
  earlyLiftChange,
  estMaxLabel,
  liftHref,
  moreWorkouts,
  nextTrendHint,
  setLabel,
  signedPct,
  statusOf,
  workoutsUntilTrend,
} from './liftTrendFormat';

interface LiftTrendsCardProps {
  summary: LiftTrendsSummary;
  units: 'lb' | 'kg';
  /** Lifts with an active plateau alert (names), for the "need attention" line. */
  attentionNames?: string[];
  /** Opens the plateau ideas (PlateauAlertList) — shown with the attention line. */
  onSeeIdeas?: () => void;
}

/**
 * A row's facts: the real set first (what lifters compare, "185 lbs × 8"),
 * then the estimate and the weekly change. Separate pieces so each wraps at
 * phone width instead of running under the trend line.
 */
function subtitleParts(lift: LiftTrend, units: 'lb' | 'kg'): { best: string | null; max: string; change: string } {
  const latest = lift.history[lift.history.length - 1];
  // Modality-safe: lift trends skip duration_based exercises (liftTrends.ts).
  const best =
    latest && latest.topSetWeightKg > 0 && latest.topSetReps > 0
      ? `Latest best set ${setLabel(latest.topSetWeightKg, latest.topSetReps, units)}`
      : null;
  // The set is on its own line, so the estimate is just labelled as one.
  const max = estMaxLabel(lift.currentE1RMKg, null, units).replace(/^Est\. max/, 'est. max');
  // A calibrating lift shows NO rate — a fitted slope over a program boundary
  // or an equipment change is noise with a decimal point.
  if (lift.lowConfidence) {
    return {
      best,
      max,
      change: lift.calibrationReason === 'equipment_change' ? 'equipment changed — rebuilding' : 'new program — rebuilding',
    };
  }
  return { best, max, change: signedPct(lift.weeklyChangePct) };
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
  const earlyLifts = summary.earlyLifts ?? [];
  // No trend anywhere yet: name the lift closest to one and how many more
  // workouts it needs, in the user's terms.
  const firstTrendHint = summary.lifts.length === 0 ? nextTrendHint(earlyLifts) : null;

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
        {firstTrendHint && (
          <p className="mt-1 text-subhead text-ink" data-testid="lift-first-trend-hint">
            {firstTrendHint} A trend needs the same lift in {MIN_SESSIONS_FOR_TREND} workouts.
          </p>
        )}
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

      {summary.lifts.length === 0 && earlyLifts.length > 0 ? (
        <div className="space-y-2" data-testid="lift-early-bests">
          <p className="px-1 text-subhead text-ink-2">
            Until then, here is what you have lifted so far: your best set on each lift, and your first vs latest
            workout where you have two.
          </p>
          <ListGroup>
            {earlyLifts.map((l) => {
              const change = earlyLiftChange(l, units);
              const left = workoutsUntilTrend(l.sessions);
              return (
                <div key={l.name} className="flex min-h-[56px] items-center gap-3 px-4 py-2" data-testid="early-lift-row">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-body font-semibold text-ink" data-testid="early-lift-name">
                      {l.name}
                    </span>
                    <span className="block text-subhead text-ink-2 tabular-nums">
                      Best set {setLabel(l.bestWeightKg, l.bestReps, units)}
                    </span>
                    {change && (
                      <span className="block text-subhead text-ink-2 tabular-nums" data-testid="early-lift-change">
                        {change}
                      </span>
                    )}
                  </span>
                  <span className="w-[84px] flex-shrink-0 text-right text-caption text-ink-2">
                    {left > 0 ? `Trend in ${moreWorkouts(left)}` : 'Trend soon'}
                  </span>
                </div>
              );
            })}
          </ListGroup>
        </div>
      ) : summary.lifts.length === 0 ? (
        <div className="rounded-card bg-card p-6 text-center shadow-card">
          <p className="text-body text-ink">
            {summary.insufficientData > 0
              ? 'No lift has enough workouts for a trend yet.'
              : `No lifts logged in the last ${weeks} weeks.`}
          </p>
          <p className="mt-1 text-subhead text-ink-2">
            Finish a workout with weights and your best sets show up here. Log the same lift in{' '}
            {MIN_SESSIONS_FOR_TREND} workouts to see whether it is going up.
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
                  {(() => {
                    const parts = subtitleParts(lift, units);
                    return (
                      <>
                        {parts.best && (
                          <span className="block break-words text-subhead text-ink tabular-nums" data-testid="lift-best-set">
                            {parts.best}
                          </span>
                        )}
                        <span className="flex flex-wrap gap-x-1.5 text-caption text-ink-2 tabular-nums">
                          <span>{parts.max}</span>
                          <span aria-hidden="true">·</span>
                          <span data-testid="lift-trend-change">{parts.change}</span>
                        </span>
                      </>
                    );
                  })()}
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
