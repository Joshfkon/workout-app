'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, LoadingAnimation } from '@/components/ui';
import Link from 'next/link';
import { createUntypedClient } from '@/lib/supabase/client';
import { QuickFoodLogger } from '@/components/nutrition/QuickFoodLogger';
import { DailyCheckIn } from '@/components/dashboard/DailyCheckIn';
import { HydrationTracker } from '@/components/dashboard/HydrationTracker';
import { getLocalDateString } from '@/lib/utils';
import type { FrequentFood, SystemFood, MealType } from '@/types/nutrition';

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

interface ExerciseVolume {
  id: string;
  name: string;
  sets: number;
}

interface MuscleVolumeStats {
  muscle: string;
  sets: number;
  target: number;
  status: 'low' | 'optimal' | 'high';
  exercises: ExerciseVolume[];
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
  const [showWeightLogger, setShowWeightLogger] = useState(false);
  const [weightInput, setWeightInput] = useState('');
  const [weightUnit, setWeightUnit] = useState<'lb' | 'kg'>('lb');
  const [todaysWeight, setTodaysWeight] = useState<{ weight: number; unit: string } | null>(null);
  const [isLoggingWeight, setIsLoggingWeight] = useState(false);
  const [weightHistory, setWeightHistory] = useState<{ date: string; weight: number; unit: string }[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [userGoal, setUserGoal] = useState<'bulk' | 'cut' | 'recomp' | 'maintain' | 'maintenance'>('maintain');
  const [debugError, setDebugError] = useState<string | null>(null);
  const [frequentFoods, setFrequentFoods] = useState<FrequentFood[]>([]);
  const [systemFoods, setSystemFoods] = useState<SystemFood[]>([]);

  // Debug: Catch global errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setDebugError(`Global Error: ${event.message} at ${event.filename}:${event.lineno}`);
      console.error('Global error caught:', event);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      setDebugError(`Unhandled Rejection: ${msg}`);
      console.error('Unhandled rejection:', reason);
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  useEffect(() => {
    async function fetchDashboardData() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        setUserId(user.id);

        const today = new Date();
        const todayStr = getLocalDateString(today);
        const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
        
        // Fetch user profile to get goal
        const { data: userProfile } = await supabase
          .from('users')
          .select('goal')
          .eq('id', user.id)
          .single();
        
        if (userProfile?.goal) {
          setUserGoal(userProfile.goal);
        }

        // Fetch active mesocycle with workout sessions
        // Check both is_active flag and state='active' for backwards compatibility
        const { data: mesocycles, error: mesoError } = await supabase
          .from('mesocycles')
          .select(`
            id, name, start_date, total_weeks, split_type, days_per_week, state, is_active,
            workout_sessions (id, planned_date, state, completed_at)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        
        if (mesoError) {
          console.error('Error fetching mesocycle:', mesoError);
        }
        
        // Find active mesocycle - check both is_active flag and state field
        // Also accept any mesocycle (even planned state) if no active one exists
        let mesocycle = mesocycles?.find((m: any) => m.is_active === true || m.state === 'active') || null;
        
        // Fallback: if no explicitly active mesocycle, use the most recent one that isn't completed
        if (!mesocycle && mesocycles && mesocycles.length > 0) {
          mesocycle = mesocycles.find((m: any) => m.state !== 'completed') || null;
        }

        if (mesocycle) {
          const startDate = new Date(mesocycle.start_date);
          const weeksSinceStart = Math.floor((today.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          const sessions = mesocycle.workout_sessions || [];
          const completed = sessions.filter((s: any) => s.state === 'completed').length;

          setActiveMesocycle({
            id: mesocycle.id,
            name: mesocycle.name,
            startDate: mesocycle.start_date,
            weeks: mesocycle.total_weeks,
            currentWeek: Math.min(weeksSinceStart, mesocycle.total_weeks),
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

        // Fetch nutrition data, today's weight, and user preferences
        const [nutritionResult, targetsResult, prefsResult] = await Promise.all([
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
          supabase
            .from('user_preferences')
            .select('weight_unit')
            .eq('user_id', user.id)
            .single(),
        ]);
        
        // Fetch today's weight separately to handle potential missing unit column
        let weightResult = await supabase
          .from('weight_log')
          .select('weight, unit')
          .eq('user_id', user.id)
          .eq('logged_at', todayStr)
          .maybeSingle();
        
        // If unit column doesn't exist, try without it
        if (weightResult.error?.message?.includes('column "unit"')) {
          weightResult = await supabase
            .from('weight_log')
            .select('weight')
            .eq('user_id', user.id)
            .eq('logged_at', todayStr)
            .maybeSingle();
        }

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

        // Set today's weight if logged
        if (weightResult.data) {
          setTodaysWeight({ weight: weightResult.data.weight, unit: weightResult.data.unit || 'lb' });
        }

        // Set user's preferred weight unit
        if (prefsResult.data?.weight_unit) {
          setWeightUnit(prefsResult.data.weight_unit as 'lb' | 'kg');
        }

        // Fetch weight history (last 30 days)
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(today.getDate() - 30);
        const { data: weightHistoryData, error: historyError } = await supabase
          .from('weight_log')
          .select('logged_at, weight, unit')
          .eq('user_id', user.id)
          .gte('logged_at', getLocalDateString(thirtyDaysAgo))
          .order('logged_at', { ascending: true });

        // If unit column doesn't exist, try without it
        let finalHistoryData = weightHistoryData;
        if (historyError?.message?.includes('column "unit"')) {
          const { data: fallbackData } = await supabase
            .from('weight_log')
            .select('logged_at, weight')
            .eq('user_id', user.id)
            .gte('logged_at', getLocalDateString(thirtyDaysAgo))
            .order('logged_at', { ascending: true });
          finalHistoryData = fallbackData;
        }

        if (finalHistoryData && finalHistoryData.length > 0) {
          setWeightHistory(finalHistoryData.map((w: any) => ({
            date: w.logged_at,
            weight: w.weight,
            unit: w.unit || 'lb', // Default to lb if unit column doesn't exist
          })));
        }

        // Fetch weekly volume by muscle - use actual completed sets from set_logs
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        
        const { data: weeklyBlocks } = await supabase
          .from('exercise_blocks')
          .select(`
            id,
            exercises (id, name, primary_muscle),
            set_logs (id, is_warmup),
            workout_sessions!inner (user_id, completed_at, state)
          `)
          .eq('workout_sessions.user_id', user.id)
          .eq('workout_sessions.state', 'completed')
          .gte('workout_sessions.completed_at', weekStart.toISOString());

        if (weeklyBlocks && weeklyBlocks.length > 0) {
          const volumeByMuscle: Record<string, { sets: number; exercises: Map<string, { id: string; name: string; sets: number }> }> = {};
          
          weeklyBlocks.forEach((block: any) => {
            const muscle = block.exercises?.primary_muscle;
            const exerciseId = block.exercises?.id;
            const exerciseName = block.exercises?.name;
            if (!muscle || !exerciseId) return;
            
            // Count actual completed working sets (not warmups)
            const workingSets = (block.set_logs || []).filter((s: any) => !s.is_warmup).length;
            if (workingSets === 0) return;
            
            if (!volumeByMuscle[muscle]) {
              volumeByMuscle[muscle] = { sets: 0, exercises: new Map() };
            }
            volumeByMuscle[muscle].sets += workingSets;
            
            // Track by exercise
            const existing = volumeByMuscle[muscle].exercises.get(exerciseId);
            if (existing) {
              existing.sets += workingSets;
            } else {
              volumeByMuscle[muscle].exercises.set(exerciseId, { id: exerciseId, name: exerciseName, sets: workingSets });
            }
          });

          const volumeTargets: Record<string, number> = {
            chest: 12, back: 14, shoulders: 12, quads: 12, hamstrings: 10,
            glutes: 10, biceps: 10, triceps: 10, calves: 8, abs: 8,
          };

          const stats: MuscleVolumeStats[] = Object.entries(volumeByMuscle)
            .map(([muscle, data]) => {
              const target = volumeTargets[muscle] || 10;
              const status: 'low' | 'optimal' | 'high' = data.sets < target * 0.7 ? 'low' : data.sets > target * 1.3 ? 'high' : 'optimal';
              const exercises = Array.from(data.exercises.values()).sort((a, b) => b.sets - a.sets);
              return { muscle, sets: data.sets, target, status, exercises };
            })
            .sort((a, b) => b.sets - a.sets);

          setMuscleVolume(stats);
        }

        // Load frequent foods (aggregated from food_log)
        const { data: frequentData } = await supabase
          .from('food_log')
          .select('meal_type, food_name, serving_size, calories, protein, carbs, fat, servings')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(500);

        if (frequentData && frequentData.length > 0) {
          const frequencyMap = new Map<string, FrequentFood>();
          
          for (const entry of frequentData) {
            if (!entry.food_name) continue;
            const key = `${entry.meal_type}:${entry.food_name}`;
            const existing = frequencyMap.get(key);
            const servingsNum = entry.servings || 1;
            
            if (existing) {
              const totalLogs = existing.times_logged + 1;
              existing.avg_calories = (existing.avg_calories * existing.times_logged + (entry.calories || 0) / servingsNum) / totalLogs;
              existing.avg_protein = (existing.avg_protein * existing.times_logged + (entry.protein || 0) / servingsNum) / totalLogs;
              existing.avg_carbs = (existing.avg_carbs * existing.times_logged + (entry.carbs || 0) / servingsNum) / totalLogs;
              existing.avg_fat = (existing.avg_fat * existing.times_logged + (entry.fat || 0) / servingsNum) / totalLogs;
              existing.times_logged = totalLogs;
            } else {
              frequencyMap.set(key, {
                user_id: user.id,
                meal_type: entry.meal_type as MealType,
                food_name: entry.food_name,
                serving_size: entry.serving_size,
                avg_calories: (entry.calories || 0) / servingsNum,
                avg_protein: (entry.protein || 0) / servingsNum,
                avg_carbs: (entry.carbs || 0) / servingsNum,
                avg_fat: (entry.fat || 0) / servingsNum,
                times_logged: 1,
                last_logged: new Date().toISOString(),
              });
            }
          }
          
          setFrequentFoods(Array.from(frequencyMap.values()));
        }

        // Load system foods (pre-populated bodybuilding foods)
        const { data: systemFoodsData } = await supabase
          .from('system_foods')
          .select('id, name, category, subcategory, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g')
          .eq('is_active', true)
          .order('name');

        if (systemFoodsData) {
          setSystemFoods(systemFoodsData as SystemFood[]);
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
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.error('handleAddFood: No user found');
        return;
      }

      const { error } = await supabase.from('food_log').insert({
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
        logged_at: getLocalDateString(),
      });

      if (error) {
        console.error('handleAddFood: Supabase error:', error);
        return;
      }

      setNutritionTotals((prev) => ({
        calories: prev.calories + food.calories,
        protein: prev.protein + food.protein,
        carbs: prev.carbs + food.carbs,
        fat: prev.fat + food.fat,
      }));
      setShowQuickLogger(false);
    } catch (err) {
      console.error('handleAddFood: Exception:', err);
    }
  };

  const handleSaveWeight = async () => {
    if (!weightInput || isNaN(parseFloat(weightInput))) return;
    
    setIsLoggingWeight(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const weight = parseFloat(weightInput);
      const today = getLocalDateString();

      // First try to update existing entry for today
      const { data: existing, error: selectError } = await supabase
        .from('weight_log')
        .select('id')
        .eq('user_id', user.id)
        .eq('logged_at', today)
        .maybeSingle();

      if (selectError) {
        console.error('Error checking existing weight:', selectError);
      }

      let error;
      if (existing) {
        // Update existing entry - try with unit first, fall back without
        let result = await supabase.from('weight_log').update({
          weight: weight,
          unit: weightUnit,
        }).eq('id', existing.id);
        
        // If unit column doesn't exist, try without it
        if (result.error?.message?.includes('column "unit"')) {
          result = await supabase.from('weight_log').update({
            weight: weight,
          }).eq('id', existing.id);
        }
        error = result.error;
      } else {
        // Insert new entry - try with unit first, fall back without
        let result = await supabase.from('weight_log').insert({
          user_id: user.id,
          logged_at: today,
          weight: weight,
          unit: weightUnit,
        });
        
        // If unit column doesn't exist, try without it
        if (result.error?.message?.includes('column "unit"')) {
          result = await supabase.from('weight_log').insert({
            user_id: user.id,
            logged_at: today,
            weight: weight,
          });
        }
        error = result.error;
      }

      if (error) throw error;

      setTodaysWeight({ weight, unit: weightUnit });
      setWeightInput('');
      setShowWeightLogger(false);
    } catch (err) {
      console.error('Failed to save weight:', err);
    } finally {
      setIsLoggingWeight(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Quick Actions Bar */}
      <div className="flex gap-3">
        <Link href="/dashboard/workout/new" className="flex-1">
          <button className="w-full p-4 bg-gradient-to-r from-primary-600 to-primary-500 hover:from-primary-500 hover:to-primary-400 rounded-xl transition-all shadow-lg shadow-primary-500/20 hover:shadow-primary-500/30 active:scale-[0.98] flex items-center justify-center gap-3">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-semibold text-white">Quick Workout</span>
          </button>
        </Link>
        <Link href="/dashboard/nutrition">
          <button className="p-4 bg-surface-800 hover:bg-surface-700 rounded-xl transition-all border border-surface-700 flex items-center justify-center">
            <span className="text-2xl">🍎</span>
          </button>
        </Link>
        <Link href="/dashboard/workout">
          <button className="p-4 bg-surface-800 hover:bg-surface-700 rounded-xl transition-all border border-surface-700 flex items-center justify-center">
            <span className="text-2xl">📋</span>
          </button>
        </Link>
      </div>

      {/* Debug Error Display */}
      {debugError && (
        <div className="p-3 bg-red-900/50 border border-red-500 rounded-lg">
          <p className="text-xs text-red-300 font-mono break-all">{debugError}</p>
          <button 
            onClick={() => setDebugError(null)} 
            className="mt-2 text-xs text-red-400 underline"
          >
            Dismiss
          </button>
        </div>
      )}

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

      {/* ===== DAILY CHECK-IN ===== */}
      {userId && (
        <DailyCheckIn 
          userId={userId} 
          userGoal={userGoal}
        />
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
              <QuickFoodLogger 
                onAdd={handleAddFood} 
                onClose={() => setShowQuickLogger(false)} 
                frequentFoods={frequentFoods}
                systemFoods={systemFoods}
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
              {(() => {
                // Calculate expected progress based on time of day
                // Assume eating window is 7am-9pm (14 hours)
                const now = new Date();
                const hours = now.getHours();
                const minutes = now.getMinutes();
                const currentTimeInHours = hours + minutes / 60;
                
                // Calculate expected % (7am = 0%, 9pm = 100%)
                const startHour = 7;  // 7am
                const endHour = 21;   // 9pm
                const totalWindow = endHour - startHour; // 14 hours
                
                let expectedPercent: number;
                if (currentTimeInHours <= startHour) {
                  expectedPercent = 0;
                } else if (currentTimeInHours >= endHour) {
                  expectedPercent = 100;
                } else {
                  expectedPercent = ((currentTimeInHours - startHour) / totalWindow) * 100;
                }
                
                // Helper to get pace status
                const getPaceStatus = (actual: number, target: number) => {
                  const actualPercent = (actual / target) * 100;
                  const diff = actualPercent - expectedPercent;
                  
                  if (diff > 15) return { status: 'ahead', color: 'text-amber-400', icon: '↑' };
                  if (diff < -15) return { status: 'behind', color: 'text-blue-400', icon: '↓' };
                  return { status: 'on-track', color: 'text-success-400', icon: '✓' };
                };
                
                const proteinPace = getPaceStatus(nutritionTotals.protein, nutritionTargets.protein);
                const carbsPace = getPaceStatus(nutritionTotals.carbs, nutritionTargets.carbs);
                const fatPace = getPaceStatus(nutritionTotals.fat, nutritionTargets.fat);
                
                return (
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-surface-500">Protein</span>
                        <span className="text-xs text-surface-400">{Math.round(nutritionTotals.protein)}g</span>
                      </div>
                      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (nutritionTotals.protein / nutritionTargets.protein) * 100)}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-surface-600">/ {nutritionTargets.protein}g</p>
                        <span className={`text-[10px] ${proteinPace.color}`}>{proteinPace.icon}</span>
                      </div>
                      {/* Pace indicator bar */}
                      <div className="h-0.5 bg-surface-800 rounded-full mt-1 relative">
                        <div className="absolute h-full bg-surface-600 rounded-full" style={{ width: `${expectedPercent}%` }} />
                        <div 
                          className={`absolute h-full rounded-full ${
                            proteinPace.status === 'ahead' ? 'bg-amber-500/60' : 
                            proteinPace.status === 'behind' ? 'bg-blue-500/60' : 'bg-success-500/60'
                          }`} 
                          style={{ width: `${Math.min(100, (nutritionTotals.protein / nutritionTargets.protein) * 100)}%` }} 
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-surface-500">Carbs</span>
                        <span className="text-xs text-surface-400">{Math.round(nutritionTotals.carbs)}g</span>
                      </div>
                      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500" style={{ width: `${Math.min(100, (nutritionTotals.carbs / nutritionTargets.carbs) * 100)}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-surface-600">/ {nutritionTargets.carbs}g</p>
                        <span className={`text-[10px] ${carbsPace.color}`}>{carbsPace.icon}</span>
                      </div>
                      {/* Pace indicator bar */}
                      <div className="h-0.5 bg-surface-800 rounded-full mt-1 relative">
                        <div className="absolute h-full bg-surface-600 rounded-full" style={{ width: `${expectedPercent}%` }} />
                        <div 
                          className={`absolute h-full rounded-full ${
                            carbsPace.status === 'ahead' ? 'bg-amber-500/60' : 
                            carbsPace.status === 'behind' ? 'bg-blue-500/60' : 'bg-success-500/60'
                          }`} 
                          style={{ width: `${Math.min(100, (nutritionTotals.carbs / nutritionTargets.carbs) * 100)}%` }} 
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-surface-500">Fat</span>
                        <span className="text-xs text-surface-400">{Math.round(nutritionTotals.fat)}g</span>
                      </div>
                      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden">
                        <div className="h-full bg-pink-500" style={{ width: `${Math.min(100, (nutritionTotals.fat / nutritionTargets.fat) * 100)}%` }} />
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <p className="text-xs text-surface-600">/ {nutritionTargets.fat}g</p>
                        <span className={`text-[10px] ${fatPace.color}`}>{fatPace.icon}</span>
                      </div>
                      {/* Pace indicator bar */}
                      <div className="h-0.5 bg-surface-800 rounded-full mt-1 relative">
                        <div className="absolute h-full bg-surface-600 rounded-full" style={{ width: `${expectedPercent}%` }} />
                        <div 
                          className={`absolute h-full rounded-full ${
                            fatPace.status === 'ahead' ? 'bg-amber-500/60' : 
                            fatPace.status === 'behind' ? 'bg-blue-500/60' : 'bg-success-500/60'
                          }`} 
                          style={{ width: `${Math.min(100, (nutritionTotals.fat / nutritionTargets.fat) * 100)}%` }} 
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
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

      {/* ===== TODAY'S WEIGHT ===== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <span>⚖️</span> Today&apos;s Weight
            </CardTitle>
            {!showWeightLogger && todaysWeight && (
              <button
                onClick={() => setShowWeightLogger(true)}
                className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors"
                title="Update weight"
              >
                <svg className="w-4 h-4 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-2">
          {showWeightLogger ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                placeholder={`Weight (${weightUnit})`}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveWeight()}
                className="flex-1 px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                autoFocus
              />
              <select
                value={weightUnit}
                onChange={(e) => setWeightUnit(e.target.value as 'lb' | 'kg')}
                className="px-2 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="lb">lbs</option>
                <option value="kg">kg</option>
              </select>
              <Button
                size="sm"
                onClick={handleSaveWeight}
                disabled={!weightInput || isLoggingWeight}
              >
                {isLoggingWeight ? '...' : 'Save'}
              </Button>
              <button
                onClick={() => {
                  setShowWeightLogger(false);
                  setWeightInput('');
                }}
                className="p-2 text-surface-400 hover:text-surface-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : todaysWeight ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-surface-100">
                      {(() => {
                        // Convert to user's preferred unit if needed
                        let displayWeight = todaysWeight.weight;
                        const storedUnit = todaysWeight.unit || 'kg';
                        if (storedUnit !== weightUnit) {
                          // Convert: stored in kg but user wants lb, or vice versa
                          if (storedUnit === 'kg' && weightUnit === 'lb') {
                            displayWeight = todaysWeight.weight * 2.20462;
                          } else if (storedUnit === 'lb' && weightUnit === 'kg') {
                            displayWeight = todaysWeight.weight / 2.20462;
                          }
                        }
                        return displayWeight.toFixed(1);
                      })()} <span className="text-base font-normal text-surface-400">{weightUnit}</span>
                    </p>
                    <p className="text-xs text-surface-500">Logged today</p>
                  </div>
                </div>
                <Link href="/dashboard/nutrition">
                  <Button variant="ghost" size="sm">History →</Button>
                </Link>
              </div>
              
              {/* Weight Trend Graph */}
              {weightHistory.length >= 2 && (
                <div className="pt-2 border-t border-surface-800">
                  <div className="flex items-center justify-between text-xs text-surface-500 mb-2">
                    <span>30 Day Trend</span>
                    {(() => {
                      // Convert weights to user's preferred unit for diff calculation
                      const convertWeight = (w: { weight: number; unit: string }) => {
                        if (w.unit === weightUnit) return w.weight;
                        return w.unit === 'kg' ? w.weight * 2.20462 : w.weight / 2.20462;
                      };
                      const first = weightHistory[0] ? convertWeight(weightHistory[0]) : 0;
                      const last = weightHistory[weightHistory.length - 1] ? convertWeight(weightHistory[weightHistory.length - 1]) : 0;
                      const diff = last - first;
                      const diffFormatted = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
                      return (
                        <span className={diff > 0 ? 'text-warning-400' : diff < 0 ? 'text-success-400' : 'text-surface-400'}>
                          {diffFormatted} {weightUnit}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="h-16 flex items-end gap-0.5">
                    {(() => {
                      // Normalize weights for display and convert if needed
                      const normalizedHistory = weightHistory.map(w => {
                        // Convert to user's preferred unit
                        let displayWeight = w.weight;
                        if (w.unit !== weightUnit) {
                          displayWeight = w.unit === 'kg' ? w.weight * 2.20462 : w.weight * 0.453592;
                        }
                        return { ...w, displayWeight };
                      });
                      const weights = normalizedHistory.map(w => w.displayWeight);
                      const min = Math.min(...weights);
                      const max = Math.max(...weights);
                      const range = max - min || 1;
                      
                      // Show last 14 data points or all if less
                      const displayData = normalizedHistory.slice(-14);
                      
                      return displayData.map((entry, i) => {
                        const heightPercent = ((entry.displayWeight - min) / range) * 100;
                        const height = Math.max(8, heightPercent); // Minimum 8% height
                        const isLast = i === displayData.length - 1;
                        return (
                          <div
                            key={entry.date}
                            className="flex-1 group relative"
                            title={`${new Date(entry.date).toLocaleDateString()}: ${entry.displayWeight.toFixed(1)} ${weightUnit}`}
                          >
                            <div
                              className={`w-full rounded-sm transition-all ${isLast ? 'bg-primary-500' : 'bg-surface-600 group-hover:bg-surface-500'}`}
                              style={{ height: `${height}%`, minHeight: '4px' }}
                            />
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowWeightLogger(true)}
              className="w-full py-4 border-2 border-dashed border-surface-700 rounded-lg text-surface-400 hover:border-primary-500 hover:text-primary-400 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Log your weight
            </button>
          )}
        </CardContent>
      </Card>

      {/* ===== HYDRATION ===== */}
      {userId && (
        <HydrationTracker userId={userId} unit={weightUnit === 'kg' ? 'ml' : 'oz'} />
      )}

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
            <div className="space-y-2">
              {muscleVolume.slice(0, 8).map((mv) => (
                <details key={mv.muscle} className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <svg 
                            className="w-3 h-3 text-surface-500 transition-transform group-open:rotate-90" 
                            fill="none" 
                            viewBox="0 0 24 24" 
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-surface-300 capitalize">{mv.muscle}</span>
                        </div>
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
                      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden ml-5">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            mv.status === 'optimal' ? 'bg-success-500' :
                            mv.status === 'low' ? 'bg-warning-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${Math.min(100, (mv.sets / mv.target) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </summary>
                  {/* Expanded exercises */}
                  {mv.exercises && mv.exercises.length > 0 && (
                    <div className="ml-5 mt-2 pl-3 border-l-2 border-surface-700 space-y-1.5">
                      {mv.exercises.map((ex) => (
                        <div key={ex.id} className="flex items-center justify-between text-xs">
                          <span className="text-surface-400 truncate">{ex.name}</span>
                          <span className="text-surface-500 flex-shrink-0 ml-2">{ex.sets} sets</span>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
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
