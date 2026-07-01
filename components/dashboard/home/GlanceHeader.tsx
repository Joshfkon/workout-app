'use client';

interface GlanceHeaderProps {
  /** Time-based greeting ("Good morning" etc.), computed client-side by the caller. */
  greeting: string;
  /** Localized date label ("Tuesday, Jul 1"), computed client-side by the caller. */
  todayLabel: string;
}

/**
 * Greeting + date header for the dashboard glance summary.
 * The caller gates rendering on its client-only clock (to avoid SSR hydration
 * mismatch) and passes the derived strings down.
 */
export function GlanceHeader({ greeting, todayLabel }: GlanceHeaderProps) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-surface-100">{greeting}</h1>
      <p className="text-sm text-surface-500">{todayLabel}</p>
    </div>
  );
}
