import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { DashboardClient } from './DashboardClient';
import {
  fetchMesocycleData,
  fetchNutritionData,
  fetchWeightData,
  fetchUserGoal,
  fetchCompletedWorkoutsCount,
  fetchWeeklyMuscleVolume,
  fetchLiftTrends,
} from '@/lib/actions/dashboard';

// The page awaits its data BEFORE flushing HTML — deliberately no Suspense
// boundary. With one, the hero card streams as a hidden segment that the
// final inline $RC script must swap in; under mobile CPU throttle that
// script queues behind async-chunk execution, recording ~6.5s LCP even
// though all bytes arrive by ~1.4s (perf-item6.md addendum). The server
// fetch is ~450ms, so trading it into TTFB puts the card in the visible
// first flush and LCP lands at FCP. Client-side tab switches keep the
// previous screen while this loads (App Router default without
// loading.tsx), so navigation feel doesn't need a skeleton either.
export default async function DashboardPage() {
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
    muscleVolume,
    liftTrends,
  ] = await Promise.all([
    fetchMesocycleData(user.id),
    fetchNutritionData(user.id),
    fetchWeightData(user.id),
    fetchUserGoal(user.id),
    fetchCompletedWorkoutsCount(user.id),
    fetchWeeklyMuscleVolume(user.id),
    fetchLiftTrends(user.id),
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
        muscleVolume,
        liftTrends,
      }}
    />
  );
}
