import { SkeletonCard, SkeletonExercise } from '@/components/ui/LoadingAnimation';

export default function WorkoutLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Header skeleton */}
      <div className="animate-pulse space-y-2">
        <div className="h-6 bg-surface-700 rounded w-48" />
        <div className="h-4 bg-surface-700 rounded w-32" />
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
