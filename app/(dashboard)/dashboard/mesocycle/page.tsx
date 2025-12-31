'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import type { Split, MuscleGroup } from '@/types/schema';

interface Mesocycle {
  id: string;
  name: string;
  state: string;
  total_weeks: number;
  current_week: number;
  days_per_week: number;
  split_type: string;
  deload_week: number;
  created_at: string;
}

interface TodayWorkout {
  dayName: string;
  muscles: MuscleGroup[];
  dayNumber: number;
}

type Goal = 'bulk' | 'cut' | 'maintain';

/**
 * Get rest period based on exercise type and user's goal
 * - Compound exercises need more rest for recovery
 * - Cutting: shorter rest for metabolic demand
 * - Bulking: full rest for maximum performance
 */
function getRestPeriod(isCompound: boolean, goal: Goal, primaryMuscle?: MuscleGroup): number {
  // Ab exercises need shorter rest periods (recover faster)
  if (primaryMuscle === 'abs') {
    return goal === 'cut' ? 30 : 45;
  }

  if (goal === 'cut') {
    return isCompound ? 120 : 60;  // 2min / 1min
  }
  if (goal === 'bulk') {
    return isCompound ? 180 : 90;  // 3min / 1.5min
  }
  // maintain
  return isCompound ? 150 : 75;    // 2.5min / 1.25min
}

// Get workout schedule based on split type
function getWorkoutForDay(splitType: string, dayOfWeek: number, daysPerWeek: number): TodayWorkout | null {
  const splits: Record<string, { dayName: string; muscles: MuscleGroup[] }[]> = {
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
  
  // Typical training days (Mon=1, Tue=2, etc.)
  const trainingDayMaps: Record<number, number[]> = {
    2: [1, 4],        // Mon, Thu
    3: [1, 3, 5],     // Mon, Wed, Fri
    4: [1, 2, 4, 5],  // Mon, Tue, Thu, Fri
    5: [1, 2, 3, 5, 6], // Mon-Wed, Fri-Sat
    6: [1, 2, 3, 4, 5, 6], // Mon-Sat
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

export default function MesocyclePage() {
  const router = useRouter();
  const [mesocycles, setMesocycles] = useState<Mesocycle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [todayWorkout, setTodayWorkout] = useState<TodayWorkout | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteMesocycle = async (id: string) => {
    setDeletingId(id);
    try {
      const supabase = createUntypedClient();
      
      // Delete associated workout sessions and exercise blocks first
      const { data: sessions } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('mesocycle_id', id);
      
      if (sessions && sessions.length > 0) {
        const sessionIds = sessions.map((s: { id: string }) => s.id);
        // Delete exercise blocks for these sessions
        await supabase
          .from('exercise_blocks')
          .delete()
          .in('workout_session_id', sessionIds);
        // Delete the sessions
        await supabase
          .from('workout_sessions')
          .delete()
          .eq('mesocycle_id', id);
      }
      
      // Delete the mesocycle
      await supabase
        .from('mesocycles')
        .delete()
        .eq('id', id);
      
      // Update local state
      setMesocycles(mesocycles.filter(m => m.id !== id));
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Failed to delete mesocycle:', error);
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    async function fetchMesocycles() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('mesocycles')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && !error) {
        setMesocycles(data);
        
        // Calculate today's workout for active mesocycle
        const active = data.find((m: Mesocycle) => m.state === 'active');
        if (active) {
          const today = new Date();
          const dayOfWeek = today.getDay() || 7; // Convert Sunday(0) to 7
          const workout = getWorkoutForDay(active.split_type, dayOfWeek, active.days_per_week);
          setTodayWorkout(workout);
        }
      }
      setIsLoading(false);
    }
    fetchMesocycles();
  }, []);

  const activeMesocycle = mesocycles.find(m => m.state === 'active');
  const pastMesocycles = mesocycles.filter(m => m.state !== 'active');

  // Start today's workout from the mesocycle
  const handleStartWorkout = async () => {
    if (!activeMesocycle || !todayWorkout) return;
    
    setIsStartingWorkout(true);
    
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('Not logged in');

      // Fetch user's goal from profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('goal')
        .eq('user_id', user.id)
        .single();
      
      const userGoal: Goal = (userProfile?.goal as Goal) || 'maintain';

      // Check if there's already a workout for today
      const today = new Date().toISOString().split('T')[0];
      const { data: existingWorkout } = await supabase
        .from('workout_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('planned_date', today)
        .in('state', ['planned', 'in_progress'])
        .single();

      if (existingWorkout) {
        // Resume existing workout
        router.push(`/dashboard/workout/${existingWorkout.id}`);
        return;
      }

      // Create new workout session
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          mesocycle_id: activeMesocycle.id,
          planned_date: today,
          state: 'in_progress',
          started_at: new Date().toISOString(),
          completion_percent: 0,
        })
        .select()
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');

      // Get exercises for the target muscles
      const { data: exercises } = await supabase
        .from('exercises')
        .select('*')
        .in('primary_muscle', todayWorkout.muscles);

      if (exercises && exercises.length > 0) {
        // Group exercises by muscle and pick 1-2 per muscle
        type ExerciseRow = { id: string; name: string; primary_muscle: string; mechanic: string; default_rep_range: number[]; default_rir: number };
        const exercisesByMuscle: Record<string, ExerciseRow[]> = {};
        (exercises as ExerciseRow[]).forEach((ex: ExerciseRow) => {
          if (!exercisesByMuscle[ex.primary_muscle]) {
            exercisesByMuscle[ex.primary_muscle] = [];
          }
          exercisesByMuscle[ex.primary_muscle].push(ex);
        });

        // Create exercise blocks
        const blocks = [];
        let order = 1;
        const seenMuscles = new Set<string>();
        
        for (const muscle of todayWorkout.muscles) {
          const muscleExercises = exercisesByMuscle[muscle] || [];
          // Pick up to 2 exercises per muscle
          const selected = muscleExercises.slice(0, Math.min(2, muscleExercises.length));
          
          let isFirstExerciseForMuscle = !seenMuscles.has(muscle);
          
          for (const exercise of selected) {
            const isCompound = exercise.mechanic === 'compound';
            
            // Generate warmup for first exercise of each muscle group (compound or isolation)
            let warmupSets: any[] = [];
            if (isFirstExerciseForMuscle) {
              const repRange = (exercise.default_rep_range && exercise.default_rep_range.length >= 2
                ? [exercise.default_rep_range[0], exercise.default_rep_range[1]]
                : [8, 12]) as [number, number];

              warmupSets = generateWarmupProtocol({
                workingWeight: 60, // Default working weight, will be adjusted in workout
                exercise: {
                  id: exercise.id,
                  name: exercise.name,
                  primaryMuscle: exercise.primary_muscle,
                  secondaryMuscles: [],
                  mechanic: isCompound ? 'compound' : 'isolation',
                  defaultRepRange: repRange,
                  defaultRir: exercise.default_rir || 2,
                  minWeightIncrementKg: 2.5, // Standard barbell increment
                  formCues: [],
                  commonMistakes: [],
                  equipmentRequired: [],
                  setupNote: '',
                  movementPattern: isCompound ? 'compound' : 'isolation',
                },
                isFirstExercise: order === 1, // First exercise overall gets general warmup
              });
              seenMuscles.add(muscle);
              isFirstExerciseForMuscle = false;
            }
            
            blocks.push({
              workout_session_id: session.id,
              exercise_id: exercise.id,
              order: order++,
              target_sets: isCompound ? 4 : 3,
              target_rep_range: exercise.default_rep_range || [8, 12],
              target_rir: exercise.default_rir || 2,
              target_weight_kg: 0, // Will be filled from history or user input
              target_rest_seconds: getRestPeriod(isCompound, userGoal, exercise.primary_muscle as MuscleGroup),
              suggestion_reason: `${todayWorkout.dayName} - Week ${activeMesocycle.current_week}`,
              warmup_protocol: { sets: warmupSets },
            });
          }
        }

        if (blocks.length > 0) {
          await supabase.from('exercise_blocks').insert(blocks);
        }
      }

      router.push(`/dashboard/workout/${session.id}`);
    } catch (error) {
      console.error('Failed to start workout:', error);
      setIsStartingWorkout(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-surface-100">Mesocycle</h1>
            <div className="group relative">
              <button className="w-5 h-5 rounded-full bg-surface-700 hover:bg-surface-600 text-surface-400 text-xs flex items-center justify-center">
                ?
              </button>
              <div className="absolute left-0 top-7 w-72 p-3 bg-surface-800 border border-surface-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                <p className="text-sm font-medium text-surface-200 mb-1">What is a Mesocycle?</p>
                <p className="text-xs text-surface-400">
                  A <span className="text-primary-400">mesocycle</span> is a training block lasting 4-8 weeks, designed to achieve specific goals. It includes progressive overload weeks followed by a deload week to manage fatigue and maximize adaptation.
                </p>
                <p className="text-xs text-surface-500 mt-2">
                  Think of it as a &ldquo;chapter&rdquo; in your training story—focused, structured, and building toward the next phase.
                </p>
              </div>
            </div>
          </div>
          <p className="text-surface-400 mt-1">Plan and track your training blocks</p>
        </div>
        <Link href="/dashboard/mesocycle/new">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Mesocycle
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <Card className="text-center py-12">
          <LoadingAnimation type="random" size="md" text="Loading your training plan..." />
        </Card>
      ) : !activeMesocycle ? (
        <Card className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-surface-200">No active mesocycle</h2>
          <p className="text-surface-500 mt-2 max-w-md mx-auto">
            Create a mesocycle to plan your training with progressive overload and scheduled deloads.
          </p>
          <Link href="/dashboard/mesocycle/new">
            <Button className="mt-6">Create Your First Mesocycle</Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* Today's Workout Card */}
          {todayWorkout ? (
            <Card variant="elevated" className="border-2 border-primary-500/30 bg-gradient-to-br from-primary-500/5 to-accent-500/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-3xl">🏋️</span>
                      <div>
                        <p className="text-sm text-primary-400 font-medium">Today&apos;s Workout</p>
                        <h2 className="text-xl font-bold text-surface-100">{todayWorkout.dayName}</h2>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {todayWorkout.muscles.map(muscle => (
                        <Badge key={muscle} variant="default" className="capitalize">
                          {muscle}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-surface-400 mt-3">
                      Week {activeMesocycle.current_week} • Day {todayWorkout.dayNumber} of {activeMesocycle.days_per_week}
                    </p>
                  </div>
                  <Button 
                    size="lg" 
                    onClick={handleStartWorkout}
                    isLoading={isStartingWorkout}
                    className="shrink-0"
                  >
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Workout
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border border-surface-700">
              <CardContent className="p-6 text-center">
                <span className="text-4xl block mb-3">😴</span>
                <h3 className="text-lg font-semibold text-surface-200">Rest Day</h3>
                <p className="text-surface-400 mt-1">
                  No workout scheduled for today. Recovery is part of the process!
                </p>
                <Link href="/dashboard/workout/new">
                  <Button variant="secondary" className="mt-4">
                    Start Ad-hoc Workout
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Mesocycle Overview Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{activeMesocycle.name}</CardTitle>
                  <p className="text-surface-400 text-sm mt-1">{activeMesocycle.split_type}</p>
                </div>
                <Badge variant="success">Active</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">
                    {activeMesocycle.current_week}/{activeMesocycle.total_weeks}
                  </p>
                  <p className="text-sm text-surface-500">Current Week</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">{activeMesocycle.days_per_week}</p>
                  <p className="text-sm text-surface-500">Days/Week</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-surface-100">{activeMesocycle.deload_week}</p>
                  <p className="text-sm text-surface-500">Deload Week</p>
                </div>
                <div className="text-center p-4 bg-surface-800/50 rounded-lg">
                  <p className="text-2xl font-bold text-primary-400">
                    {Math.round((activeMesocycle.current_week / activeMesocycle.total_weeks) * 100)}%
                  </p>
                  <p className="text-sm text-surface-500">Complete</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-6">
                <div className="flex justify-between text-sm text-surface-400 mb-2">
                  <span>Progress</span>
                  <span>Week {activeMesocycle.current_week} of {activeMesocycle.total_weeks}</span>
                </div>
                <div className="h-2 bg-surface-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-primary-500 to-accent-500 rounded-full transition-all"
                    style={{ width: `${(activeMesocycle.current_week / activeMesocycle.total_weeks) * 100}%` }}
                  />
                </div>
              </div>

              {/* Week Schedule */}
              <div className="mt-6 pt-6 border-t border-surface-800">
                <h4 className="text-sm font-medium text-surface-300 mb-3">This Week&apos;s Schedule</h4>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => {
                    const dayNum = index + 1;
                    const workout = getWorkoutForDay(activeMesocycle.split_type, dayNum, activeMesocycle.days_per_week);
                    const isToday = (new Date().getDay() || 7) === dayNum;
                    
                    return (
                      <div 
                        key={day}
                        className={`shrink-0 p-3 rounded-lg text-center min-w-[80px] ${
                          isToday 
                            ? 'bg-primary-500/20 border border-primary-500/40' 
                            : workout 
                              ? 'bg-surface-800/50' 
                              : 'bg-surface-900/30'
                        }`}
                      >
                        <p className={`text-xs font-medium ${isToday ? 'text-primary-400' : 'text-surface-500'}`}>
                          {day}
                        </p>
                        {workout ? (
                          <p className="text-xs text-surface-300 mt-1 truncate" title={workout.dayName}>
                            {workout.dayName.split(' ')[0]}
                          </p>
                        ) : (
                          <p className="text-xs text-surface-600 mt-1">Rest</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Programming Logic - show when there's an active mesocycle */}
      {activeMesocycle && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              How Your Program Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Split Logic */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">🗓️ {activeMesocycle.split_type} Split</h3>
                <p className="text-sm text-surface-400">
                  {activeMesocycle.split_type === 'Full Body' 
                    ? 'Each workout hits all muscle groups. This maximizes training frequency (2-3x/week per muscle) which is great for strength and hypertrophy.'
                    : activeMesocycle.split_type === 'Upper/Lower'
                    ? 'Alternating between upper and lower body allows high volume per session while maintaining 2x/week frequency.'
                    : activeMesocycle.split_type === 'PPL'
                    ? 'Push/Pull/Legs groups muscles by movement pattern. Great for high volume training with 1-2x frequency.'
                    : 'Your split is designed to balance volume and recovery.'}
                </p>
              </div>

              {/* Rep Ranges */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">🎯 Smart Rep Ranges</h3>
                <p className="text-sm text-surface-400 mb-2">
                  Rep ranges vary based on muscle fiber composition:
                </p>
                <ul className="text-xs text-surface-500 space-y-1">
                  <li>• <span className="text-danger-400">Hamstrings/Triceps:</span> Lower reps (fast-twitch)</li>
                  <li>• <span className="text-warning-400">Chest/Back/Quads:</span> Moderate reps (mixed)</li>
                  <li>• <span className="text-success-400">Calves/Delts/Core:</span> Higher reps (slow-twitch)</li>
                </ul>
              </div>

              {/* Progressive Overload */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">📈 Weekly Progression</h3>
                <p className="text-sm text-surface-400">
                  Each week, we aim to add 1-2 reps or 2.5% weight to key lifts. This progressive overload drives adaptation.
                </p>
                <div className="flex gap-2 mt-2">
                  {Array.from({ length: activeMesocycle.total_weeks }).map((_, i) => (
                    <div
                      key={i}
                      className={`flex-1 h-2 rounded ${
                        i === activeMesocycle.total_weeks - 1
                          ? 'bg-warning-500'
                          : i < activeMesocycle.current_week
                          ? 'bg-primary-500'
                          : 'bg-surface-700'
                      }`}
                      title={i === activeMesocycle.total_weeks - 1 ? 'Deload' : `Week ${i + 1}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-surface-500 mt-1">
                  Weeks 1-{activeMesocycle.total_weeks - 1}: Build • Week {activeMesocycle.total_weeks}: Deload
                </p>
              </div>

              {/* Volume */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">💪 Volume Targets</h3>
                <p className="text-sm text-surface-400 mb-2">
                  Weekly sets per muscle group:
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 bg-surface-700 rounded">MV: 6</span>
                  <span className="text-surface-600">→</span>
                  <span className="px-2 py-1 bg-success-500/20 text-success-300 rounded">Target: 10-20</span>
                  <span className="text-surface-600">→</span>
                  <span className="px-2 py-1 bg-surface-700 rounded">MRV: 20+</span>
                </div>
                <p className="text-xs text-surface-500 mt-2">
                  MV = Minimum Viable • MRV = Maximum Recoverable
                </p>
              </div>

              {/* Fatigue */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">⚡ Fatigue Tracking</h3>
                <p className="text-sm text-surface-400">
                  We monitor systemic and local fatigue. High RPE, poor sleep, or missed reps trigger adaptive responses.
                </p>
                <div className="mt-2 p-2 bg-surface-900/50 rounded text-xs text-surface-500">
                  <strong className="text-surface-400">Auto-deload triggers:</strong> Performance drop, RPE 9.5+, poor recovery
                </div>
              </div>

              {/* Deload */}
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200 mb-2">😴 Deload Week</h3>
                <p className="text-sm text-surface-400">
                  Week {activeMesocycle.deload_week} reduces volume by 50% while maintaining intensity. This lets accumulated fatigue dissipate.
                </p>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="px-2 py-1 bg-surface-700 rounded">Volume: -50%</span>
                  <span className="px-2 py-1 bg-surface-700 rounded">Intensity: Same</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* What is a mesocycle - always show after loading */}
      {!isLoading && (
        <Card>
          <CardHeader>
            <CardTitle>What is a Mesocycle?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-surface-400 mb-4">
              A mesocycle is a training block typically lasting 4-8 weeks, designed to progressively overload your muscles before a recovery (deload) week.
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">📈 Progressive Overload</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Gradually increase volume and intensity week over week
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">😴 Planned Deloads</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Scheduled recovery weeks to manage fatigue
                </p>
              </div>
              <div className="p-4 bg-surface-800/50 rounded-lg">
                <h3 className="font-medium text-surface-200">🎯 Auto-Regulation</h3>
                <p className="text-sm text-surface-500 mt-1">
                  Adjust based on readiness and performance
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Past mesocycles - at the bottom */}
      {pastMesocycles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Mesocycles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pastMesocycles.map((meso) => (
                <div key={meso.id} className="flex items-center justify-between p-3 bg-surface-800/50 rounded-lg">
                  <div>
                    <p className="font-medium text-surface-200">{meso.name}</p>
                    <p className="text-sm text-surface-500">
                      {meso.split_type} • {meso.total_weeks} weeks • {new Date(meso.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={meso.state === 'completed' ? 'default' : 'warning'}>
                      {meso.state}
                    </Badge>
                    {confirmDeleteId === meso.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteMesocycle(meso.id)}
                          isLoading={deletingId === meso.id}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(meso.id)}
                        className="p-1.5 text-surface-500 hover:text-danger-400 hover:bg-danger-500/10 rounded transition-colors"
                        title="Delete mesocycle"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
