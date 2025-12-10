'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, Input, Badge, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { formatWeight } from '@/lib/utils';
import { useUserPreferences } from '@/hooks/useUserPreferences';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles: string[];
  mechanic: 'compound' | 'isolation';
  form_cues: string[];
  common_mistakes: string[];
  equipment_required: string[];
}

interface ExerciseHistory {
  lastWorkoutDate: string;
  lastWorkoutSets: { weightKg: number; reps: number; rpe?: number }[];
  estimatedE1RM: number;
  personalRecord: { weightKg: number; reps: number; e1rm: number; date: string } | null;
  totalSessions: number;
}

// Calculate E1RM using Brzycki formula
function calculateE1RM(weight: number, reps: number): number {
  if (reps === 1) return weight;
  if (reps > 12) return weight * (1 + reps / 30);
  return weight * (36 / (37 - reps));
}

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistory>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const { preferences } = useUserPreferences();
  const unit = preferences.units;

  useEffect(() => {
    async function fetchExercises() {
      const supabase = createUntypedClient();
      const { data, error } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic, form_cues, common_mistakes, equipment_required')
        .order('name');

      if (data && !error) {
        setExercises(data);
      }
      setIsLoading(false);
    }

    fetchExercises();
  }, []);

  const fetchExerciseHistory = async (exerciseId: string) => {
    if (exerciseHistories[exerciseId]) return; // Already loaded
    
    setLoadingHistory(exerciseId);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setLoadingHistory(null);
        return;
      }

      const { data: historyBlocks } = await supabase
        .from('exercise_blocks')
        .select(`
          id,
          workout_sessions!inner (
            id,
            completed_at,
            state,
            user_id
          ),
          set_logs (
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
        .order('workout_sessions(completed_at)', { ascending: false })
        .limit(20);

      if (historyBlocks && historyBlocks.length > 0) {
        let bestE1RM = 0;
        let personalRecord: ExerciseHistory['personalRecord'] = null;
        let totalSessions = 0;
        const seenSessions = new Set<string>();

        const lastBlock = historyBlocks[0];
        const lastSession = lastBlock.workout_sessions as any;
        const lastSets = ((lastBlock.set_logs as any[]) || [])
          .filter((s: any) => !s.is_warmup)
          .map((s: any) => ({
            weightKg: s.weight_kg,
            reps: s.reps,
            rpe: s.rpe,
          }));

        historyBlocks.forEach((block: any) => {
          const session = block.workout_sessions;
          if (session && !seenSessions.has(session.id)) {
            seenSessions.add(session.id);
            totalSessions++;
          }

          const sets = (block.set_logs || []).filter((s: any) => !s.is_warmup);
          sets.forEach((set: any) => {
            const e1rm = calculateE1RM(set.weight_kg, set.reps);
            if (e1rm > bestE1RM) {
              bestE1RM = e1rm;
              personalRecord = {
                weightKg: set.weight_kg,
                reps: set.reps,
                e1rm,
                date: session?.completed_at || set.logged_at,
              };
            }
          });
        });

        setExerciseHistories(prev => ({
          ...prev,
          [exerciseId]: {
            lastWorkoutDate: lastSession?.completed_at || '',
            lastWorkoutSets: lastSets,
            estimatedE1RM: bestE1RM,
            personalRecord,
            totalSessions,
          },
        }));
      } else {
        // No history found
        setExerciseHistories(prev => ({
          ...prev,
          [exerciseId]: {
            lastWorkoutDate: '',
            lastWorkoutSets: [],
            estimatedE1RM: 0,
            personalRecord: null,
            totalSessions: 0,
          },
        }));
      }
    } catch (err) {
      console.error('Failed to fetch exercise history:', err);
    } finally {
      setLoadingHistory(null);
    }
  };

  const toggleExpand = (exerciseId: string) => {
    if (expandedExercise === exerciseId) {
      setExpandedExercise(null);
    } else {
      setExpandedExercise(exerciseId);
      fetchExerciseHistory(exerciseId);
    }
  };

  const filteredExercises = exercises.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(search.toLowerCase());
    const matchesMuscle = !selectedMuscle || ex.primary_muscle === selectedMuscle;
    return matchesSearch && matchesMuscle;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Exercise Library</h1>
          <p className="text-surface-400 mt-1">
            {isLoading ? 'Loading...' : `${exercises.length} exercises available`}
          </p>
        </div>
        <Link href="/dashboard/exercises/add">
          <Button>
            <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Custom
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search exercises..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Muscle filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedMuscle(null)}
          className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
            !selectedMuscle
              ? 'bg-primary-500 text-white'
              : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
          }`}
        >
          All
        </button>
        {MUSCLE_GROUPS.map((muscle) => (
          <button
            key={muscle}
            onClick={() => setSelectedMuscle(muscle)}
            className={`px-3 py-1.5 rounded-full text-sm capitalize transition-colors ${
              selectedMuscle === muscle
                ? 'bg-primary-500 text-white'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            {muscle}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      {isLoading ? (
        <div className="grid gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-16 bg-surface-800 rounded" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          {filteredExercises.map((exercise) => {
            const isExpanded = expandedExercise === exercise.id;
            const history = exerciseHistories[exercise.id];
            const isLoadingThis = loadingHistory === exercise.id;

            return (
              <Card
                key={exercise.id}
                className={`transition-all ${isExpanded ? 'ring-1 ring-primary-500/30' : 'hover:border-surface-700'}`}
              >
                {/* Header - always visible */}
                <button
                  onClick={() => toggleExpand(exercise.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-medium text-surface-100">{exercise.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm text-surface-500 capitalize">
                          {exercise.primary_muscle}
                        </span>
                        <span className="text-surface-700">•</span>
                        <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                          {exercise.mechanic}
                        </Badge>
                        {history && history.totalSessions > 0 && (
                          <>
                            <span className="text-surface-700">•</span>
                            <span className="text-xs text-primary-400">
                              {history.totalSessions} sessions
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <svg 
                      className={`w-5 h-5 text-surface-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-surface-800 space-y-4">
                    {/* Loading state */}
                    {isLoadingThis && (
                      <div className="flex items-center justify-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-500"></div>
                      </div>
                    )}

                    {/* Stats */}
                    {!isLoadingThis && history && history.totalSessions > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Est 1RM</p>
                          <p className="text-lg font-bold text-primary-400">
                            {formatWeight(history.estimatedE1RM, unit)}
                          </p>
                        </div>
                        {history.personalRecord && (
                          <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                            <p className="text-xs text-surface-500 uppercase">PR</p>
                            <p className="text-lg font-bold text-success-400">
                              {formatWeight(history.personalRecord.weightKg, unit)} × {history.personalRecord.reps}
                            </p>
                          </div>
                        )}
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Sessions</p>
                          <p className="text-lg font-bold text-surface-200">
                            {history.totalSessions}
                          </p>
                        </div>
                        <div className="bg-surface-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-surface-500 uppercase">Last Done</p>
                          <p className="text-sm font-medium text-surface-300">
                            {new Date(history.lastWorkoutDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Last workout sets */}
                    {!isLoadingThis && history && history.lastWorkoutSets.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Last Workout Sets
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {history.lastWorkoutSets.map((set, idx) => (
                            <span 
                              key={idx}
                              className="px-3 py-1.5 bg-surface-800 rounded-lg text-sm text-surface-300"
                            >
                              {formatWeight(set.weightKg, unit)} × {set.reps}
                              {set.rpe && <span className="text-surface-500 ml-1">@{set.rpe}</span>}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* No history message */}
                    {!isLoadingThis && (!history || history.totalSessions === 0) && (
                      <div className="text-center py-4">
                        <p className="text-surface-500 text-sm">No workout history for this exercise yet</p>
                        <p className="text-surface-600 text-xs mt-1">Add it to a workout to start tracking!</p>
                      </div>
                    )}

                    {/* Exercise details */}
                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Secondary muscles */}
                      {exercise.secondary_muscles && exercise.secondary_muscles.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Secondary Muscles
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {exercise.secondary_muscles.map((muscle, idx) => (
                              <Badge key={idx} variant="default" size="sm">
                                {muscle}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Equipment */}
                      {exercise.equipment_required && exercise.equipment_required.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                            Equipment
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {exercise.equipment_required.map((eq, idx) => (
                              <Badge key={idx} variant="default" size="sm">
                                {eq}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Form cues */}
                    {exercise.form_cues && exercise.form_cues.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Form Cues
                        </p>
                        <ul className="space-y-1">
                          {exercise.form_cues.map((cue, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-surface-300">
                              <span className="text-primary-400">•</span>
                              {cue}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Common mistakes */}
                    {exercise.common_mistakes && exercise.common_mistakes.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                          Common Mistakes
                        </p>
                        <ul className="space-y-1">
                          {exercise.common_mistakes.map((mistake, idx) => (
                            <li key={idx} className="flex items-start gap-2 text-sm text-danger-400/80">
                              <span>✗</span>
                              {mistake}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2 pt-2">
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' exercise form')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg text-sm text-surface-300 transition-colors"
                      >
                        <svg className="w-4 h-4 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                        Watch Form
                      </a>
                      <Link 
                        href="/dashboard/workout/new"
                        className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg text-sm text-white transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add to Workout
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && filteredExercises.length === 0 && (
        <Card className="text-center py-12">
          <p className="text-surface-400">No exercises found</p>
          <p className="text-sm text-surface-500 mt-1">
            Try adjusting your search or filters
          </p>
        </Card>
      )}
    </div>
  );
}
