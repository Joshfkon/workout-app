'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';

interface Stats {
  workoutsThisWeek: number;
  totalSets: number;
  totalVolume: number;
  avgRpe: number | null;
}

interface ActiveMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  workoutsCompleted: number;
  totalWorkouts: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({
    workoutsThisWeek: 0,
    totalSets: 0,
    totalVolume: 0,
    avgRpe: null,
  });
  const [hasWorkouts, setHasWorkouts] = useState(false);
  const [recentWorkouts, setRecentWorkouts] = useState<any[]>([]);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Get start of current week (Monday)
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);

      // Fetch completed workouts this week
      const { data: workouts } = await supabase
        .from('workout_sessions')
        .select('*, set_logs:exercise_blocks(set_logs(*))')
        .eq('user_id', user.id)
        .eq('state', 'completed')
        .gte('completed_at', weekStart.toISOString());

      // Fetch recent workouts
      const { data: recent } = await supabase
        .from('workout_sessions')
        .select('*')
        .eq('user_id', user.id)
        .eq('state', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5);

      if (workouts) {
        let totalSets = 0;
        let totalVolume = 0;
        let rpeSum = 0;
        let rpeCount = 0;

        workouts.forEach((workout: any) => {
          if (workout.session_rpe) {
            rpeSum += workout.session_rpe;
            rpeCount++;
          }
          // Count sets from nested data
          if (workout.set_logs) {
            workout.set_logs.forEach((block: any) => {
              if (block.set_logs) {
                block.set_logs.forEach((set: any) => {
                  if (!set.is_warmup) {
                    totalSets++;
                    totalVolume += (set.weight_kg || 0) * (set.reps || 0);
                  }
                });
              }
            });
          }
        });

        setStats({
          workoutsThisWeek: workouts.length,
          totalSets,
          totalVolume: Math.round(totalVolume),
          avgRpe: rpeCount > 0 ? Math.round((rpeSum / rpeCount) * 10) / 10 : null,
        });
        setHasWorkouts(workouts.length > 0 || Boolean(recent && recent.length > 0));
      }

      if (recent) {
        setRecentWorkouts(recent);
      }

      // Fetch active mesocycle
      const { data: mesocycle } = await supabase
        .from('mesocycles')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .single();

      if (mesocycle) {
        // Calculate current week
        const startDate = new Date(mesocycle.start_date);
        const now = new Date();
        const weeksSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
        const currentWeek = Math.min(weeksSinceStart, mesocycle.weeks);

        // Count completed workouts in this mesocycle
        const { count: completedCount } = await supabase
          .from('workout_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('mesocycle_id', mesocycle.id)
          .eq('state', 'completed');

        // Calculate total planned workouts (days per week * weeks)
        const totalWorkouts = (mesocycle.days_per_week || 3) * mesocycle.weeks;

        setActiveMesocycle({
          id: mesocycle.id,
          name: mesocycle.name,
          startDate: mesocycle.start_date,
          weeks: mesocycle.weeks,
          currentWeek,
          workoutsCompleted: completedCount || 0,
          totalWorkouts,
        });
      }

      setIsLoading(false);
    }

    fetchDashboardData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Welcome to HyperTrack!</h1>
          <p className="text-surface-400 mt-1">Your intelligent workout tracker</p>
        </div>
        <Link href="/dashboard/workout/new">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Start Workout
          </Button>
        </Link>
      </div>

      {/* Active Mesocycle */}
      {activeMesocycle && (
        <Card variant="elevated" className="overflow-hidden border border-primary-500/30">
          <div className="p-4 sm:p-6 bg-gradient-to-r from-primary-500/10 to-accent-500/5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="info" size="sm">Active Mesocycle</Badge>
                  <span className="text-xs text-surface-500">Week {activeMesocycle.currentWeek} of {activeMesocycle.weeks}</span>
                </div>
                <h2 className="text-xl font-bold text-surface-100">{activeMesocycle.name}</h2>
                <div className="flex items-center gap-4 mt-2 text-sm text-surface-400">
                  <span>{activeMesocycle.workoutsCompleted} / {activeMesocycle.totalWorkouts} workouts</span>
                  <span>Started {new Date(activeMesocycle.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                {/* Progress bar */}
                <div className="mt-3 h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-primary-500 to-accent-500 transition-all duration-500"
                    style={{ width: `${Math.round((activeMesocycle.currentWeek / activeMesocycle.weeks) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/dashboard/workout/new">
                  <Button>
                    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Workout
                  </Button>
                </Link>
                <Link href="/dashboard/mesocycle">
                  <Button variant="outline">View Plan</Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Getting started card */}
      {!isLoading && !hasWorkouts && !activeMesocycle && (
        <Card variant="elevated" className="overflow-hidden">
          <div className="p-8 text-center bg-gradient-to-r from-primary-500/10 to-accent-500/10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">Ready to start training?</h2>
            <p className="text-surface-400 mt-2 max-w-md mx-auto">
              Log your first workout to start tracking your progress, volume, and gains.
            </p>
            <Link href="/dashboard/workout/new">
              <Button size="lg" className="mt-6">
                Start Your First Workout
                <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-surface-500">This Week</p>
            <p className="text-3xl font-bold text-surface-100 mt-1">{stats.workoutsThisWeek}</p>
            <p className="text-xs text-surface-400">workouts</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-surface-500">Total Sets</p>
            <p className="text-3xl font-bold text-primary-400 mt-1">{stats.totalSets}</p>
            <p className="text-xs text-surface-400">working sets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-surface-500">Volume</p>
            <p className="text-3xl font-bold text-surface-100 mt-1">
              {stats.totalVolume > 1000 
                ? `${(stats.totalVolume / 1000).toFixed(1)}k`
                : stats.totalVolume}
            </p>
            <p className="text-xs text-surface-400">kg lifted</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-surface-500">Avg RPE</p>
            <p className="text-3xl font-bold text-surface-100 mt-1">
              {stats.avgRpe !== null ? stats.avgRpe : '—'}
            </p>
            <p className="text-xs text-surface-400">this week</p>
          </CardContent>
        </Card>
      </div>

      {/* Two column layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Workouts */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Workouts</CardTitle>
          </CardHeader>
          <CardContent>
            {recentWorkouts.length > 0 ? (
              <div className="space-y-3">
                {recentWorkouts.map((workout) => (
                  <div key={workout.id} className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg">
                    <div>
                      <p className="text-surface-200 font-medium">
                        {new Date(workout.completed_at).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-sm text-surface-500">
                        RPE: {workout.session_rpe || '—'}
                      </p>
                    </div>
                    <Link href={`/dashboard/workout/${workout.id}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-800 flex items-center justify-center">
                  <svg className="w-6 h-6 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <p className="text-surface-400">No workouts yet</p>
                <p className="text-sm text-surface-500 mt-1">
                  Complete workouts to see them here
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href="/dashboard/workout/new"
                className="flex flex-col items-center p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
              >
                <svg className="w-8 h-8 text-primary-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span className="text-sm text-surface-300">Quick Workout</span>
              </Link>
              <Link
                href="/dashboard/exercises"
                className="flex flex-col items-center p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
              >
                <svg className="w-8 h-8 text-primary-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span className="text-sm text-surface-300">Exercises</span>
              </Link>
              <Link
                href="/dashboard/mesocycle/new"
                className="flex flex-col items-center p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
              >
                <svg className="w-8 h-8 text-primary-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-sm text-surface-300">New Mesocycle</span>
              </Link>
              <Link
                href="/dashboard/settings"
                className="flex flex-col items-center p-4 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors"
              >
                <svg className="w-8 h-8 text-primary-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm text-surface-300">Settings</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
