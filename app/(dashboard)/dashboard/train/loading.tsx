/**
 * Shown the moment Train is opened, while its route loads. Without a route
 * loading UI the App Router keeps the previous screen up until Train's code
 * arrives, which read as the app making the lifter wait (UX panel round 20).
 * Same shape as the page's own first-visit skeletons.
 */
export default function TrainLoading() {
  return (
    <div className="max-w-lg mx-auto space-y-4" role="status" aria-label="Loading Train" data-testid="train-route-loading">
      <div className="space-y-3">
        <h1 className="text-large-title text-ink">Train</h1>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[88, 100, 96].map((w) => (
            <div key={w} className="h-9 rounded-full bg-card shadow-card animate-pulse" style={{ width: w }} />
          ))}
        </div>
      </div>
      <div className="rounded-card p-4 bg-card shadow-card animate-pulse" aria-hidden="true">
        <div className="h-3 w-1/3 rounded bg-fill" />
        <div className="mt-2 h-6 w-2/3 rounded bg-fill" />
        <div className="mt-2 h-4 w-1/2 rounded bg-fill" />
        <div className="mt-4 h-11 w-full rounded-button bg-fill" />
      </div>
      <div className="rounded-card p-4 bg-card shadow-card animate-pulse space-y-3" aria-hidden="true">
        <div className="h-4 w-24 rounded bg-fill" />
        <div className="h-1.5 rounded-full bg-fill" />
        <div className="h-1.5 w-2/3 rounded-full bg-fill" />
      </div>
    </div>
  );
}
