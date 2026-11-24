import { SkeletonExercise } from '@/components/ui/LoadingAnimation';
import { PendingStartFallback } from './_components/PendingStartFallback';

/**
 * Right after Start, this boundary shows while the workout screen's code
 * loads: PendingStartFallback renders the start's first exercise instead of
 * the skeleton when the start published one (UX panel round 21).
 */
export default function ActiveWorkoutLoading() {
  return <PendingStartFallback fallback={<ActiveWorkoutLoadingSkeleton />} />;
}

function ActiveWorkoutLoadingSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Workout header skeleton */}
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-2">
            <div className="h-6 bg-fill rounded w-40" />
            <div className="h-4 bg-fill rounded w-24" />
          </div>
          <div className="h-10 w-24 bg-fill rounded" />
        </div>
      </div>

      {/* Words with the skeleton: the start flow hands off here, and a silent
          skeleton read as "is it still working?" (UX panel round 19). */}
      <p role="status" className="text-subhead text-ink-3">
        Opening your workout…
      </p>

      {/* Rest timer panel skeleton */}
      <div className="animate-pulse bg-card rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-fill rounded w-20" />
          <div className="flex gap-2">
            <div className="h-8 w-8 bg-fill rounded" />
            <div className="h-8 w-8 bg-fill rounded" />
          </div>
        </div>
      </div>

      {/* Exercise cards skeleton */}
      <div className="space-y-3">
        <SkeletonExercise />
        <SkeletonExercise />
        <SkeletonExercise />
        <SkeletonExercise />
      </div>
    </div>
  );
}
