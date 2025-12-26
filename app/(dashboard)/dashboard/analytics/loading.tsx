import { SkeletonCard } from '@/components/ui/LoadingAnimation';

export default function AnalyticsLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Page header skeleton */}
      <div className="animate-pulse">
        <div className="h-7 bg-surface-700 rounded w-32 mb-2" />
        <div className="h-4 bg-surface-700 rounded w-48" />
      </div>

      {/* Summary stats skeleton */}
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Chart skeleton */}
      <div className="animate-pulse bg-surface-800 rounded-lg p-4">
        <div className="h-5 bg-surface-700 rounded w-40 mb-4" />
        <div className="h-48 bg-surface-700 rounded" />
      </div>

      {/* Additional charts skeleton */}
      <SkeletonCard className="h-64" />
      <SkeletonCard className="h-48" />
    </div>
  );
}
