'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { QuickFoodLogger } from '@/components/nutrition/QuickFoodLogger';

interface NutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface Stats {
  workoutsThisWeek: number;
  totalSets: number;
  totalVolume: number;
  avgRpe: number | null;
}

interface MuscleVolumeStats {
  muscle: string;
  sets: number;
  target: number; // MEV to MRV range midpoint
  status: 'low' | 'optimal' | 'high';
}

interface ActiveMesocycle {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  currentWeek: number;
  workoutsCompleted: number;
  totalWorkouts: number;
  splitType?: string;
  daysPerWeek?: number;
}

interface ScheduledWorkout {
  dayName: string;
  muscles: string[];
  dayNumber: number;
}

// Helper to calculate workout schedule based on split type
function getWorkoutForDay(splitType: string, dayOfWeek: number, daysPerWeek: number): ScheduledWorkout | null {
  const splits: Record<string, { dayName: string; muscles: string[] }[]> = {
    'Full Body': [
      { dayName: 'Full Body A', muscles: ['chest', 'back', 'quads', 'shoulders', 'triceps'] },
      { dayName: 'Full Body B', muscles: ['back', 'hamstrings', 'glutes', 'biceps', 'calves'] },
      { dayName: 'Full Body C', muscles: ['chest', 'quads', 'shoulders', 'biceps', 'abs'] },
    ],
    'Upper/Lower': [
      { dayName: 'Upper A', muscles: ['chest', 'back', 'shoulders', 'biceps', 'triceps'] },
      { dayName: 'Lower A', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Upper B', muscles: ['back', 'chest', 'shoulders', 'triceps', 'biceps'] },
      { dayName: 'Lower B', muscles: ['hamstrings', 'quads', 'glutes', 'calves', 'abs'] },
    ],
    'PPL': [
      { dayName: 'Push', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
      { dayName: 'Push 2', muscles: ['chest', 'shoulders', 'triceps'] },
      { dayName: 'Pull 2', muscles: ['back', 'biceps', 'shoulders'] },
      { dayName: 'Legs 2', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Arnold': [
      { dayName: 'Chest & Back', muscles: ['chest', 'back'] },
      { dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
    'Bro Split': [
      { dayName: 'Chest', muscles: ['chest'] },
      { dayName: 'Back', muscles: ['back'] },
      { dayName: 'Shoulders', muscles: ['shoulders'] },
      { dayName: 'Arms', muscles: ['biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ],
  };

  const schedule = splits[splitType] || splits['Upper/Lower'];
  
  // Typical training days (Mon=1, Tue=2, etc., Sun=0->7)
  const trainingDayMaps: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
  };

  const trainingDays = trainingDayMaps[daysPerWeek] || trainingDayMaps[4];
  const dayIndex = trainingDays.indexOf(dayOfWeek);

  if (dayIndex === -1) {
    return null; // Rest day
  }

  const workoutIndex = dayIndex % schedule.length;
  return {
    ...schedule[workoutIndex],
    dayNumber: dayIndex + 1,
  };
}

interface TodaysWorkout {
  id: string;
  state: 'planned' | 'in_progress' | 'completed';
  plannedDate: string;
  completedAt: string | null;
  sessionRpe: number | null;
  exercises: { name: string; sets: number }[];
  totalExercises: number;
  completedSets: number;
  totalSets: number;
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
  const [todaysWorkout, setTodaysWorkout] = useState<TodaysWorkout | null>(null);
  const [scheduledWorkout, setScheduledWorkout] = useState<ScheduledWorkout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolumeStats[]>([]);
  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  const [showQuickLogger, setShowQuickLogger] = useState(false);

  useEffect(() => {
    async function fetchDashboardData() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setIsLoading(false);
        return;
      }

      // Calculate date ranges once
      const now = new Date();
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const weekStart = new Date(now.setDate(diff));
      weekStart.setHours(0, 0, 0, 0);

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      try {
        // OPTIMIZATION: Run all independent queries in parallel
        const [
          userDataResult,
          workoutsThisWeekResult,
          recentWorkoutsResult,
          activeMesocycleResult,
        ] = await Promise.all([
          // User data for onboarding status
          supabase
            .from('users')
            .select('onboarding_completed')
            .eq('id', user.id)
            .single(),

          // Workouts this week with nested data
          supabase
            .from('workout_sessions')
            .select(`
              id,
              session_rpe,
              exercise_blocks!inner (
                id,
                exercises (
                  primary_muscle
                ),
                set_logs!inner (
                  id,
                  weight_kg,
                  reps,
                  is_warmup
                )
              )
            `)
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .gte('completed_at', weekStart.toISOString()),

          // Recent workouts (just metadata, no nested data)
          supabase
            .from('workout_sessions')
            .select('id, completed_at, session_rpe')
            .eq('user_id', user.id)
            .eq('state', 'completed')
            .order('completed_at', { ascending: false })
            .limit(5),

          // Active mesocycle with related session data
          supabase
            .from('mesocycles')
            .select(`
              id,
              name,
              start_date,
              total_weeks,
              days_per_week,
              split_type,
              workout_sessions (
                id,
                state,
                planned_date,
                completed_at,
                session_rpe,
                exercise_blocks (
                  id,
                  target_sets,
                  exercises (
                    name
                  ),
                  set_logs (
                    id,
                    is_warmup
                  )
                )
              )
            `)
            .eq('user_id', user.id)
            .eq('state', 'active')
            .maybeSingle(),
        ]);

        // Set onboarding status
        setOnboardingCompleted(
          (userDataResult.data as { onboarding_completed?: boolean } | null)?.onboarding_completed ?? false
        );

        // Process workouts this week stats
        if (workoutsThisWeekResult.data) {
          const workouts = workoutsThisWeekResult.data;
          let totalSets = 0;
          let totalVolume = 0;
          let rpeSum = 0;
          let rpeCount = 0;

          workouts.forEach((workout: any) => {
            if (workout.session_rpe) {
              rpeSum += workout.session_rpe;
              rpeCount++;
            }

            if (workout.exercise_blocks) {
              workout.exercise_blocks.forEach((block: any) => {
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

          // Calculate volume by muscle group
          const muscleSetCounts: Record<string, number> = {};
          workouts.forEach((workout: any) => {
            if (workout.exercise_blocks) {
              workout.exercise_blocks.forEach((block: any) => {
                const muscle = block.exercises?.primary_muscle || 'unknown';
                const sets = (block.set_logs || []).filter((s: any) => !s.is_warmup).length;
                muscleSetCounts[muscle] = (muscleSetCounts[muscle] || 0) + sets;
              });
            }
          });

          // Default volume targets (MEV to MRV midpoint)
          const volumeTargets: Record<string, number> = {
            chest: 12, back: 14, shoulders: 10, biceps: 8, triceps: 8,
            quads: 12, hamstrings: 10, glutes: 8, calves: 8, abs: 6
          };

          const volumeStats: MuscleVolumeStats[] = Object.entries(muscleSetCounts)
            .filter(([muscle]) => muscle !== 'unknown')
            .map(([muscle, sets]) => {
              const target = volumeTargets[muscle] || 10;
              let status: 'low' | 'optimal' | 'high' = 'optimal';
              if (sets < target * 0.7) status = 'low';
              else if (sets > target * 1.3) status = 'high';
              return { muscle, sets, target, status };
            })
            .sort((a, b) => b.sets - a.sets);

          setMuscleVolume(volumeStats);
        }

        // Set recent workouts
        if (recentWorkoutsResult.data) {
          setRecentWorkouts(recentWorkoutsResult.data);
          setHasWorkouts(recentWorkoutsResult.data.length > 0);
        }

        // Process mesocycle data
        if (activeMesocycleResult.data) {
          const mesocycle = activeMesocycleResult.data;
          const startDate = new Date(mesocycle.start_date);
          const nowDate = new Date();
          const totalWeeks = mesocycle.total_weeks || 6;
          const weeksSinceStart = Math.floor((nowDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const currentWeek = Math.min(Math.max(1, weeksSinceStart), totalWeeks);

          // Count completed workouts from the fetched sessions
          const completedCount = mesocycle.workout_sessions?.filter(
            (s: any) => s.state === 'completed'
          ).length || 0;

          const totalWorkouts = (mesocycle.days_per_week || 3) * totalWeeks;

          const splitType = mesocycle.split_type || 'Upper/Lower';
          const daysPerWeek = mesocycle.days_per_week || 4;

          setActiveMesocycle({
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: totalWeeks,
            currentWeek,
            workoutsCompleted: completedCount,
            totalWorkouts,
            splitType,
            daysPerWeek,
          });

          // Find today's/active workout from the already-fetched sessions
          const sessions = mesocycle.workout_sessions || [];
          const todayISODate = today.toISOString().split('T')[0];

          // Priority: in_progress > today's planned > next upcoming
          const inProgressSession = sessions.find((s: any) => s.state === 'in_progress');
          const todaySession = sessions.find(
            (s: any) => s.planned_date === todayISODate && s.state !== 'completed'
          );
          const nextSession = sessions
            .filter((s: any) => s.state !== 'completed' && s.planned_date >= todayISODate)
            .sort((a: any, b: any) => a.planned_date.localeCompare(b.planned_date))[0];

          const activeSession = inProgressSession || todaySession || nextSession;

          if (activeSession) {
            const exercises = (activeSession.exercise_blocks || []).map((block: any) => ({
              name: block.exercises?.name || 'Unknown',
              sets: block.target_sets || 0,
            }));

            const totalSets = exercises.reduce((sum: number, ex: any) => sum + ex.sets, 0);
            const completedSets = (activeSession.exercise_blocks || []).reduce((sum: number, block: any) => {
              return sum + (block.set_logs || []).filter((s: any) => !s.is_warmup).length;
            }, 0);

            setTodaysWorkout({
              id: activeSession.id,
              state: activeSession.state,
              plannedDate: activeSession.planned_date,
              completedAt: activeSession.completed_at,
              sessionRpe: activeSession.session_rpe,
              exercises,
              totalExercises: exercises.length,
              completedSets,
              totalSets,
            });
          } else {
            // No session exists - check if today is a scheduled workout day based on split
            const todayDayOfWeek = today.getDay() || 7; // Convert Sunday (0) to 7
            const scheduled = getWorkoutForDay(splitType, todayDayOfWeek, daysPerWeek);
            if (scheduled) {
              setScheduledWorkout(scheduled);
            }
          }
        }

        // Fetch today's nutrition data
        const todayStr = today.toISOString().split('T')[0];
        const [nutritionResult, targetsResult] = await Promise.all([
          supabase
            .from('food_log')
            .select('calories, protein, carbs, fat')
            .eq('user_id', user.id)
            .eq('logged_at', todayStr),
          supabase
            .from('nutrition_targets')
            .select('calories, protein, carbs, fat')
            .eq('user_id', user.id)
            .single(),
        ]);

        if (nutritionResult.data) {
          const totals = nutritionResult.data.reduce(
            (acc: NutritionTotals, entry: { calories?: number; protein?: number; carbs?: number; fat?: number }) => ({
              calories: acc.calories + (entry.calories || 0),
              protein: acc.protein + (entry.protein || 0),
              carbs: acc.carbs + (entry.carbs || 0),
              fat: acc.fat + (entry.fat || 0),
            }),
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
          );
          setNutritionTotals(totals);
        }

        if (targetsResult.data) {
          setNutritionTargets(targetsResult.data);
        }

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const handleAddFood = async (food: {
    food_name: string;
    serving_size: string;
    servings: number;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    source: 'usda' | 'manual';
  }) => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const todayStr = new Date().toISOString().split('T')[0];

    await supabase.from('food_log').insert({
      user_id: user.id,
      food_name: food.food_name,
      serving_size: food.serving_size,
      servings: food.servings,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      meal_type: food.meal_type,
      source: food.source,
      logged_at: todayStr,
    });

    // Update local state
    setNutritionTotals((prev) => ({
      calories: prev.calories + food.calories,
      protein: prev.protein + food.protein,
      carbs: prev.carbs + food.carbs,
      fat: prev.fat + food.fat,
    }));
  };

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

      {/* Onboarding Prompt - Show if not completed */}
      {onboardingCompleted === false && (
        <Card className="overflow-hidden border-2 border-accent-500/50 bg-gradient-to-r from-accent-500/10 via-primary-500/10 to-accent-500/10">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500/30 to-primary-500/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-8 h-8 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-white mb-1">Complete Your Strength Profile</h2>
                <p className="text-surface-400 text-sm mb-3">
                  Calibrate your lifts to unlock personalized weight recommendations, percentile rankings, 
                  and identify strength imbalances. Takes about 15-30 minutes.
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-surface-500">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Accurate weight suggestions
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    See how you compare
                  </span>
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Find weak points
                  </span>
                </div>
              </div>
              <Link href="/onboarding">
                <Button size="lg" className="whitespace-nowrap bg-gradient-to-r from-accent-500 to-primary-500 hover:from-accent-600 hover:to-primary-600">
                  Start Calibration
                  <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's Workout - Most prominent */}
      {todaysWorkout && (
        <Card 
          variant="elevated" 
          className={`overflow-hidden border-2 ${
            todaysWorkout.state === 'completed' 
              ? 'border-success-500/50 bg-success-500/5' 
              : todaysWorkout.state === 'in_progress'
              ? 'border-warning-500/50 bg-warning-500/5'
              : 'border-primary-500/50 bg-primary-500/5'
          }`}
        >
          <div className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  {todaysWorkout.state === 'completed' ? (
                    <>
                      <div className="w-12 h-12 rounded-full bg-success-500/20 flex items-center justify-center">
                        <svg className="w-6 h-6 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <Badge variant="success" size="sm">Completed</Badge>
                        <h2 className="text-xl font-bold text-surface-100 mt-1">Today&apos;s Workout Done!</h2>
                      </div>
                    </>
                  ) : todaysWorkout.state === 'in_progress' ? (
                    <>
                      <div className="w-12 h-12 rounded-full bg-warning-500/20 flex items-center justify-center animate-pulse">
                        <svg className="w-6 h-6 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div>
                        <Badge variant="warning" size="sm">In Progress</Badge>
                        <h2 className="text-xl font-bold text-surface-100 mt-1">Workout In Progress</h2>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
                        <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <Badge variant="info" size="sm">Ready</Badge>
                        <h2 className="text-xl font-bold text-surface-100 mt-1">Today&apos;s Workout</h2>
                      </div>
                    </>
                  )}
                </div>

                {/* Exercise list */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {todaysWorkout.exercises.slice(0, 5).map((ex, idx) => (
                    <span 
                      key={idx}
                      className="px-3 py-1 bg-surface-800/70 rounded-full text-sm text-surface-300"
                    >
                      {ex.name} <span className="text-surface-500">×{ex.sets}</span>
                    </span>
                  ))}
                  {todaysWorkout.exercises.length > 5 && (
                    <span className="px-3 py-1 bg-surface-800/70 rounded-full text-sm text-surface-500">
                      +{todaysWorkout.exercises.length - 5} more
                    </span>
                  )}
                </div>

                {/* Progress info */}
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-surface-400">
                    <span className="font-semibold text-surface-200">{todaysWorkout.totalExercises}</span> exercises
                  </span>
                  <span className="text-surface-400">
                    <span className="font-semibold text-surface-200">{todaysWorkout.totalSets}</span> sets
                  </span>
                  {todaysWorkout.state !== 'planned' && (
                    <span className="text-surface-400">
                      <span className={`font-semibold ${todaysWorkout.state === 'completed' ? 'text-success-400' : 'text-warning-400'}`}>
                        {todaysWorkout.completedSets}/{todaysWorkout.totalSets}
                      </span> completed
                    </span>
                  )}
                  {todaysWorkout.sessionRpe && (
                    <span className="text-surface-400">
                      RPE <span className="font-semibold text-surface-200">{todaysWorkout.sessionRpe}</span>
                    </span>
                  )}
                </div>

                {/* Progress bar for in-progress */}
                {todaysWorkout.state === 'in_progress' && todaysWorkout.totalSets > 0 && (
                  <div className="mt-3 h-2 bg-surface-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-warning-500 transition-all duration-500"
                      style={{ width: `${Math.round((todaysWorkout.completedSets / todaysWorkout.totalSets) * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Action button */}
              <div className="flex-shrink-0">
                {todaysWorkout.state === 'completed' ? (
                  <Link href={`/dashboard/workout/${todaysWorkout.id}`}>
                    <Button variant="outline" className="border-success-500/50 text-success-400 hover:bg-success-500/10">
                      <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      View Summary
                    </Button>
                  </Link>
                ) : todaysWorkout.state === 'in_progress' ? (
                  <Link href={`/dashboard/workout/${todaysWorkout.id}`}>
                    <Button className="bg-warning-500 hover:bg-warning-600">
                      <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Continue Workout
                    </Button>
                  </Link>
                ) : (
                  <Link href={`/dashboard/workout/${todaysWorkout.id}`}>
                    <Button size="lg">
                      <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Start Workout
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Rest day card OR Scheduled workout card - active mesocycle but no session exists */}
      {activeMesocycle && !todaysWorkout && (
        <Card className={`overflow-hidden border ${scheduledWorkout ? 'border-primary-500/50 bg-primary-500/5' : 'border-surface-700 bg-surface-800/30'}`}>
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              {scheduledWorkout ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-surface-100">Today&apos;s Workout: {scheduledWorkout.dayName}</h2>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {scheduledWorkout.muscles.slice(0, 4).map((muscle) => (
                        <Badge key={muscle} variant="default" size="sm" className="capitalize">{muscle}</Badge>
                      ))}
                      {scheduledWorkout.muscles.length > 4 && (
                        <Badge variant="default" size="sm">+{scheduledWorkout.muscles.length - 4}</Badge>
                      )}
                    </div>
                  </div>
                  <Link href="/dashboard/mesocycle">
                    <Button>
                      Start Workout
                      <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-surface-700/50 flex items-center justify-center">
                    <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold text-surface-200">Rest Day</h2>
                    <p className="text-sm text-surface-500">No workout scheduled for today. Recovery is part of progress!</p>
                  </div>
                  <Link href="/dashboard/workout/new">
                    <Button variant="outline" size="sm">
                      Start Ad-hoc Workout
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Active Mesocycle - shown below today's workout */}
      {activeMesocycle && (
        <Card className="overflow-hidden border border-surface-700">
          <div className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="default" size="sm">Mesocycle</Badge>
                  <span className="text-xs text-surface-500">Week {activeMesocycle.currentWeek} of {activeMesocycle.weeks}</span>
                </div>
                <h3 className="text-lg font-semibold text-surface-200">{activeMesocycle.name}</h3>
                <div className="flex items-center gap-4 mt-1 text-sm text-surface-500">
                  <span>{activeMesocycle.workoutsCompleted} / {activeMesocycle.totalWorkouts} workouts</span>
                  <span>Started {new Date(activeMesocycle.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
                {/* Progress bar */}
                <div className="mt-2 h-1.5 bg-surface-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-primary-500 transition-all duration-500"
                    style={{ width: `${Math.round((activeMesocycle.currentWeek / activeMesocycle.weeks) * 100)}%` }}
                  />
                </div>
              </div>
              <Link href="/dashboard/mesocycle">
                <Button variant="ghost" size="sm">
                  View Plan
                  <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* Getting started card - no workouts at all */}
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
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-6">
              <Link href="/dashboard/workout/new">
                <Button size="lg">
                  Quick Workout
                  <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </Button>
              </Link>
              <Link href="/dashboard/mesocycle/new">
                <Button size="lg" variant="secondary">
                  Create Training Plan
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      )}

      {/* No mesocycle CTA - shown when user has workouts but no program */}
      {!isLoading && hasWorkouts && !activeMesocycle && (
        <Card className="overflow-hidden border-2 border-dashed border-primary-500/30 bg-gradient-to-r from-primary-500/5 to-accent-500/5">
          <div className="p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-primary-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-lg font-semibold text-surface-100">Level Up Your Training</h3>
                <p className="text-sm text-surface-400 mt-1">
                  Create an AI-powered mesocycle to optimize your workouts with smart progression, fatigue management, and personalized recommendations.
                </p>
                <div className="flex flex-wrap gap-2 mt-2 justify-center sm:justify-start">
                  <span className="text-xs px-2 py-0.5 bg-surface-800 rounded text-surface-400">Auto-progression</span>
                  <span className="text-xs px-2 py-0.5 bg-surface-800 rounded text-surface-400">Volume tracking</span>
                  <span className="text-xs px-2 py-0.5 bg-surface-800 rounded text-surface-400">Deload timing</span>
                </div>
              </div>
              <Link href="/dashboard/mesocycle/new">
                <Button className="whitespace-nowrap">
                  Create Program
                  <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Button>
              </Link>
            </div>
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

      {/* Quick Nutrition Widget */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span>🍎</span> Today&apos;s Nutrition
            </CardTitle>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowQuickLogger(!showQuickLogger)}
                className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors"
                title="Quick log food"
              >
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <Link href="/dashboard/nutrition">
                <Button variant="ghost" size="sm">Full View →</Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showQuickLogger && (
            <div className="mb-4">
              <QuickFoodLogger
                onAdd={handleAddFood}
                onClose={() => setShowQuickLogger(false)}
              />
            </div>
          )}
          
          {nutritionTargets ? (
            <div className="space-y-3">
              {/* Calories */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-surface-300">Calories</span>
                  <span className="text-sm text-surface-400">
                    <span className="font-semibold text-surface-200">{Math.round(nutritionTotals.calories)}</span>
                    {' / '}{nutritionTargets.calories}
                  </span>
                </div>
                <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      nutritionTotals.calories > nutritionTargets.calories
                        ? 'bg-danger-500'
                        : nutritionTotals.calories > nutritionTargets.calories * 0.9
                        ? 'bg-success-500'
                        : 'bg-primary-500'
                    }`}
                    style={{ width: `${Math.min(100, (nutritionTotals.calories / nutritionTargets.calories) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Macros */}
              <div className="grid grid-cols-3 gap-4">
                {/* Protein */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Protein</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.protein)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, (nutritionTotals.protein / nutritionTargets.protein) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">/ {nutritionTargets.protein}g</p>
                </div>

                {/* Carbs */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Carbs</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.carbs)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, (nutritionTotals.carbs / nutritionTargets.carbs) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">/ {nutritionTargets.carbs}g</p>
                </div>

                {/* Fat */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Fat</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.fat)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-pink-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, (nutritionTotals.fat / nutritionTargets.fat) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">/ {nutritionTargets.fat}g</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-surface-400 text-sm mb-3">No nutrition targets set</p>
              <Link href="/dashboard/nutrition">
                <Button variant="outline" size="sm">Set Up Targets</Button>
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

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

        {/* Weekly Volume by Muscle */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Weekly Volume</span>
              <span className="text-xs font-normal text-surface-500">sets per muscle</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {muscleVolume.length > 0 ? (
              <div className="space-y-3">
                {muscleVolume.slice(0, 6).map((mv) => (
                  <div key={mv.muscle} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-surface-300 capitalize">{mv.muscle}</span>
                      <span className={`font-medium ${
                        mv.status === 'optimal' ? 'text-success-400' :
                        mv.status === 'low' ? 'text-warning-400' : 'text-red-400'
                      }`}>
                        {mv.sets}/{mv.target}
                        <span className="text-xs text-surface-500 ml-1">
                          {mv.status === 'low' ? '↓' : mv.status === 'high' ? '↑' : '✓'}
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ${
                          mv.status === 'optimal' ? 'bg-success-500' :
                          mv.status === 'low' ? 'bg-warning-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.min(100, (mv.sets / mv.target) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {muscleVolume.length === 0 && (
                  <p className="text-center text-surface-500 text-sm py-4">
                    Complete workouts to track volume
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-surface-800 flex items-center justify-center">
                  <svg className="w-6 h-6 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <p className="text-surface-400">No volume data yet</p>
                <p className="text-sm text-surface-500 mt-1">
                  Log workouts to track muscle volume
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
