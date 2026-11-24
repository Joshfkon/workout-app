/**
 * The builder's first step, shaped, while its inputs load (cold start only),
 * and the route's loading UI (mesocycle/new/loading.tsx), so tapping "New
 * mesocycle" paints this at once instead of leaving the previous screen up
 * while the route loads.
 */
export function BuilderSkeleton() {
  return (
    <div
      className="max-w-2xl mx-auto space-y-6"
      role="status"
      aria-busy="true"
      data-testid="mesocycle-builder-loading"
    >
      <div>
        <h1 className="text-title font-bold text-ink">Create training block</h1>
        <p className="mt-1 flex items-center gap-2 text-ink-2">
          <span
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent"
            aria-hidden="true"
          />
          Reading your profile and recent training…
        </p>
      </div>
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="h-10 rounded-card bg-card shadow-card" />
        <div className="rounded-card bg-card p-4 shadow-card space-y-3">
          <div className="h-4 w-1/3 rounded bg-fill" />
          <div className="h-10 w-full rounded bg-fill" />
          <div className="h-4 w-1/2 rounded bg-fill" />
          <div className="h-10 w-full rounded bg-fill" />
        </div>
        <div className="h-32 rounded-card bg-card shadow-card" />
      </div>
    </div>
  );
}
