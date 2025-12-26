import { SkeletonCard } from '@/components/ui/LoadingAnimation';

export default function DashboardLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Quick actions skeleton */}
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Today's workout skeleton */}
      <SkeletonCard className="h-32" />

      {/* Daily check-in skeleton */}
      <SkeletonCard className="h-24" />

      {/* Muscle recovery skeleton */}
      <SkeletonCard className="h-40" />

      {/* Nutrition skeleton */}
      <SkeletonCard className="h-36" />

      {/* Additional cards */}
      <div className="grid grid-cols-2 gap-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
