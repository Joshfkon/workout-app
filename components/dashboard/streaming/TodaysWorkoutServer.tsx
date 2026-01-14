import { fetchMesocycleData } from '@/lib/actions/dashboard';
import { Card, CardHeader, CardTitle, CardContent, Badge } from '@/components/ui';
import Link from 'next/link';

interface Props {
  userId: string;
}

export async function TodaysWorkoutServer({ userId }: Props) {
  const { mesocycle, todaysWorkout } = await fetchMesocycleData(userId);

  if (!mesocycle) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Today&apos;s Workout
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <p className="text-surface-400 mb-4">No active training program</p>
            <Link
              href="/dashboard/mesocycle"
              className="inline-flex items-center gap-2 text-primary-400 hover:text-primary-300"
            >
              <span>Create a mesocycle to get started</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (todaysWorkout) {
    const progress = todaysWorkout.totalSets > 0
      ? Math.round((todaysWorkout.completedSets / todaysWorkout.totalSets) * 100)
      : 0;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Today&apos;s Workout
            </CardTitle>
            <Badge variant={todaysWorkout.state === 'in_progress' ? 'warning' : 'default'}>
              {todaysWorkout.state === 'in_progress' ? 'In Progress' : 'Scheduled'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-surface-100">{todaysWorkout.name}</h3>
              <p className="text-sm text-surface-400">{todaysWorkout.exercises} exercises</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-surface-400">Progress</span>
                <span className="text-surface-200">{todaysWorkout.completedSets}/{todaysWorkout.totalSets} sets</span>
              </div>
              <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <Link
              href={`/dashboard/workout/${todaysWorkout.id}`}
              className="block w-full py-3 px-4 bg-primary-600 hover:bg-primary-500 text-white text-center font-medium rounded-lg transition-colors"
            >
              {todaysWorkout.state === 'in_progress' ? 'Continue Workout' : 'Start Workout'}
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Rest day or no workout scheduled
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Today&apos;s Workout
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-4">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-surface-300 font-medium">Rest Day</p>
          <p className="text-sm text-surface-500 mt-1">Recovery is part of the process</p>
        </div>
        <div className="mt-4 pt-4 border-t border-surface-800">
          <div className="flex justify-between text-sm">
            <span className="text-surface-400">Week {mesocycle.currentWeek} of {mesocycle.weeks}</span>
            <span className="text-surface-300">{mesocycle.workoutsCompleted}/{mesocycle.totalWorkouts} workouts</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
