'use client';

import { useState, useEffect } from 'react';
import { Card, Badge, Button } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';

interface WorkoutHistory {
  id: string;
  planned_date: string;
  completed_at: string | null;
  state: string;
  session_rpe: number | null;
  session_notes: string | null;
  exercise_count: number;
  set_count: number;
}

export default function HistoryPage() {
  const [workouts, setWorkouts] = useState<WorkoutHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchHistory() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Fetch completed and in-progress workouts
      const { data } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          planned_date,
          completed_at,
          state,
          session_rpe,
          session_notes,
          exercise_blocks (
            id,
            set_logs (id)
          )
        `)
        .eq('user_id', user.id)
        .in('state', ['completed', 'in_progress'])
        .order('completed_at', { ascending: false, nullsFirst: false });

      if (data) {
        const transformed = data.map((workout: any) => ({
          id: workout.id,
          planned_date: workout.planned_date,
          completed_at: workout.completed_at,
          state: workout.state,
          session_rpe: workout.session_rpe,
          session_notes: workout.session_notes,
          exercise_count: workout.exercise_blocks?.length || 0,
          set_count: workout.exercise_blocks?.reduce(
            (sum: number, block: any) => sum + (block.set_logs?.length || 0),
            0
          ) || 0,
        }));
        setWorkouts(transformed);
      }

      setIsLoading(false);
    }

    fetchHistory();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
          <p className="text-surface-400 mt-1">Your past training sessions</p>
        </div>
        <Card className="text-center py-12">
          <p className="text-surface-400">Loading...</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
        <p className="text-surface-400 mt-1">Your past training sessions</p>
      </div>

      {workouts.length === 0 ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No workout history yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Complete your first workout to start building your training history.
          </p>
          <Link href="/dashboard/workout/new">
            <Button className="mt-6">Start Your First Workout</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {workouts.map((workout) => (
            <Card key={workout.id} className="overflow-hidden">
              <div className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-surface-100">
                        {workout.completed_at 
                          ? formatDate(workout.completed_at)
                          : formatDate(workout.planned_date)}
                      </h3>
                      <Badge 
                        variant={workout.state === 'completed' ? 'success' : 'warning'}
                        size="sm"
                      >
                        {workout.state === 'completed' ? 'Completed' : 'In Progress'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                      {workout.completed_at && (
                        <span>Finished at {formatTime(workout.completed_at)}</span>
                      )}
                      <span>{workout.exercise_count} exercises</span>
                      <span>{workout.set_count} sets</span>
                      {workout.session_rpe && (
                        <span>RPE: {workout.session_rpe}</span>
                      )}
                    </div>
                    {workout.session_notes && (
                      <p className="mt-2 text-sm text-surface-500 line-clamp-2">
                        {workout.session_notes}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {workout.state === 'in_progress' && (
                      <Link href={`/dashboard/workout/${workout.id}`}>
                        <Button>Continue</Button>
                      </Link>
                    )}
                    <Link href={`/dashboard/workout/${workout.id}`}>
                      <Button variant="outline">View Details</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
