/**
 * Region-scoped placeholders for Progress sections whose data arrives from
 * its own fetch (CLAUDE.md cached-first: never a full-page spinner on a
 * revisit). They only render while that region has no data at all — a
 * revisit or reload with a warm cache shows the real section immediately.
 */

function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-fill ${className}`} />;
}

/** The "Are you progressing?" card while weigh-ins / lift trends load. */
export function ProgressSummarySkeleton() {
  return (
    <div
      className="animate-pulse rounded-card bg-card p-4 shadow-card"
      role="status"
      aria-busy="true"
      aria-label="Loading your progress summary"
      data-testid="progress-summary-loading"
    >
      <Bar className="h-3 w-32" />
      <Bar className="mt-2 h-4 w-4/5" />
      <Bar className="mt-2 h-4 w-3/5" />
    </div>
  );
}

/** Strength: the summary card and a few lift rows while lift trends load. */
export function LiftTrendsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      className="animate-pulse space-y-4"
      role="status"
      aria-busy="true"
      aria-label="Loading your lifts"
      data-testid="lift-trends-loading"
    >
      <div className="rounded-card bg-card p-4 shadow-card">
        <Bar className="h-3 w-24" />
        <Bar className="mt-2 h-5 w-40" />
        <Bar className="mt-3 h-2 w-full rounded-full" />
      </div>
      <div className="overflow-hidden rounded-card bg-card shadow-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
            <div className="flex-1 space-y-2">
              <Bar className="h-4 w-2/5" />
              <Bar className="h-3 w-3/5" />
            </div>
            <Bar className="h-6 w-16" />
            <Bar className="h-6 w-[76px] rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
