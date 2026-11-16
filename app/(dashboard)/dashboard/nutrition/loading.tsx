import { SkeletonCard } from '@/components/ui/LoadingAnimation';

export default function NutritionLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      {/* Header: the real title, date navigation skeleton on the right */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-surface-100">Eat</h1>
        <div className="animate-pulse h-6 bg-surface-700 rounded w-32" />
      </div>

      {/* Daily summary skeleton */}
      <div className="animate-pulse bg-surface-800 rounded-lg p-4">
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="text-center space-y-2">
              <div className="h-8 bg-surface-700 rounded w-12 mx-auto" />
              <div className="h-3 bg-surface-700 rounded w-16 mx-auto" />
            </div>
          ))}
        </div>
      </div>

      {/* Macro progress bars skeleton */}
      <SkeletonCard className="h-24" />

      {/* Meal sections skeleton */}
      <div className="space-y-3">
        {['Breakfast', 'Lunch', 'Dinner', 'Snacks'].map((meal) => (
          <div key={meal} className="animate-pulse bg-surface-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="h-5 bg-surface-700 rounded w-20" />
              <div className="h-4 bg-surface-700 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
