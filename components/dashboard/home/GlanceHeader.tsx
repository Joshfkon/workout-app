'use client';

interface GlanceHeaderProps {
  /** Time-based greeting ("Good morning" etc.), computed client-side by the caller. */
  greeting: string;
  /** Localized date label ("Tuesday, Jul 1"), computed client-side by the caller. */
  todayLabel: string;
  /** Mesocycle context ("Week 3 of 5 · PPL"); omitted when no active plan. */
  weekContext?: string | null;
  /** Readiness score (0-100) from today's check-in; pill hidden when null. */
  readinessScore?: number | null;
}

function readinessPillClasses(score: number): string {
  if (score >= 70) return 'bg-success-500/10 text-success-400';
  if (score >= 40) return 'bg-warning-500/10 text-warning-400';
  return 'bg-danger-500/10 text-danger-400';
}

/**
 * Greeting + date header for the home glance view, with mesocycle week context
 * and a readiness pill (from today's daily check-in) on the right.
 * The caller gates rendering on its client-only clock (to avoid SSR hydration
 * mismatch) and passes the derived strings down.
 */
export function GlanceHeader({ greeting, todayLabel, weekContext, readinessScore }: GlanceHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-[17px] font-medium text-surface-100">{greeting}</h1>
        <p className="text-xs text-surface-500 mt-0.5">
          {todayLabel}
          {weekContext ? ` · ${weekContext}` : ''}
        </p>
      </div>
      {typeof readinessScore === 'number' && (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap ${readinessPillClasses(readinessScore)}`}>
          Readiness {readinessScore}
        </span>
      )}
    </div>
  );
}
