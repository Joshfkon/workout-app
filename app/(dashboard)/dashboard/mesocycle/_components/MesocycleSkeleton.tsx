import { Card, CardContent } from '@/components/ui';

/**
 * The plan page's body while it loads: today card + overview, shaped like
 * the loaded layout (no spinner, no layout shift — audit CLS 0.417). Also the
 * route's loading UI (mesocycle/loading.tsx), so opening the plan from Train
 * paints at once instead of keeping the previous screen while the route loads.
 */
export function MesocycleSkeleton() {
  return (
    <>
      <Card variant="elevated" aria-busy="true">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-28 bg-fill rounded" />
            <div className="h-6 w-48 bg-fill rounded" />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-6 w-16 bg-fill rounded-full" />
              ))}
            </div>
            <div className="h-4 w-56 bg-fill rounded" />
          </div>
        </CardContent>
      </Card>
      <Card aria-busy="true">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-6">
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 bg-fill rounded-lg" />
              ))}
            </div>
            <div className="h-2 bg-fill rounded-full" />
            <div className="flex gap-2 overflow-hidden">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-16 min-w-[80px] bg-fill rounded-lg" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
