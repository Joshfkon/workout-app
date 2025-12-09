'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';

interface PlannedWorkout {
  id: string;
  planned_date: string;
  state: string;
  exercise_count: number;
}

export default function WorkoutPage() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [inProgressWorkout, setInProgressWorkout] = useState<PlannedWorkout | null>(null);
  const [plannedWorkouts, setPlannedWorkouts] = useState<PlannedWorkout[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchWorkouts() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Fetch in-progress workout
      const { data: inProgress } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          planned_date,
          state,
          exercise_blocks (id)
        `)
        .eq('user_id', user.id)
        .eq('state', 'in_progress')
        .single();

      if (inProgress) {
        setInProgressWorkout({
          id: inProgress.id,
          planned_date: inProgress.planned_date,
          state: inProgress.state,
          exercise_count: inProgress.exercise_blocks?.length || 0,
        });
      }

      // Fetch planned workouts
      const { data: planned } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          planned_date,
          state,
          exercise_blocks (id)
        `)
        .eq('user_id', user.id)
        .eq('state', 'planned')
        .order('planned_date', { ascending: true })
        .limit(5);

      if (planned) {
        setPlannedWorkouts(planned.map((w: any) => ({
          id: w.id,
          planned_date: w.planned_date,
          state: w.state,
          exercise_count: w.exercise_blocks?.length || 0,
        })));
      }

      setIsLoading(false);
    }

    fetchWorkouts();
  }, []);

  const handleQuickStart = () => {
    setIsStarting(true);
    router.push('/dashboard/workout/new');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workouts</h1>
          <p className="text-surface-400 mt-1">Start a workout or view planned sessions</p>
        </div>
        <Button onClick={handleQuickStart} isLoading={isStarting}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Workout
        </Button>
      </div>

      {/* In-progress workout */}
      {inProgressWorkout && (
        <Card variant="elevated" className="border-2 border-warning-500/50">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Badge variant="warning">In Progress</Badge>
                  <h3 className="text-lg font-semibold text-surface-100">
                    Continue Your Workout
                  </h3>
                </div>
                <p className="text-surface-400 mt-1">
                  {inProgressWorkout.exercise_count} exercises • Started {formatDate(inProgressWorkout.planned_date)}
                </p>
              </div>
              <Link href={`/dashboard/workout/${inProgressWorkout.id}`}>
                <Button>Continue</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Planned workouts */}
      {plannedWorkouts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Workouts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {plannedWorkouts.map((workout) => (
                <div
                  key={workout.id}
                  className="flex items-center justify-between p-4 bg-surface-800/50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-surface-200">{formatDate(workout.planned_date)}</p>
                    <p className="text-sm text-surface-500">
                      {workout.exercise_count} exercises planned
                    </p>
                  </div>
                  <Link href={`/dashboard/workout/${workout.id}`}>
                    <Button variant="secondary" size="sm">Start</Button>
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !inProgressWorkout && plannedWorkouts.length === 0 && (
        <Card variant="elevated" className="overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">No planned workouts</h2>
            <p className="text-surface-400 mt-2 max-w-md mx-auto">
              Start a quick workout or create a mesocycle to plan your training.
            </p>
            <div className="flex justify-center gap-3 mt-6">
              <Link href="/dashboard/workout/new">
                <Button>Start Quick Workout</Button>
              </Link>
              <Link href="/dashboard/mesocycle/new">
                <Button variant="secondary">Create Mesocycle</Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Workout templates */}
      <Card>
        <CardHeader>
          <CardTitle>Workout Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-surface-400 mb-4">
            Quick start with a common split:
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Push', muscles: 'Chest, Shoulders, Triceps', icon: '💪' },
              { name: 'Pull', muscles: 'Back, Biceps, Rear Delts', icon: '🏋️' },
              { name: 'Legs', muscles: 'Quads, Hamstrings, Glutes, Calves', icon: '🦵' },
              { name: 'Upper Body', muscles: 'Chest, Back, Shoulders, Arms', icon: '👆' },
              { name: 'Lower Body', muscles: 'Quads, Hamstrings, Glutes, Calves', icon: '👇' },
              { name: 'Full Body', muscles: 'All muscle groups', icon: '🔥' },
            ].map((template) => (
              <Link
                key={template.name}
                href="/dashboard/workout/new"
                className="p-4 bg-surface-800/50 rounded-lg text-left hover:bg-surface-800 transition-colors group"
              >
                <span className="text-2xl mb-2 block">{template.icon}</span>
                <h4 className="font-medium text-surface-200 group-hover:text-surface-100">
                  {template.name}
                </h4>
                <p className="text-xs text-surface-500 mt-1">{template.muscles}</p>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
