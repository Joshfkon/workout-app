'use client';

import Link from 'next/link';
import { ListGroup, Sparkline } from '@/components/ui';
import { today as clockToday } from '@/lib/clock';
import {
  MIN_SESSIONS_FOR_TREND,
  type LiftTrend,
  type LiftTrendsSummary,
} from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import { EstMaxMethod } from './EstMaxMethod';
import { liftRateRule, liftStatusRule } from './trendHelp';
import {
  earlyLiftChange,
  estMaxExample,
  estMaxLabel,
  exampleSetPoint,
  liftHref,
  moreWorkouts,
  nextTrendHint,
  notEnoughDataLine,
  risingSlippingNames,
  setLabel,
  signedPct,
  statusOf,
  TREND_RULE,
  WORKOUT_COUNTS_RULE,
  workoutsUntilTrend,
} from './liftTrendFormat';

/** Where "Log a workout" goes: an empty workout, ready for the first set. */
export const LOG_WORKOUT_HREF = '/dashboard/workout/new';

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
function subtitleParts(
  lift: LiftTrend,
  units: 'lb' | 'kg',
  today: string
): { best: string | null; max: string; change: string } {
  const latest = lift.history[lift.history.length - 1];
  // Modality-safe: lift trends skip duration_based exercises (liftTrends.ts).
  const best =
    latest && latest.topSetWeightKg > 0 && latest.topSetReps > 0
      ? `Latest best set ${setLabel(latest.topSetWeightKg, latest.topSetReps, units)}`
      : null;
  // The set is on its own line, so the estimate is just labelled as one.
  const max = estMaxLabel(lift.currentE1RMKg, null, units).replace(/^Estimated max/, 'estimated max');
  // A calibrating lift shows NO rate — a fitted slope over a program boundary
  // or an equipment change is noise with a decimal point.
  if (lift.lowConfidence) {
    return {
      best,
      max,
      change: lift.calibrationReason === 'equipment_change' ? 'equipment changed — rebuilding' : 'new program — rebuilding',
    };
  }
  // Too few workouts, or too close together, for a real rate: say so and
  // what's needed, never "0.0% per week" (UX panel r20: read as a stall).
  if (lift.notEnoughData) return { best, max, change: notEnoughDataLine(lift.notEnoughData, today) };
  return { best, max, change: signedPct(lift.weeklyChangePct) };
}

export { EST_MAX_EXPLAINER } from './EstMaxMethod';

/**
 * How "%/wk" is worked out — an advanced lifter saw every lift "+2%/wk" and
 * couldn't tell whether it came from est. max, rep PRs or something else, so
 * didn't trust any of it (UX panel) — and what makes a lift rising / flat /
 * down (UX panel r19: the "flat" threshold wasn't stated). Plain words, the
 * real threshold (trendHelp), behind the card's one info toggle.
 */
export function rateExplainer(weeks: number, units: 'lb' | 'kg'): string {
  return `${liftRateRule(weeks)} ${liftStatusRule(units)}`;
}

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
  const tooEarly = summary.tooEarly ?? 0;
  const today = clockToday();
  const liftNames = risingSlippingNames(summary.lifts);
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
          {confident > 0
            ? `${summary.rising} of ${confident} lifts rising`
            : rebuilding > 0
              ? 'Your lift trends are rebuilding'
              : tooEarly > 0
                ? 'Not enough data for trends yet'
                : 'No strength trends yet'}
        </p>
        {confident > 0 && liftNames && (
          <p className="mt-0.5 text-subhead text-ink-2" data-testid="lift-trends-names">
            {liftNames}
          </p>
        )}
        {firstTrendHint && (
          <p className="mt-1 text-subhead text-ink" data-testid="lift-first-trend-hint">
            {firstTrendHint} A trend needs the lift in {MIN_SESSIONS_FOR_TREND} separate workouts.
          </p>
        )}
        {/* Lifts with their workouts but no real rate yet: say why and what
            counts, instead of a row of 0.0% (UX panel r20). */}
        {tooEarly > 0 && (
          <p className="mt-1 text-subhead text-ink-2" data-testid="lift-too-early-note">
            {tooEarly} lift{tooEarly === 1 ? ' has' : 's have'} no trend yet. {TREND_RULE} {WORKOUT_COUNTS_RULE}
          </p>
        )}
        {summary.lifts.length > 0 && (
          <EstMaxMethod
            className="mt-1"
            example={estMaxExample(exampleSetPoint(summary.lifts), units)}
            rate={rateExplainer(weeks, units)}
          />
        )}
        {confident + rebuilding + tooEarly > 0 && (
          <div className="mt-2.5 flex gap-[3px]" aria-hidden="true">
            {summary.rising > 0 && <div className="h-2 rounded-full bg-status-ok" style={{ flex: summary.rising }} />}
            {summary.flat > 0 && <div className="h-2 rounded-full bg-ink-3" style={{ flex: summary.flat }} />}
            {summary.down > 0 && <div className="h-2 rounded-full bg-status-warn" style={{ flex: summary.down }} />}
            {rebuilding + tooEarly > 0 && (
              <div className="h-2 rounded-full bg-fill" style={{ flex: rebuilding + tooEarly }} />
            )}
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
            Your best set on each lift so far, and first vs latest where you have two.
          </p>
          {/* Why a lift is "1 more workout" from a trend, and what counts
              (UX panel r20: "the reason isn't explained … what counts as a
              workout"). */}
          <p className="px-1 text-subhead text-ink-2" data-testid="lift-trend-rule">
            {TREND_RULE} {WORKOUT_COUNTS_RULE}
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
        <LiftTrendsEmptyState weeks={weeks} startedLifting={summary.insufficientData > 0} />
      ) : (
        <div className="space-y-2">
        <p className="px-1 text-subhead text-ink-2" data-testid="lift-tap-hint">
          Tap a lift to see its estimated max over time.
        </p>
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
                    const parts = subtitleParts(lift, units, today);
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
        </div>
      )}

      {summary.insufficientData > 0 && summary.lifts.length > 0 && (
        <p className="px-1 text-subhead text-ink-2" data-testid="lift-insufficient-note">
          {summary.insufficientData} more lift{summary.insufficientData === 1 ? ' has' : 's have'} no trend yet: each
          needs {MIN_SESSIONS_FOR_TREND} separate workouts. {WORKOUT_COUNTS_RULE}
        </p>
      )}

    </section>
  );
}

/**
 * Strength with nothing to show yet: what will appear here and after how
 * many workouts, and one big next step (UX panel r19: "The strength tab was
 * empty. It had no button to go and log a workout", and "repeat the same
 * lift 3 times" read as 3 sets).
 */
export function LiftTrendsEmptyState({ weeks, startedLifting }: { weeks: number; startedLifting: boolean }) {
  return (
    <div className="rounded-card bg-card p-5 shadow-card" data-testid="lift-trends-empty">
      <p className="text-headline text-ink">
        {startedLifting ? 'Your lifts are on their way' : `No lifts logged in the last ${weeks} weeks.`}
      </p>
      <ul className="mt-2 space-y-1.5 text-body text-ink-2" data-testid="lift-trends-empty-what">
        <li>
          <span className="font-semibold text-ink">After 1 workout:</span> your best set on each lift shows up here.
        </li>
        <li>
          <span className="font-semibold text-ink">After {MIN_SESSIONS_FOR_TREND} workouts with the same lift:</span>{' '}
          you&apos;ll see whether it&apos;s going up, flat or down. Sets in one workout count once.
        </li>
      </ul>
      {/* The empty state's one next step: straight into an empty workout. */}
      <Link
        href={LOG_WORKOUT_HREF}
        className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-button bg-action px-5 text-body font-semibold text-on-action"
        data-testid="lift-trends-log-workout"
      >
        Log a workout
      </Link>
    </div>
  );
}
