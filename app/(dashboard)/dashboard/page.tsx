'use client';

import { useState, useEffect } from 'react';
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

interface MuscleVolumeStats {
  muscle: string;
  sets: number;
  target: number;
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

interface TodaysWorkout {
  id: string;
  name: string;
  state: 'planned' | 'in_progress' | 'completed';
  exercises: number;
  completedSets: number;
  totalSets: number;
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
    ],
    'Arnold': [
      { dayName: 'Chest & Back', muscles: ['chest', 'back'] },
      { dayName: 'Shoulders & Arms', muscles: ['shoulders', 'biceps', 'triceps'] },
      { dayName: 'Legs', muscles: ['quads', 'hamstrings', 'glutes', 'calves', 'abs'] },
    ],
  };

  const schedule = splits[splitType] || splits['Upper/Lower'];
  const trainingDayMaps: Record<number, number[]> = {
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 5, 6],
    6: [1, 2, 3, 4, 5, 6],
  };

  const trainingDays = trainingDayMaps[daysPerWeek] || trainingDayMaps[4];
  const dayIndex = trainingDays.indexOf(dayOfWeek);

  if (dayIndex === -1) return null;

  const workoutIndex = dayIndex % schedule.length;
  return { ...schedule[workoutIndex], dayNumber: dayIndex + 1 };
}

export default function DashboardPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [activeMesocycle, setActiveMesocycle] = useState<ActiveMesocycle | null>(null);
  const [todaysWorkout, setTodaysWorkout] = useState<TodaysWorkout | null>(null);
  const [scheduledWorkout, setScheduledWorkout] = useState<ScheduledWorkout | null>(null);
  const [nutritionTotals, setNutritionTotals] = useState<NutritionTotals>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [nutritionTargets, setNutritionTargets] = useState<NutritionTargets | null>(null);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolumeStats[]>([]);
  const [showQuickLogger, setShowQuickLogger] = useState(false);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();

        // Fetch active mesocycle with workout sessions
        const { data: mesocycle } = await supabase
          .from('mesocycles')
          .select(`
            id, name, start_date, weeks, split_type, days_per_week,
            workout_sessions (id, planned_date, state, completed_at)
          `)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single();

        if (mesocycle) {
          const startDate = new Date(mesocycle.start_date);
          const weeksSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const sessions = mesocycle.workout_sessions || [];
          const completed = sessions.filter((s: any) => s.state === 'completed').length;

          setActiveMesocycle({
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.weeks,
            currentWeek: Math.min(weeksSinceStart, mesocycle.weeks),
            workoutsCompleted: completed,
            totalWorkouts: sessions.length,
            splitType: mesocycle.split_type,
            daysPerWeek: mesocycle.days_per_week,
          });

          // Check for today's workout session
          const todaySession = sessions.find((s: any) => 
            s.planned_date === todayStr || s.state === 'in_progress'
          );

          if (todaySession) {
            // Fetch exercise count for today's session
            const { data: blocks } = await supabase
              .from('exercise_blocks')
              .select('id, target_sets')
              .eq('workout_session_id', todaySession.id);

            const { data: setLogs } = await supabase
              .from('set_logs')
              .select('id')
              .in('exercise_block_id', (blocks || []).map((b: any) => b.id))
              .eq('is_warmup', false);

            setTodaysWorkout({
              id: todaySession.id,
              name: mesocycle.name,
              state: todaySession.state,
              exercises: (blocks || []).length,
              completedSets: (setLogs || []).length,
              totalSets: (blocks || []).reduce((sum: number, b: any) => sum + (b.target_sets || 3), 0),
            });
          } else {
            // Check if workout is scheduled for today based on split
            const scheduled = getWorkoutForDay(
              mesocycle.split_type || 'Upper/Lower',
              dayOfWeek,
              mesocycle.days_per_week || 4
            );
            setScheduledWorkout(scheduled);
          }
        }

        // Fetch nutrition data
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
            (acc: NutritionTotals, entry: any) => ({
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

        // Fetch weekly volume by muscle
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        
        const { data: weeklyBlocks } = await supabase
          .from('exercise_blocks')
          .select(`
            target_sets,
            exercises (primary_muscle),
            workout_sessions!inner (user_id, completed_at)
          `)
          .eq('workout_sessions.user_id', user.id)
          .gte('workout_sessions.completed_at', weekStart.toISOString());

        if (weeklyBlocks && weeklyBlocks.length > 0) {
          const volumeByMuscle: Record<string, number> = {};
          weeklyBlocks.forEach((block: any) => {
            const muscle = block.exercises?.primary_muscle;
            if (muscle) {
              volumeByMuscle[muscle] = (volumeByMuscle[muscle] || 0) + (block.target_sets || 3);
            }
          });

          const volumeTargets: Record<string, number> = {
            chest: 12, back: 14, shoulders: 12, quads: 12, hamstrings: 10,
            glutes: 10, biceps: 10, triceps: 10, calves: 8, abs: 8,
          };

          const stats: MuscleVolumeStats[] = Object.entries(volumeByMuscle)
            .map(([muscle, sets]) => {
              const target = volumeTargets[muscle] || 10;
              const status: 'low' | 'optimal' | 'high' = sets < target * 0.7 ? 'low' : sets > target * 1.3 ? 'high' : 'optimal';
              return { muscle, sets, target, status };
            })
            .sort((a, b) => b.sets - a.sets);

          setMuscleVolume(stats);
        }

      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  const handleAddFood = async (food: any) => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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
      source: food.source || 'manual',
      logged_at: new Date().toISOString().split('T')[0],
    });

    setNutritionTotals((prev) => ({
      calories: prev.calories + food.calories,
      protein: prev.protein + food.protein,
      carbs: prev.carbs + food.carbs,
      fat: prev.fat + food.fat,
    }));
    setShowQuickLogger(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* ===== TODAY'S WORKOUT ===== */}
      {todaysWorkout ? (
        <Card className={`overflow-hidden border-2 ${
          todaysWorkout.state === 'completed' 
            ? 'border-success-500/50 bg-success-500/5' 
            : todaysWorkout.state === 'in_progress'
            ? 'border-warning-500/50 bg-warning-500/5'
            : 'border-primary-500/50 bg-primary-500/5'
        }`}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  todaysWorkout.state === 'completed' ? 'bg-success-500/20' :
                  todaysWorkout.state === 'in_progress' ? 'bg-warning-500/20' : 'bg-primary-500/20'
                }`}>
                  {todaysWorkout.state === 'completed' ? (
                    <svg className="w-6 h-6 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  )}
                </div>
                <div>
                  <Badge variant={todaysWorkout.state === 'completed' ? 'success' : todaysWorkout.state === 'in_progress' ? 'warning' : 'default'} size="sm">
                    {todaysWorkout.state === 'completed' ? 'Done' : todaysWorkout.state === 'in_progress' ? 'In Progress' : 'Ready'}
                  </Badge>
                  <h2 className="text-lg font-bold text-surface-100 mt-1">Today&apos;s Workout</h2>
                  <p className="text-sm text-surface-400">
                    {todaysWorkout.exercises} exercises · {todaysWorkout.completedSets}/{todaysWorkout.totalSets} sets
                  </p>
                </div>
              </div>
              {todaysWorkout.state !== 'completed' && (
                <Link href={`/dashboard/workout/${todaysWorkout.id}`}>
                  <Button>{todaysWorkout.state === 'in_progress' ? 'Continue' : 'Start'}</Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : scheduledWorkout ? (
        <Card className="overflow-hidden border-2 border-primary-500/50 bg-primary-500/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <Badge variant="info" size="sm">Scheduled</Badge>
                  <h2 className="text-lg font-bold text-surface-100 mt-1">{scheduledWorkout.dayName}</h2>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {scheduledWorkout.muscles.slice(0, 3).map((m) => (
                      <span key={m} className="text-xs px-2 py-0.5 bg-surface-800 rounded text-surface-400 capitalize">{m}</span>
                    ))}
                  </div>
                </div>
              </div>
              <Link href="/dashboard/mesocycle">
                <Button>Start Workout</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : activeMesocycle ? (
        <Card className="overflow-hidden border border-surface-700 bg-surface-800/30">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-surface-700/50 flex items-center justify-center">
                <svg className="w-6 h-6 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-surface-200">Rest Day</h2>
                <p className="text-sm text-surface-500">No workout scheduled. Recovery is part of progress!</p>
              </div>
              <Link href="/dashboard/workout/new">
                <Button variant="outline" size="sm">Quick Workout</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-2 border-dashed border-primary-500/40 bg-gradient-to-r from-primary-500/10 to-accent-500/10">
          <CardContent className="p-6 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-primary-500/20 flex items-center justify-center">
              <svg className="w-7 h-7 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-surface-100">Create Your Training Plan</h2>
            <p className="text-surface-400 mt-2 max-w-md mx-auto">
              Set up an AI-powered mesocycle for smart progression, volume tracking, and personalized recommendations.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center mt-5">
              <Link href="/dashboard/mesocycle/new">
                <Button size="lg">Create Mesocycle</Button>
              </Link>
              <Link href="/dashboard/workout/new">
                <Button size="lg" variant="outline">Quick Workout</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== TODAY'S NUTRITION ===== */}
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
                title="Quick log"
              >
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              <Link href="/dashboard/nutrition">
                <Button variant="ghost" size="sm">View All →</Button>
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {showQuickLogger && (
            <div className="mb-4">
              <QuickFoodLogger onAdd={handleAddFood} onClose={() => setShowQuickLogger(false)} />
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
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Protein</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.protein)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (nutritionTotals.protein / nutritionTargets.protein) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">/ {nutritionTargets.protein}g</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Carbs</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.carbs)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (nutritionTotals.carbs / nutritionTargets.carbs) * 100)}%` }} />
                  </div>
                  <p className="text-xs text-surface-600 mt-0.5">/ {nutritionTargets.carbs}g</p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-surface-500">Fat</span>
                    <span className="text-xs text-surface-400">{Math.round(nutritionTotals.fat)}g</span>
                  </div>
                  <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                    <div className="h-full bg-pink-500" style={{ width: `${Math.min(100, (nutritionTotals.fat / nutritionTargets.fat) * 100)}%` }} />
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

      {/* ===== WEEKLY VOLUME ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>📊 Weekly Volume</span>
            <span className="text-xs font-normal text-surface-500">sets per muscle</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {muscleVolume.length > 0 ? (
            <div className="space-y-3">
              {muscleVolume.slice(0, 8).map((mv) => (
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
            </div>
          ) : (
            <div className="text-center py-6">
              <p className="text-surface-400 text-sm">Complete workouts to track volume</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
