import { SkeletonCard } from '@/components/ui/LoadingAnimation';

export default function ExercisesLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Search bar skeleton */}
      <div className="animate-pulse">
        <div className="h-10 bg-surface-700 rounded w-full" />
      </div>

      {/* Filter tabs skeleton */}
      <div className="animate-pulse flex gap-2 overflow-x-auto pb-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-8 bg-surface-700 rounded-full w-20 flex-shrink-0" />
        ))}
      </div>

      {/* Exercise list skeleton */}
      <div className="space-y-2">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="animate-pulse bg-surface-800 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-surface-700 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-surface-700 rounded w-3/4" />
                <div className="h-3 bg-surface-700 rounded w-1/2" />
              </div>
              <div className="h-6 w-6 bg-surface-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
