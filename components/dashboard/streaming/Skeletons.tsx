import { Card, CardHeader, CardContent } from '@/components/ui';

export function WorkoutCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-surface-700 rounded animate-pulse" />
          <div className="h-5 w-32 bg-surface-700 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <div className="h-5 w-40 bg-surface-700 rounded animate-pulse" />
            <div className="h-4 w-24 bg-surface-700 rounded animate-pulse mt-2" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-surface-700 rounded animate-pulse" />
            <div className="h-2 w-full bg-surface-800 rounded-full" />
          </div>
          <div className="h-12 w-full bg-surface-700 rounded-lg animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}

export function NutritionCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-surface-700 rounded animate-pulse" />
            <div className="h-5 w-24 bg-surface-700 rounded animate-pulse" />
          </div>
          <div className="h-4 w-12 bg-surface-700 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="flex justify-between">
                <div className="h-4 w-16 bg-surface-700 rounded animate-pulse" />
                <div className="h-4 w-24 bg-surface-700 rounded animate-pulse" />
              </div>
              <div className="h-2 w-full bg-surface-800 rounded-full" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function WeightCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-surface-700 rounded animate-pulse" />
            <div className="h-5 w-20 bg-surface-700 rounded animate-pulse" />
          </div>
          <div className="h-4 w-16 bg-surface-700 rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-48 w-full bg-surface-800 rounded animate-pulse" />
      </CardContent>
    </Card>
  );
}

export function QuickActionsCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-surface-700 rounded-xl animate-pulse" />
              <div className="h-3 w-12 bg-surface-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function GenericCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="h-5 w-32 bg-surface-700 rounded animate-pulse" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="h-4 w-full bg-surface-700 rounded animate-pulse" />
          <div className="h-4 w-3/4 bg-surface-700 rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-surface-700 rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
