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

/**
 * A Progress tab's content on a true cold start (nothing cached yet): a
 * visible "Loading…" line, so a wait reads as working (UX panel r19: "a
 * loading state with no clear indicator"), over the shape of the cards.
 */
export function ProgressTabSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" data-testid="progress-tab-loading">
      <p className="flex items-center gap-2 px-1 text-subhead text-ink-2">
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
          aria-hidden="true"
        />
        Loading your progress…
      </p>
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="rounded-card bg-card p-4 shadow-card">
          <Bar className="h-3 w-24" />
          <Bar className="mt-2 h-5 w-40" />
          <Bar className="mt-3 h-2 w-full rounded-full" />
        </div>
        <div className="h-40 rounded-card bg-card shadow-card" />
      </div>
    </div>
  );
}

/**
 * The whole Progress frame before the page's client code has rendered (route
 * loading.tsx / the Suspense fallback): the real title and tab bar shapes,
 * so what follows fills in rather than replacing a different screen.
 */
export function ProgressPageSkeleton() {
  return (
    <div className="space-y-6" data-testid="progress-page-skeleton">
      <h1 className="text-large-title text-ink">Progress</h1>
      <ProgressSummarySkeleton />
      <div className="flex h-10 rounded-[10px] bg-fill p-0.5" aria-hidden="true" />
      <ProgressTabSkeleton />
    </div>
  );
}
