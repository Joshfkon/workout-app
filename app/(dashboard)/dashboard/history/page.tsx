'use client';

import { useState, useEffect, Suspense } from 'react';
import { Card, Badge, Button, FullPageLoading, LoadingAnimation } from '@/components/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createUntypedClient } from '@/lib/supabase/client';
import { formatWeight, convertWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

interface SetDetail {
  id: string;
  weight_kg: number;
  reps: number;
  rpe: number | null;
}

interface ExerciseDetail {
  id: string;
  exerciseId: string;
  name: string;
  primaryMuscle: string;
  sets: SetDetail[];
}

interface WorkoutHistory {
  id: string;
  planned_date: string;
  completed_at: string | null;
  state: string;
  session_rpe: number | null;
  session_notes: string | null;
  pump_rating: number | null;
  exercises: ExerciseDetail[];
  totalSets: number;
  totalVolume: number;
}

interface ExerciseHistoryEntry {
  date: string;
  displayDate: string;
  bestWeight: number;
  bestReps: number;
  totalSets: number;
  totalVolume: number;
  estimatedE1RM: number;
  sets: { weight: number; reps: number; rpe: number | null }[];
}

interface ExerciseHistoryData {
  exerciseId: string;
  exerciseName: string;
  primaryMuscle: string;
  history: ExerciseHistoryEntry[];
  currentE1RM: number;
  allTimeMaxE1RM: number;
  allTimeBestWeight: number;
  allTimeBestReps: number;
  totalSetsAllTime: number;
  progressPercent: number;
}

// Calculate estimated 1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

function HistoryPageContent() {
  const searchParams = useSearchParams();
  const exerciseIdParam = searchParams.get('exercise');
  
  const [workouts, setWorkouts] = useState<WorkoutHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedWorkout, setExpandedWorkout] = useState<string | null>(null);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseHistoryData | null>(null);
  const [loadingExercise, setLoadingExercise] = useState(false);
  const [autoFetchedExercise, setAutoFetchedExercise] = useState(false);
  const { preferences } = useUserPreferences();
  const unit = preferences.units;

  const handleDeleteWorkout = async (workoutId: string, state: string) => {
    const action = state === 'in_progress' ? 'cancel' : 'delete';
    if (!confirm(`Are you sure you want to ${action} this workout? This cannot be undone.`)) {
      return;
    }

    setDeletingId(workoutId);
    try {
      const supabase = createUntypedClient();
      
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select('id')
        .eq('workout_session_id', workoutId);
      
      if (blocks && blocks.length > 0) {
        const blockIds = blocks.map((b: { id: string }) => b.id);
        await supabase.from('set_logs').delete().in('exercise_block_id', blockIds);
      }
      
      await supabase.from('exercise_blocks').delete().eq('workout_session_id', workoutId);
      await supabase.from('workout_sessions').delete().eq('id', workoutId);
      
      setWorkouts(workouts.filter(w => w.id !== workoutId));
    } catch (err) {
      console.error('Failed to delete workout:', err);
      alert('Failed to delete workout. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const fetchExerciseHistory = async (exerciseId: string, exerciseName: string, primaryMuscle: string) => {
    setLoadingExercise(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) return;

      // Fetch all exercise blocks for this exercise
      const { data: blocks } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          workout_session_id,
          workout_sessions!inner (
            id,
            completed_at,
            state,
            user_id
          ),
          set_logs (
            id,
            weight_kg,
            reps,
            rpe,
            is_warmup,
            logged_at
          )
        `)
        .eq('exercise_id', exerciseId)
        .eq('workout_sessions.user_id', user.id)
        .eq('workout_sessions.state', 'completed')
        .order('workout_sessions(completed_at)', { ascending: true });

      if (!blocks || blocks.length === 0) {
        setSelectedExercise({
          exerciseId,
          exerciseName,
          primaryMuscle,
          history: [],
          currentE1RM: 0,
          allTimeMaxE1RM: 0,
          allTimeBestWeight: 0,
          allTimeBestReps: 0,
          totalSetsAllTime: 0,
          progressPercent: 0,
        });
        return;
      }

      // Process history by date
      const historyMap = new Map<string, ExerciseHistoryEntry>();
      let allTimeMaxE1RM = 0;
      let allTimeBestWeight = 0;
      let allTimeBestReps = 0;
      let totalSetsAllTime = 0;

      blocks.forEach((block: any) => {
        const session = block.workout_sessions;
        if (!session?.completed_at) return;

        const dateKey = session.completed_at.split('T')[0];
        const workingSets = (block.set_logs || []).filter((s: any) => !s.is_warmup);
        
        if (workingSets.length === 0) return;

        // Calculate stats for this session
        let sessionBestWeight = 0;
        let sessionBestReps = 0;
        let sessionBestE1RM = 0;
        let sessionVolume = 0;
        const sets: { weight: number; reps: number; rpe: number | null }[] = [];

        workingSets.forEach((set: any) => {
          const e1rm = calculateE1RM(set.weight_kg, set.reps);
          sets.push({ weight: set.weight_kg, reps: set.reps, rpe: set.rpe });
          sessionVolume += set.weight_kg * set.reps;
          
          if (e1rm > sessionBestE1RM) {
            sessionBestE1RM = e1rm;
            sessionBestWeight = set.weight_kg;
            sessionBestReps = set.reps;
          }
          
          if (e1rm > allTimeMaxE1RM) {
            allTimeMaxE1RM = e1rm;
          }
          if (set.weight_kg > allTimeBestWeight) {
            allTimeBestWeight = set.weight_kg;
          }
          if (set.reps > allTimeBestReps && set.weight_kg >= allTimeBestWeight * 0.8) {
            allTimeBestReps = set.reps;
          }
        });

        totalSetsAllTime += workingSets.length;

        // Merge with existing entry for same date or create new
        if (historyMap.has(dateKey)) {
          const existing = historyMap.get(dateKey)!;
          if (sessionBestE1RM > existing.estimatedE1RM) {
            existing.estimatedE1RM = sessionBestE1RM;
            existing.bestWeight = sessionBestWeight;
            existing.bestReps = sessionBestReps;
          }
          existing.totalSets += workingSets.length;
          existing.totalVolume += sessionVolume;
          existing.sets.push(...sets);
        } else {
          historyMap.set(dateKey, {
            date: dateKey,
            displayDate: new Date(dateKey).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            bestWeight: sessionBestWeight,
            bestReps: sessionBestReps,
            totalSets: workingSets.length,
            totalVolume: sessionVolume,
            estimatedE1RM: sessionBestE1RM,
            sets,
          });
        }
      });

      const history = Array.from(historyMap.values()).sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      // Calculate progress
      const currentE1RM = history.length > 0 ? history[history.length - 1].estimatedE1RM : 0;
      const firstE1RM = history.length > 0 ? history[0].estimatedE1RM : 0;
      const progressPercent = firstE1RM > 0 ? ((currentE1RM - firstE1RM) / firstE1RM) * 100 : 0;

      setSelectedExercise({
        exerciseId,
        exerciseName,
        primaryMuscle,
        history,
        currentE1RM,
        allTimeMaxE1RM,
        allTimeBestWeight,
        allTimeBestReps,
        totalSetsAllTime,
        progressPercent,
      });
    } catch (err) {
      console.error('Failed to fetch exercise history:', err);
    } finally {
      setLoadingExercise(false);
    }
  };

  useEffect(() => {
    async function fetchHistory() {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          planned_date,
          completed_at,
          state,
          session_rpe,
          session_notes,
          pump_rating,
          exercise_blocks (
            id,
            order,
            exercise_id,
            exercises (
              id,
              name,
              primary_muscle
            ),
            set_logs (
              id,
              set_number,
              weight_kg,
              reps,
              rpe,
              is_warmup
            )
          )
        `)
        .eq('user_id', user.id)
        .in('state', ['completed', 'in_progress'])
        .order('completed_at', { ascending: false, nullsFirst: false });

      if (data) {
        const transformed: WorkoutHistory[] = data.map((workout: any) => {
          const exercises: ExerciseDetail[] = (workout.exercise_blocks || [])
            .sort((a: any, b: any) => a.order - b.order)
            .filter((block: any) => block.exercises)
            .map((block: any) => {
              const workingSets = (block.set_logs || [])
                .filter((set: any) => !set.is_warmup)
                .sort((a: any, b: any) => a.set_number - b.set_number);
              
              return {
                id: block.id,
                exerciseId: block.exercise_id,
                name: block.exercises.name,
                primaryMuscle: block.exercises.primary_muscle,
                sets: workingSets.map((set: any) => ({
                  id: set.id,
                  weight_kg: set.weight_kg,
                  reps: set.reps,
                  rpe: set.rpe,
                })),
              };
            });

          const totalSets = exercises.reduce((sum, ex) => sum + ex.sets.length, 0);
          const totalVolume = exercises.reduce((sum, ex) => 
            sum + ex.sets.reduce((setSum, set) => setSum + (set.weight_kg * set.reps), 0), 0
          );

          return {
            id: workout.id,
            planned_date: workout.planned_date,
            completed_at: workout.completed_at,
            state: workout.state,
            session_rpe: workout.session_rpe,
            session_notes: workout.session_notes,
            pump_rating: workout.pump_rating,
            exercises,
            totalSets,
            totalVolume,
          };
        });
        setWorkouts(transformed);
      }

      setIsLoading(false);
    }

    fetchHistory();
  }, []);

  // Auto-fetch exercise from query parameter (from analytics page)
  useEffect(() => {
    async function autoFetchExercise() {
      if (!exerciseIdParam || autoFetchedExercise || isLoading) return;
      
      setAutoFetchedExercise(true);
      
      try {
        const supabase = createUntypedClient();
        
        // Get exercise details
        const { data: exercise } = await supabase
          .from('exercises')
          .select('id, name, primary_muscle')
          .eq('id', exerciseIdParam)
          .single();
        
        if (exercise) {
          fetchExerciseHistory(exercise.id, exercise.name, exercise.primary_muscle);
        }
      } catch (err) {
        console.error('Failed to auto-fetch exercise:', err);
      }
    }
    
    autoFetchExercise();
  }, [exerciseIdParam, autoFetchedExercise, isLoading]);

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

  const toggleExpand = (workoutId: string) => {
    setExpandedWorkout(expandedWorkout === workoutId ? null : workoutId);
  };

  // Exercise History Modal
  const ExerciseHistoryModal = () => {
    if (!selectedExercise) return null;

    const chartData = selectedExercise.history.map(h => ({
      date: h.displayDate,
      e1rm: Math.round(convertWeight(h.estimatedE1RM, 'kg', unit)),
      weight: Math.round(convertWeight(h.bestWeight, 'kg', unit)),
    }));

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
        <div className="bg-surface-900 rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden shadow-2xl border border-surface-700">
          {/* Modal header */}
          <div className="p-4 border-b border-surface-800 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-100">{selectedExercise.exerciseName}</h2>
              <p className="text-sm text-surface-400 capitalize">{selectedExercise.primaryMuscle}</p>
            </div>
            <button
              onClick={() => setSelectedExercise(null)}
              className="p-2 hover:bg-surface-800 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Modal content */}
          <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
            {loadingExercise ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
              </div>
            ) : selectedExercise.history.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-surface-400">No history found for this exercise</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Stats cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">Current E1RM</p>
                    <p className="text-xl font-bold text-primary-400">
                      {formatWeight(selectedExercise.currentE1RM, unit)}
                    </p>
                  </div>
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">All-Time Best</p>
                    <p className="text-xl font-bold text-success-400">
                      {formatWeight(selectedExercise.allTimeMaxE1RM, unit)}
                    </p>
                  </div>
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">Best Lift</p>
                    <p className="text-xl font-bold text-surface-200">
                      {formatWeight(selectedExercise.allTimeBestWeight, unit)}
                    </p>
                    <p className="text-xs text-surface-500">× {selectedExercise.allTimeBestReps} reps</p>
                  </div>
                  <div className="bg-surface-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-surface-500 uppercase">Progress</p>
                    <p className={`text-xl font-bold ${selectedExercise.progressPercent >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                      {selectedExercise.progressPercent >= 0 ? '+' : ''}{selectedExercise.progressPercent.toFixed(1)}%
                    </p>
                    <p className="text-xs text-surface-500">{selectedExercise.totalSetsAllTime} total sets</p>
                  </div>
                </div>

                {/* Progress chart */}
                {chartData.length > 1 && (
                  <div className="bg-surface-800 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-surface-300 mb-4">Estimated 1RM Progress</h3>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#9CA3AF" 
                            tick={{ fontSize: 11 }}
                            interval="preserveStartEnd"
                          />
                          <YAxis 
                            stroke="#9CA3AF" 
                            tick={{ fontSize: 11 }}
                            domain={['auto', 'auto']}
                            tickFormatter={(value) => `${value}`}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#1F2937',
                              border: '1px solid #374151',
                              borderRadius: '8px',
                            }}
                            labelStyle={{ color: '#9CA3AF' }}
                            formatter={(value: number, name: string) => [
                              `${value} ${unit}`,
                              name === 'e1rm' ? 'Est. 1RM' : 'Best Weight'
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="e1rm"
                            stroke="#8B5CF6"
                            strokeWidth={2}
                            dot={{ fill: '#8B5CF6', strokeWidth: 0, r: 4 }}
                            activeDot={{ r: 6 }}
                          />
                          <ReferenceLine 
                            y={Math.round(convertWeight(selectedExercise.allTimeMaxE1RM, 'kg', unit))} 
                            stroke="#22C55E" 
                            strokeDasharray="5 5"
                            label={{ value: 'PR', fill: '#22C55E', fontSize: 11 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* History list */}
                <div>
                  <h3 className="text-sm font-semibold text-surface-300 mb-3">Workout History</h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {[...selectedExercise.history].reverse().map((entry, idx) => (
                      <div key={idx} className="bg-surface-800/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-surface-200">
                            {new Date(entry.date).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          <Badge variant="info" size="sm">
                            E1RM: {formatWeight(entry.estimatedE1RM, unit)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {entry.sets.map((set, setIdx) => (
                            <span 
                              key={setIdx}
                              className="px-2 py-1 bg-surface-700 rounded text-xs text-surface-300"
                            >
                              {formatWeight(set.weight, unit)} × {set.reps}
                              {set.rpe && <span className="text-surface-500"> @{set.rpe}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout History</h1>
          <p className="text-surface-400 mt-1">Your past training sessions</p>
        </div>
        <Card className="text-center py-12">
          <LoadingAnimation type="random" size="md" />
          <p className="text-surface-400 mt-4">Loading your workout history...</p>
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
          {workouts.map((workout) => {
            const isExpanded = expandedWorkout === workout.id;
            
            return (
              <Card key={workout.id} className="overflow-hidden group relative">
                {/* Delete button - small icon in top right */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteWorkout(workout.id, workout.state);
                  }}
                  disabled={deletingId === workout.id}
                  className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-danger-500/20 text-surface-500 hover:text-danger-400 transition-all z-10"
                  title={workout.state === 'in_progress' ? 'Cancel workout' : 'Delete workout'}
                >
                  {deletingId === workout.id ? (
                    <div className="w-4 h-4 border-2 border-danger-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  )}
                </button>

                {/* Main clickable area */}
                <Link href={`/dashboard/workout/${workout.id}`} className="block">
                  <div className="p-4 sm:p-6 hover:bg-surface-800/30 transition-colors cursor-pointer">
                    {/* Header row */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="flex-1 pr-8">
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
                          {workout.state === 'in_progress' && (
                            <Badge variant="info" size="sm">
                              Continue →
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-surface-400">
                          {workout.completed_at && (
                            <span>Finished at {formatTime(workout.completed_at)}</span>
                          )}
                          <span>{workout.exercises.length} exercises</span>
                          <span>{workout.totalSets} sets</span>
                          <span>{formatWeight(workout.totalVolume, unit)} total</span>
                          {workout.session_rpe && (
                            <span className="flex items-center gap-1">
                              RPE: <span className={workout.session_rpe >= 8 ? 'text-danger-400' : workout.session_rpe >= 6 ? 'text-warning-400' : 'text-surface-300'}>{workout.session_rpe}</span>
                            </span>
                          )}
                          {workout.pump_rating && (
                            <span>
                              {workout.pump_rating === 5 && '🔥'}
                              {workout.pump_rating === 4 && '😄'}
                              {workout.pump_rating === 3 && '😊'}
                              {workout.pump_rating === 2 && '🙂'}
                              {workout.pump_rating === 1 && '😐'}
                            </span>
                          )}
                        </div>
                        {workout.session_notes && (
                          <p className="mt-2 text-sm text-surface-500 line-clamp-2">
                            {workout.session_notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>

                {/* Exercise summary - outside the link */}
                {workout.exercises.length > 0 && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-0 border-t border-surface-800">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleExpand(workout.id);
                      }}
                      className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200 transition-colors py-3"
                    >
                      <svg 
                        className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      {isExpanded ? 'Hide details' : 'Show exercise details'}
                    </button>

                    {/* Quick exercise list */}
                    {!isExpanded && (
                      <div className="flex flex-wrap gap-2">
                        {workout.exercises.map((exercise) => (
                          <button
                            key={exercise.id}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle);
                            }}
                            className="px-2 py-1 bg-surface-800 hover:bg-surface-700 rounded text-xs text-surface-300 transition-colors"
                          >
                            {exercise.name} ({exercise.sets.length})
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Detailed exercise breakdown */}
                    {isExpanded && (
                      <div className="space-y-4">
                        {workout.exercises.map((exercise) => (
                          <div key={exercise.id} className="bg-surface-800/50 rounded-lg p-3">
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                fetchExerciseHistory(exercise.exerciseId, exercise.name, exercise.primaryMuscle);
                              }}
                              className="flex items-center justify-between mb-2 w-full text-left group"
                            >
                              <h4 className="font-medium text-surface-200 group-hover:text-primary-400 transition-colors">
                                {exercise.name}
                                <svg className="w-4 h-4 inline ml-2 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                              </h4>
                              <Badge variant="default" size="sm">
                                {exercise.primaryMuscle}
                              </Badge>
                            </button>
                            
                            {exercise.sets.length > 0 ? (
                              <div className="space-y-1">
                                {exercise.sets.map((set, idx) => (
                                  <div 
                                    key={set.id} 
                                    className="flex items-center gap-4 text-sm py-1 px-2 rounded hover:bg-surface-700/50"
                                  >
                                    <span className="text-surface-500 w-8">#{idx + 1}</span>
                                    <span className="text-surface-200 font-medium">
                                      {formatWeight(set.weight_kg, unit)}
                                    </span>
                                    <span className="text-surface-400">×</span>
                                    <span className="text-surface-200 font-medium">
                                      {set.reps} reps
                                    </span>
                                    {set.rpe && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                                        set.rpe >= 9 ? 'bg-danger-500/20 text-danger-400' :
                                        set.rpe >= 7 ? 'bg-warning-500/20 text-warning-400' :
                                        'bg-surface-700 text-surface-400'
                                      }`}>
                                        RPE {set.rpe}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-surface-500">No sets recorded</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Exercise History Modal */}
      <ExerciseHistoryModal />
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<FullPageLoading text="Loading workout history..." type="barbell" />}>
      <HistoryPageContent />
    </Suspense>
  );
}
