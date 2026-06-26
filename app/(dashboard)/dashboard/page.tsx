import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardClient } from './DashboardClient';
import {
  fetchMesocycleData,
  fetchNutritionData,
  fetchWeightData,
  fetchUserGoal,
  fetchCompletedWorkoutsCount,
} from '@/lib/actions/dashboard';

// Loading fallback for the entire dashboard
function DashboardSkeleton() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto animate-pulse">
      {/* Quick Actions skeleton */}
      <div className="bg-surface-900 rounded-xl p-4">
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 bg-surface-700 rounded-xl" />
              <div className="h-3 w-12 bg-surface-700 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Workout card skeleton */}
      <div className="bg-surface-900 rounded-xl p-6">
        <div className="space-y-4">
          <div className="h-5 w-32 bg-surface-700 rounded" />
          <div className="h-12 w-full bg-surface-800 rounded-lg" />
        </div>
      </div>

      {/* Nutrition skeleton */}
      <div className="bg-surface-900 rounded-xl p-6">
        <div className="space-y-4">
          <div className="h-5 w-24 bg-surface-700 rounded" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1">
              <div className="h-4 w-full bg-surface-700 rounded" />
              <div className="h-2 w-full bg-surface-800 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Server component that fetches initial data
async function DashboardWithData() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch critical data in parallel on the server
  const [
    mesocycleData,
    nutritionData,
    weightData,
    userGoal,
    completedWorkoutsCount,
  ] = await Promise.all([
    fetchMesocycleData(user.id),
    fetchNutritionData(user.id),
    fetchWeightData(user.id),
    fetchUserGoal(user.id),
    fetchCompletedWorkoutsCount(user.id),
  ]);

  // Pass server-fetched data to client component as initial props
  return (
    <DashboardClient
      initialData={{
        userId: user.id,
        mesocycle: mesocycleData.mesocycle,
        todaysWorkout: mesocycleData.todaysWorkout,
        nutritionTotals: nutritionData.totals,
        nutritionTargets: nutritionData.targets,
        todaysWeight: weightData.todaysWeight,
        weightHistory: weightData.weightHistory,
        weightUnit: weightData.preferredUnit,
        userGoal: userGoal as any,
        completedWorkoutsCount,
      }}
    />
  );
}

// Main page with streaming Suspense boundary
export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardWithData />
    </Suspense>
  );
}
