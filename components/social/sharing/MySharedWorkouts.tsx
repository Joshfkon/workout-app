'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatDistanceToNow } from '@/lib/utils';
import type { SharedWorkout } from '@/types/social';

interface SharedWorkoutStats {
  total_shared: number;
  total_views: number;
  total_saves: number;
  total_copies: number;
}

interface MySharedWorkoutsProps {
  userId: string;
  limit?: number;
}

export function MySharedWorkouts({ userId, limit = 3 }: MySharedWorkoutsProps) {
  const [workouts, setWorkouts] = useState<SharedWorkout[]>([]);
  const [stats, setStats] = useState<SharedWorkoutStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSharedWorkouts() {
      const supabase = createClient();

      // Fetch user's shared workouts
      const { data: workoutsData, error } = await supabase
        .from('shared_workouts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching shared workouts:', error);
        setIsLoading(false);
        return;
      }

      setWorkouts(workoutsData || []);

      // Calculate aggregate stats
      const { data: allWorkouts } = await supabase
        .from('shared_workouts')
        .select('view_count, save_count, copy_count')
        .eq('user_id', userId);

      if (allWorkouts) {
        setStats({
          total_shared: allWorkouts.length,
          total_views: allWorkouts.reduce((sum, w) => sum + (w.view_count || 0), 0),
          total_saves: allWorkouts.reduce((sum, w) => sum + (w.save_count || 0), 0),
          total_copies: allWorkouts.reduce((sum, w) => sum + (w.copy_count || 0), 0),
        });
      }

      setIsLoading(false);
    }

    fetchSharedWorkouts();
  }, [userId, limit]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-primary-500" />
        </CardContent>
      </Card>
    );
  }

  if (workouts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Shared Workouts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-surface-400 mb-4">
              You haven&apos;t shared any workouts yet.
            </p>
            <p className="text-sm text-surface-500">
              Share your workouts after completing them to help others train better!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Shared Workouts</CardTitle>
        <Link href="/dashboard/profile/shared">
          <Button variant="ghost" size="sm">View All</Button>
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-4 gap-2 p-3 bg-surface-800 rounded-lg mb-4">
            <div className="text-center">
              <p className="text-lg font-bold text-surface-100">{stats.total_shared}</p>
              <p className="text-xs text-surface-400">Shared</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-surface-100">{stats.total_views}</p>
              <p className="text-xs text-surface-400">Views</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-surface-100">{stats.total_saves}</p>
              <p className="text-xs text-surface-400">Saves</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-surface-100">{stats.total_copies}</p>
              <p className="text-xs text-surface-400">Copies</p>
            </div>
          </div>
        )}

        {/* Recent shared workouts */}
        <div className="space-y-3">
          {workouts.map((workout) => (
            <Link
              key={workout.id}
              href={`/dashboard/discover/${workout.id}`}
              className="block p-3 bg-surface-800/50 hover:bg-surface-800 rounded-lg transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-surface-100 truncate">
                    {workout.title}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-surface-400">
                    <span>{formatDistanceToNow(workout.created_at)}</span>
                    <span className="capitalize">{workout.share_type.replace('_', ' ')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-surface-400 ml-4">
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    {workout.view_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    {workout.save_count}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
