import { SkeletonCard, SkeletonExercise } from '@/components/ui/LoadingAnimation';
import { PendingStartFallback } from './[id]/_components/PendingStartFallback';

/**
 * Right after Start, this boundary shows while the workout screen's code
 * loads: PendingStartFallback renders the start's first exercise instead of
 * the skeleton when the start published one (UX panel round 21).
 */
export default function WorkoutLoading() {
  return <PendingStartFallback fallback={<WorkoutLoadingSkeleton />} />;
}

function WorkoutLoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Header skeleton */}
      <div className="animate-pulse space-y-2">
        <div className="h-6 bg-fill rounded w-48" />
        <div className="h-4 bg-fill rounded w-32" />
      </div>

      {/* Exercise cards skeleton */}
      <div className="space-y-3">
        <SkeletonExercise />
        <SkeletonExercise />
        <SkeletonExercise />
      </div>

      {/* Action buttons skeleton */}
      <SkeletonCard className="h-16" />
    </div>
  );
}
