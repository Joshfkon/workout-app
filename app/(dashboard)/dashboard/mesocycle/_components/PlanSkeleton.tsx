const CARD_CLASS = 'rounded-card bg-card shadow-card';

/** The plan preview's shape while it loads (also plan/loading.tsx, so the
 *  route paints at once instead of keeping the previous screen). */
export function PlanSkeleton() {
  return (
    <div className="max-w-lg mx-auto space-y-4" data-testid="mesocycle-plan-loading">
      <div className={`${CARD_CLASS} p-4 animate-pulse space-y-3`} aria-busy="true">
        <div className="h-3 w-24 bg-fill rounded" />
        <div className="h-6 w-44 bg-fill rounded" />
        <div className="h-3 w-56 bg-fill rounded" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 w-16 bg-fill rounded-xl animate-pulse" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={`${CARD_CLASS} p-4 animate-pulse space-y-2`} aria-busy="true">
          <div className="h-4 w-32 bg-fill rounded" />
          <div className="h-3 w-48 bg-fill rounded" />
        </div>
      ))}
    </div>
  );
}
