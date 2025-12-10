'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { formatWeight, formatDuration } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';

interface WorkoutSummary {
  id: string;
  date: string;
  duration: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  sessionRpe: number | null;
  pumpRating: number | null;
}

interface MuscleVolumeData {
  muscle: string;
  sets: number;
  workouts: number;
}

interface ExercisePerformance {
  exerciseId: string;
  exerciseName: string;
  bestWeight: number;
  bestReps: number;
  estimatedE1RM: number;
  totalSets: number;
  lastPerformed: string;
}

interface AnalyticsData {
  totalWorkouts: number;
  totalSets: number;
  totalVolume: number;
  avgWorkoutDuration: number;
  avgSessionRpe: number;
  recentWorkouts: WorkoutSummary[];
  weeklyMuscleVolume: MuscleVolumeData[];
  topExercises: ExercisePerformance[];
  currentStreak: number;
}

// Calculate estimated 1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30); // Simplified for high reps
  return weight * (36 / (37 - reps));
}

export default function AnalyticsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | 'all'>('30d');
  const { preferences } = useUserPreferences();

  useEffect(() => {
    async function fetchAnalytics() {
      setIsLoading(true);
      try {
        const supabase = createUntypedClient();
        
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setIsLoading(false);
          return;
        }

        // Calculate date range
        const now = new Date();
        let startDate: Date | null = null;
        if (timeRange === '7d') {
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (timeRange === '30d') {
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        // Fetch completed workout sessions
        let sessionsQuery = supabase
          .from('workout_sessions')
          .select('*')
          .eq('user_id', user.id)
          .eq('state', 'completed')
          .order('completed_at', { ascending: false });

        if (startDate) {
          sessionsQuery = sessionsQuery.gte('completed_at', startDate.toISOString());
        }

        const { data: sessions, error: sessionsError } = await sessionsQuery;

        if (sessionsError) throw sessionsError;

        if (!sessions || sessions.length === 0) {
          setAnalytics(null);
          setIsLoading(false);
          return;
        }

        // Fetch exercise blocks with exercises for these sessions
        const sessionIds = sessions.map((s: any) => s.id);
        const { data: blocks, error: blocksError } = await supabase
          .from('exercise_blocks')
          .select(`
            *,
            exercises (id, name, primary_muscle)
          `)
          .in('workout_session_id', sessionIds);

        if (blocksError) throw blocksError;

        // Fetch set logs for these blocks
        const blockIds = (blocks || []).map((b: any) => b.id);
        const { data: sets, error: setsError } = await supabase
          .from('set_logs')
          .select('*')
          .in('exercise_block_id', blockIds)
          .eq('is_warmup', false);

        if (setsError) throw setsError;

        // Process the data
        const workingSets = sets || [];
        
        // Calculate totals
        const totalWorkouts = sessions.length;
        const totalSets = workingSets.length;
        const totalVolume = workingSets.reduce((sum: number, s: any) => sum + (s.weight_kg * s.reps), 0);
        
        // Calculate avg duration
        const durations = sessions
          .filter((s: any) => s.started_at && s.completed_at)
          .map((s: any) => {
            const start = new Date(s.started_at).getTime();
            const end = new Date(s.completed_at).getTime();
            return Math.floor((end - start) / 1000);
          });
        const avgWorkoutDuration = durations.length > 0 
          ? Math.floor(durations.reduce((a: number, b: number) => a + b, 0) / durations.length)
          : 0;

        // Calculate avg session RPE
        const rpeSessions = sessions.filter((s: any) => s.session_rpe != null);
        const avgSessionRpe = rpeSessions.length > 0
          ? Math.round((rpeSessions.reduce((sum: number, s: any) => sum + s.session_rpe, 0) / rpeSessions.length) * 10) / 10
          : 0;

        // Build recent workouts list
        const recentWorkouts: WorkoutSummary[] = sessions.slice(0, 5).map((session: any) => {
          const sessionBlocks = (blocks || []).filter((b: any) => b.workout_session_id === session.id);
          const blockIdSet = new Set(sessionBlocks.map((b: any) => b.id));
          const sessionSets = workingSets.filter((s: any) => blockIdSet.has(s.exercise_block_id));
          
          const duration = session.started_at && session.completed_at
            ? Math.floor((new Date(session.completed_at).getTime() - new Date(session.started_at).getTime()) / 1000)
            : 0;
          
          return {
            id: session.id,
            date: session.completed_at || session.planned_date,
            duration,
            totalSets: sessionSets.length,
            totalReps: sessionSets.reduce((sum: number, s: any) => sum + s.reps, 0),
            totalVolume: sessionSets.reduce((sum: number, s: any) => sum + (s.weight_kg * s.reps), 0),
            sessionRpe: session.session_rpe,
            pumpRating: session.pump_rating,
          };
        });

        // Calculate weekly volume per muscle
        const muscleVolumeMap = new Map<string, { sets: number; workouts: Set<string> }>();
        (blocks || []).forEach((block: any) => {
          if (!block.exercises) return;
          const muscle = block.exercises.primary_muscle;
          const blockSets = workingSets.filter((s: any) => s.exercise_block_id === block.id);
          
          if (!muscleVolumeMap.has(muscle)) {
            muscleVolumeMap.set(muscle, { sets: 0, workouts: new Set() });
          }
          const data = muscleVolumeMap.get(muscle)!;
          data.sets += blockSets.length;
          data.workouts.add(block.workout_session_id);
        });

        const weeklyMuscleVolume: MuscleVolumeData[] = Array.from(muscleVolumeMap.entries())
          .map(([muscle, data]) => ({
            muscle,
            sets: data.sets,
            workouts: data.workouts.size,
          }))
          .sort((a, b) => b.sets - a.sets);

        // Calculate top exercises by estimated 1RM
        const exercisePerformanceMap = new Map<string, ExercisePerformance>();
        (blocks || []).forEach((block: any) => {
          if (!block.exercises) return;
          const exerciseId = block.exercises.id;
          const exerciseName = block.exercises.name;
          const blockSets = workingSets.filter((s: any) => s.exercise_block_id === block.id);
          
          blockSets.forEach((set: any) => {
            const e1rm = calculateE1RM(set.weight_kg, set.reps);
            
            if (!exercisePerformanceMap.has(exerciseId)) {
              exercisePerformanceMap.set(exerciseId, {
                exerciseId,
                exerciseName,
                bestWeight: set.weight_kg,
                bestReps: set.reps,
                estimatedE1RM: e1rm,
                totalSets: 0,
                lastPerformed: set.logged_at,
              });
            }
            
            const data = exercisePerformanceMap.get(exerciseId)!;
            data.totalSets += 1;
            if (e1rm > data.estimatedE1RM) {
              data.estimatedE1RM = e1rm;
              data.bestWeight = set.weight_kg;
              data.bestReps = set.reps;
            }
            if (new Date(set.logged_at) > new Date(data.lastPerformed)) {
              data.lastPerformed = set.logged_at;
            }
          });
        });

        const topExercises = Array.from(exercisePerformanceMap.values())
          .sort((a, b) => b.estimatedE1RM - a.estimatedE1RM)
          .slice(0, 10);

        // Calculate current streak
        let currentStreak = 0;
        const sortedSessions = [...sessions].sort((a: any, b: any) => 
          new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
        );
        
        if (sortedSessions.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          
          let lastWorkoutDate = new Date(sortedSessions[0].completed_at);
          lastWorkoutDate.setHours(0, 0, 0, 0);
          
          // Check if last workout was today or yesterday
          const daysSinceLastWorkout = Math.floor((today.getTime() - lastWorkoutDate.getTime()) / (24 * 60 * 60 * 1000));
          
          if (daysSinceLastWorkout <= 2) { // Allow 2-day gap
            currentStreak = 1;
            
            for (let i = 1; i < sortedSessions.length; i++) {
              const prevDate = new Date(sortedSessions[i - 1].completed_at);
              const currDate = new Date(sortedSessions[i].completed_at);
              prevDate.setHours(0, 0, 0, 0);
              currDate.setHours(0, 0, 0, 0);
              
              const gap = Math.floor((prevDate.getTime() - currDate.getTime()) / (24 * 60 * 60 * 1000));
              
              if (gap <= 3) { // Allow 3-day gap between workouts for streak
                currentStreak++;
              } else {
                break;
              }
            }
          }
        }

        setAnalytics({
          totalWorkouts,
          totalSets,
          totalVolume,
          avgWorkoutDuration,
          avgSessionRpe,
          recentWorkouts,
          weeklyMuscleVolume,
          topExercises,
          currentStreak,
        });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchAnalytics();
  }, [timeRange]);

  const unit = preferences.units;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Analytics</h1>
          <p className="text-surface-400 mt-1">Track your progress and identify areas for improvement</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      </div>
    );
  }

  if (!analytics || analytics.totalWorkouts === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Analytics</h1>
          <p className="text-surface-400 mt-1">Track your progress and identify areas for improvement</p>
        </div>

        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No data to analyze yet</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Complete a few workouts to see your volume tracking, strength progress, and more.
          </p>
          <Link href="/dashboard/workout/new">
            <Button className="mt-6">Start Training</Button>
          </Link>
        </Card>

        {/* What you'll see section */}
        <Card>
          <CardHeader>
            <CardTitle>What You&apos;ll See Here</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className="font-medium text-surface-200">Weekly Volume</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Track sets per muscle group against your MEV/MAV/MRV landmarks
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-success-500/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                </div>
                <h3 className="font-medium text-surface-200">Strength Progress</h3>
                <p className="text-sm text-surface-500 mt-1">
                  See your estimated 1RM progression over time for each exercise
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <div className="w-10 h-10 rounded-lg bg-warning-500/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="font-medium text-surface-200">Plateau Alerts</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Get notified when progress stalls with suggestions to break through
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Analytics</h1>
          <p className="text-surface-400 mt-1">Track your progress and identify areas for improvement</p>
        </div>
        
        {/* Time range selector */}
        <div className="flex gap-2 bg-surface-800 p-1 rounded-lg">
          {(['7d', '30d', 'all'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                timeRange === range
                  ? 'bg-primary-500 text-white'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : 'All Time'}
            </button>
          ))}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Workouts</p>
          <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalWorkouts}</p>
          {analytics.currentStreak > 1 && (
            <p className="text-xs text-success-400 mt-1">🔥 {analytics.currentStreak} workout streak</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Total Sets</p>
          <p className="text-2xl font-bold text-primary-400 mt-1">{analytics.totalSets}</p>
          <p className="text-xs text-surface-500 mt-1">
            ~{Math.round(analytics.totalSets / analytics.totalWorkouts)} per workout
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Total Volume</p>
          <p className="text-2xl font-bold text-primary-400 mt-1">
            {formatWeight(analytics.totalVolume / 1000, unit, 0)}k
          </p>
          <p className="text-xs text-surface-500 mt-1">
            ~{formatWeight(analytics.totalVolume / analytics.totalWorkouts, unit, 0)} per workout
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Avg Duration</p>
          <p className="text-2xl font-bold text-primary-400 mt-1">
            {formatDuration(analytics.avgWorkoutDuration)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-surface-500 uppercase tracking-wider">Avg RPE</p>
          <p className="text-2xl font-bold text-primary-400 mt-1">
            {analytics.avgSessionRpe > 0 ? analytics.avgSessionRpe : '-'}
          </p>
          <p className="text-xs text-surface-500 mt-1">
            {analytics.avgSessionRpe >= 8 ? 'High intensity' : analytics.avgSessionRpe >= 6 ? 'Moderate' : 'Building up'}
          </p>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Volume by muscle */}
        <Card>
          <CardHeader>
            <CardTitle>Volume by Muscle Group</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.weeklyMuscleVolume.length === 0 ? (
              <p className="text-surface-500 text-center py-4">No muscle data yet</p>
            ) : (
              <div className="space-y-3">
                {analytics.weeklyMuscleVolume.map((muscle) => {
                  const maxSets = Math.max(...analytics.weeklyMuscleVolume.map(m => m.sets));
                  const percentage = maxSets > 0 ? (muscle.sets / maxSets) * 100 : 0;
                  
                  return (
                    <div key={muscle.muscle}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-surface-200 capitalize">
                          {muscle.muscle}
                        </span>
                        <span className="text-sm text-surface-400">
                          {muscle.sets} sets
                        </span>
                      </div>
                      <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top exercises by E1RM */}
        <Card>
          <CardHeader>
            <CardTitle>Top Exercises (Est. 1RM)</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.topExercises.length === 0 ? (
              <p className="text-surface-500 text-center py-4">No exercise data yet</p>
            ) : (
              <div className="space-y-3">
                {analytics.topExercises.slice(0, 8).map((exercise, idx) => (
                  <div key={exercise.exerciseId} className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      idx < 3 ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-800 text-surface-500'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-200 truncate">
                        {exercise.exerciseName}
                      </p>
                      <p className="text-xs text-surface-500">
                        Best: {formatWeight(exercise.bestWeight, unit)} × {exercise.bestReps}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary-400">
                        {formatWeight(exercise.estimatedE1RM, unit)}
                      </p>
                      <p className="text-xs text-surface-500">{exercise.totalSets} sets</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent workouts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Recent Workouts</CardTitle>
            <Link href="/dashboard/history">
              <Button variant="ghost" size="sm">View All →</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {analytics.recentWorkouts.length === 0 ? (
            <p className="text-surface-500 text-center py-4">No recent workouts</p>
          ) : (
            <div className="space-y-3">
              {analytics.recentWorkouts.map((workout) => (
                <Link 
                  key={workout.id} 
                  href={`/dashboard/workout/${workout.id}`}
                  className="block"
                >
                  <div className="p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-surface-200">
                          {new Date(workout.date).toLocaleDateString('en-US', {
                            weekday: 'short',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </p>
                        <p className="text-xs text-surface-500">
                          {workout.totalSets} sets · {workout.totalReps} reps · {formatWeight(workout.totalVolume, unit)} total
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {workout.sessionRpe && (
                          <Badge variant={workout.sessionRpe >= 8 ? 'danger' : workout.sessionRpe >= 6 ? 'warning' : 'default'}>
                            RPE {workout.sessionRpe}
                          </Badge>
                        )}
                        {workout.pumpRating && (
                          <span className="text-sm">
                            {workout.pumpRating === 5 && '🔥'}
                            {workout.pumpRating === 4 && '😄'}
                            {workout.pumpRating === 3 && '😊'}
                            {workout.pumpRating === 2 && '🙂'}
                            {workout.pumpRating === 1 && '😐'}
                          </span>
                        )}
                        <span className="text-xs text-surface-500">
                          {formatDuration(workout.duration)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
