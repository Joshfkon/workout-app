import { SkeletonExercise } from '@/components/ui/LoadingAnimation';

export default function ActiveWorkoutLoading() {
  return (
    <div className="space-y-4 p-4">
      {/* Workout header skeleton */}
      <div className="animate-pulse">
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-2">
            <div className="h-6 bg-surface-700 rounded w-40" />
            <div className="h-4 bg-surface-700 rounded w-24" />
          </div>
          <div className="h-10 w-24 bg-surface-700 rounded" />
        </div>
      </div>

      {/* Rest timer panel skeleton */}
      <div className="animate-pulse bg-surface-800 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="h-8 bg-surface-700 rounded w-20" />
          <div className="flex gap-2">
            <div className="h-8 w-8 bg-surface-700 rounded" />
            <div className="h-8 w-8 bg-surface-700 rounded" />
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
