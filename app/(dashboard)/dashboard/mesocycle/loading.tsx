import { MesocycleSkeleton } from './_components/MesocycleSkeleton';

/** Shown the moment the plan page is opened, while its route loads. */
export default function MesocycleLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading your plan" data-testid="mesocycle-route-loading">
      <div>
        <h1 className="text-title font-bold text-ink">Training block</h1>
        <p className="text-ink-2 mt-1">Plan and track your training blocks</p>
      </div>
      <MesocycleSkeleton />
    </div>
  );
}
