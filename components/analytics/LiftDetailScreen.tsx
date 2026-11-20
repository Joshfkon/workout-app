'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconAlertTriangle, IconBulb, IconChevronLeft, IconInfoCircle } from '@tabler/icons-react';
import { ListGroup, PageSkeleton, Sparkline } from '@/components/ui';
import { formatWeight } from '@/lib/utils';
import { formatLoad } from '@/lib/mcp/summaries';
import { useLiftTrends } from '@/hooks/useLiftTrends';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { LiftTrend, LiftTrendPoint } from '@/app/(dashboard)/dashboard/_lib/liftTrends';
import type { PlateauDetectionResult } from '@/services/plateauDetector';
import { historyHref, shortDay, signedPct, statusOf } from './liftTrendFormat';

const PROGRESS_HREF = '/dashboard/analytics';

/** A logged load, exact (formatLoad), with the app's "lbs" suffix (formatWeight's). */
function loggedLoad(weightKg: number, units: 'lb' | 'kg'): string {
  const exact = formatLoad(weightKg, units);
  return units === 'lb' ? exact.replace(/ lb$/, ' lbs') : exact;
}

/**
 * The session whose top set has the highest estimated max, ignoring the
 * dates the trend fit rejected as outliers (a typo'd 400 kg set is not a PR).
 * Null when every point is an outlier.
 */
export function bestPoint(lift: Pick<LiftTrend, 'history' | 'excludedDates'>): LiftTrendPoint | null {
  let best: LiftTrendPoint | null = null;
  for (const p of lift.history) {
    if (lift.excludedDates.includes(p.date)) continue;
    if (!best || p.e1rmKg > best.e1rmKg) best = p;
  }
  return best;
}

/**
 * "Flat for 4 weeks · 5.0 lbs below your recent best" — the plateau verdict
 * in words. The gap is against the RECENT peak (the detector's window), and
 * only shown when it is visibly non-zero.
 */
export function plateauLine(plateau: PlateauDetectionResult, units: 'lb' | 'kg'): string {
  const weeks = Math.max(1, Math.round(plateau.weeksSinceProgress));
  const head = `Flat for ${weeks} week${weeks === 1 ? '' : 's'}`;
  const gapKg = plateau.recentPeakE1RM - plateau.currentE1RM;
  const gapDisplay = units === 'lb' ? gapKg * 2.20462 : gapKg;
  return gapDisplay >= 0.1 ? `${head} · ${formatWeight(gapKg, units)} below your recent best` : head;
}

function PlateauIdeas({ plateau, units }: { plateau: PlateauDetectionResult; units: 'lb' | 'kg' }) {
  return (
    <section className="space-y-2" data-testid="lift-plateau">
      <div className="flex items-start gap-3 rounded-card bg-status-warn-tint p-4">
        <IconAlertTriangle size={20} className="mt-0.5 flex-shrink-0 text-status-warn" aria-hidden="true" />
        <div>
          <p className="text-headline text-ink">This lift has stalled</p>
          <p className="text-subhead text-ink-2">{plateauLine(plateau, units)}</p>
        </div>
      </div>
      {plateau.suggestions.length > 0 && (
        <ListGroup title="Ideas to get it moving">
          {plateau.suggestions.map((idea) => (
            <div key={idea} className="flex min-h-[48px] items-start gap-3 px-4 py-3 text-body text-ink">
              <IconBulb size={18} className="mt-0.5 flex-shrink-0 text-action" aria-hidden="true" />
              <span>{idea}</span>
            </div>
          ))}
        </ListGroup>
      )}
    </section>
  );
}

function BackBar({ title }: { title: string }) {
  const router = useRouter();
  const back = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(PROGRESS_HREF);
  };
  return (
    <div className="flex items-center gap-1" data-testid="lift-nav">
      <button
        type="button"
        onClick={back}
        className="-ml-2 flex min-h-[44px] items-center gap-0.5 pr-2 text-body text-action"
      >
        <IconChevronLeft size={22} aria-hidden="true" />
        Progress
      </button>
      <h1 className="min-w-0 flex-1 truncate pr-24 text-center text-headline text-ink">{title}</h1>
    </div>
  );
}

/**
 * One lift's own screen, pushed from its Strength row: estimated max with
 * its trend, then every session's best set in the window (newest first, the
 * strongest marked), then a link on to the lift's workouts in History.
 * Reads the same cached summary as the Strength tab (useLiftTrends), so it
 * opens on data, not a spinner.
 */
export function LiftDetailScreen({ seriesKey }: { seriesKey: string }) {
  const { preferences } = useUserPreferences();
  const units: 'lb' | 'kg' = preferences?.units === 'kg' ? 'kg' : 'lb';
  const { data: summary, isPending } = useLiftTrends();
  const lift = summary?.lifts.find((l) => l.seriesKey === seriesKey) ?? null;

  if (!lift) {
    if (isPending) return <PageSkeleton title="Lift" />;
    return (
      <div className="space-y-4">
        <BackBar title="Lift" />
        <div className="rounded-card bg-card p-6 text-center shadow-card" data-testid="lift-missing">
          <p className="text-body text-ink">This lift has no trend right now.</p>
          <p className="mt-1 text-subhead text-ink-2">
            Trends cover your most-trained lifts over the last 12 weeks.
          </p>
          <Link href={PROGRESS_HREF} className="mt-3 inline-block text-body font-semibold text-action">
            Back to Progress
          </Link>
        </div>
      </div>
    );
  }

  const status = statusOf(lift);
  const points = lift.history;
  // The chart follows the trend: points the fit rejected as outliers are
  // listed below (labelled) but not drawn, so one bad entry can't flatten
  // the real line. Fall back to everything if that would leave nothing.
  const fitted = points.filter((p) => !lift.excludedDates.includes(p.date));
  const charted = fitted.length >= 2 ? fitted : points;
  const values = charted.map((p) => p.e1rmKg);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 0;
  const best = bestPoint(lift);
  // `?? null`: a summary persisted before lifts carried `plateau`. A
  // calibrating lift never shows a stall verdict.
  const plateau = lift.lowConfidence ? null : (lift.plateau ?? null);
  const title = lift.locationLabel ? `${lift.name} · ${lift.locationLabel}` : lift.name;

  return (
    <div className="space-y-4" data-testid="lift-detail">
      <BackBar title={title} />

      <div className="rounded-card bg-card p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-caption text-ink-2">Estimated max</p>
            <p className="text-[34px] font-bold leading-10 tracking-tight text-ink tabular-nums">
              {formatWeight(lift.currentE1RMKg, units)}
            </p>
            <p className="text-subhead text-ink-2">
              {lift.lowConfidence ? 'Trend rebuilding' : signedPct(lift.weeklyChangePct)} · {lift.sessionCount} sessions
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-caption font-semibold ${status.pill}`}>{status.label}</span>
        </div>
        <Sparkline values={values} width={320} height={110} colorClassName="stroke-action" className="mt-4 w-full" />
        {values.length >= 2 && (
          <div className="mt-1 flex justify-between text-caption text-ink-3 tabular-nums">
            <span>{shortDay(charted[0].date)}</span>
            <span>
              {formatWeight(min, units)}–{formatWeight(max, units)}
            </span>
            <span>{shortDay(charted[charted.length - 1].date)}</span>
          </div>
        )}
      </div>

      {plateau && <PlateauIdeas plateau={plateau} units={units} />}

      <ListGroup title="Best sets">
        {[...points].reverse().map((p) => {
          const outlier = lift.excludedDates.includes(p.date);
          const isBest = best?.date === p.date;
          return (
            <div
              key={p.date}
              className="flex min-h-[56px] items-center gap-3 px-4 py-2 tabular-nums"
              data-testid={`best-set-${p.date}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink">
                  {loggedLoad(p.topSetWeightKg, units)} × {p.topSetReps}
                </span>
                <span className="block text-subhead text-ink-2">
                  {formatWeight(p.e1rmKg, units)} est. max{outlier ? ' · left out of trend' : ''}
                </span>
              </span>
              {isBest && (
                <span className="rounded-full bg-status-ok-tint px-2 py-0.5 text-caption font-semibold text-status-ok">
                  Best
                </span>
              )}
              <span className="w-14 flex-shrink-0 text-right text-subhead text-ink-2">{shortDay(p.date)}</span>
            </div>
          );
        })}
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
          Each session&apos;s best set is the one with the highest estimated max (e1RM): the most you could lift for one
          rep, worked out from that set&apos;s weight, reps and effort.
        </span>
      </p>
    </div>
  );
}
