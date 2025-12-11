'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { generateWarmupProtocol } from '@/services/progressionEngine';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  mechanic: 'compound' | 'isolation';
}

function NewWorkoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateName = searchParams.get('template');
  const templateMuscles = searchParams.get('muscles');
  
  const [step, setStep] = useState(templateMuscles ? 2 : 1); // Skip to step 2 if template
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>(
    templateMuscles ? templateMuscles.split(',') : []
  );
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ muscles: string[]; exercises: string[]; reason: string } | null>(null);

  // Suggest exercises based on recent history and goals
  const suggestExercises = async () => {
    setIsSuggesting(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // Get recent workouts (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const { data: recentWorkouts } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          exercise_blocks (
            exercises (
              primary_muscle
            )
          )
        `)
        .eq('user_id', user.id)
        .gte('completed_at', weekAgo.toISOString())
        .eq('state', 'completed');
      
      // Count trained muscles
      const trainedMuscles: Record<string, number> = {};
      recentWorkouts?.forEach((workout: { id: string; exercise_blocks: Array<{ exercises: { primary_muscle: string } | null }> | null }) => {
        (workout.exercise_blocks || []).forEach((block) => {
          const muscle = block.exercises?.primary_muscle;
          if (muscle) {
            trainedMuscles[muscle] = (trainedMuscles[muscle] || 0) + 1;
          }
        });
      });
      
      // Find least trained muscles
      const allMuscles = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'biceps', 'triceps', 'glutes', 'calves', 'abs'];
      const sortedMuscles = allMuscles.sort((a, b) => (trainedMuscles[a] || 0) - (trainedMuscles[b] || 0));
      
      // Pick 2-3 muscles that haven't been trained recently
      const suggestedMuscles = sortedMuscles.slice(0, 3);
      
      // Get user's goal
      const { data: userData } = await supabase
        .from('users')
        .select('goal')
        .eq('id', user.id)
        .single();
      
      // Fetch exercises for suggested muscles
      const { data: exercisesData } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, mechanic')
        .in('primary_muscle', suggestedMuscles)
        .order('name');
      
      // Pick 4-6 exercises (compounds first)
      const compounds = exercisesData?.filter((e: { mechanic: string }) => e.mechanic === 'compound') || [];
      const isolations = exercisesData?.filter((e: { mechanic: string }) => e.mechanic === 'isolation') || [];
      const picked = [
        ...compounds.slice(0, 3),
        ...isolations.slice(0, 3),
      ];
      
      const reason = Object.keys(trainedMuscles).length === 0 
        ? 'Based on a balanced full-body approach for your first workout.'
        : `Focusing on ${suggestedMuscles.join(', ')} — these haven't been trained recently.`;
      
      setSuggestions({
        muscles: suggestedMuscles,
        exercises: picked.map((e: { id: string }) => e.id),
        reason,
      });
      
      // Apply suggestions
      setSelectedMuscles(suggestedMuscles);
      setStep(2);
      
    } catch (err) {
      console.error('Failed to suggest exercises:', err);
    } finally {
      setIsSuggesting(false);
    }
  };
  
  // Apply exercise suggestions when they're loaded
  useEffect(() => {
    if (suggestions && exercises.length > 0 && selectedExercises.length === 0) {
      // Auto-select suggested exercises
      const validSuggestions = suggestions.exercises.filter(id => 
        exercises.some(e => e.id === id)
      );
      if (validSuggestions.length > 0) {
        setSelectedExercises(validSuggestions);
      }
    }
  }, [suggestions, exercises, selectedExercises.length]);

  // Fetch exercises when muscles are selected
  useEffect(() => {
    if (step === 2 && selectedMuscles.length > 0) {
      const fetchExercises = async () => {
        setIsLoading(true);
        const supabase = createUntypedClient();
        const { data, error } = await supabase
          .from('exercises')
          .select('id, name, primary_muscle, mechanic')
          .in('primary_muscle', selectedMuscles)
          .order('name');

        if (data && !error) {
          setExercises(data);
        }
        setIsLoading(false);
      };
      fetchExercises();
    }
  }, [step, selectedMuscles]);

  const toggleMuscle = (muscle: string) => {
    setSelectedMuscles((prev) =>
      prev.includes(muscle)
        ? prev.filter((m) => m !== muscle)
        : [...prev, muscle]
    );
  };

  const toggleExercise = (exerciseId: string) => {
    setSelectedExercises((prev) =>
      prev.includes(exerciseId)
        ? prev.filter((id) => id !== exerciseId)
        : [...prev, exerciseId]
    );
  };

  const handleStartWorkout = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('You must be logged in');

      // Create workout session
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          state: 'planned',
          planned_date: new Date().toISOString().split('T')[0],
          completion_percent: 0,
        })
        .select()
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');

      // Create exercise blocks with warmup protocols
      const exerciseBlocks = selectedExercises.map((exerciseId, index) => {
        const exercise = exercises.find(e => e.id === exerciseId);
        const isCompound = exercise?.mechanic === 'compound';
        
        // Generate warmup for compound exercises
        const warmupSets = isCompound ? generateWarmupProtocol({
          workingWeight: 60, // Default starting weight, user can adjust
          exercise: {
            id: exerciseId,
            name: exercise?.name || '',
            primaryMuscle: exercise?.primary_muscle || '',
            secondaryMuscles: [],
            mechanic: exercise?.mechanic || 'compound',
            defaultRepRange: [8, 12],
            defaultRir: 2,
            minWeightIncrementKg: 2.5,
            formCues: [],
            commonMistakes: [],
            setupNote: '',
            movementPattern: '',
            equipmentRequired: [],
          },
          isFirstExercise: index === 0,
        }) : [];

        return {
          workout_session_id: session.id,
          exercise_id: exerciseId,
          order: index + 1,
          target_sets: isCompound ? 4 : 3, // More sets for compounds
          target_rep_range: isCompound ? [6, 10] : [10, 15], // Lower reps for compounds
          target_rir: 2,
          target_weight_kg: 0, // Will be set during workout
          target_rest_seconds: isCompound ? 180 : 90, // Longer rest for compounds
          suggestion_reason: 'Selected by user',
          warmup_protocol: { sets: warmupSets },
        };
      });

      const { error: blocksError } = await supabase
        .from('exercise_blocks')
        .insert(exerciseBlocks);

      if (blocksError) throw blocksError;

      // Navigate to the workout
      router.push(`/dashboard/workout/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workout');
      setIsCreating(false);
    }
  };

  // Group exercises by muscle
  const exercisesByMuscle = selectedMuscles.reduce((acc, muscle) => {
    acc[muscle] = exercises.filter((e) => e.primary_muscle === muscle);
    return acc;
  }, {} as Record<string, Exercise[]>);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">
          {templateName ? `${templateName} Workout` : 'New Workout'}
        </h1>
        <p className="text-surface-400 mt-1">
          {step === 1 
            ? 'Select muscle groups to train' 
            : templateName 
              ? `Choose exercises for your ${templateName.toLowerCase()} workout`
              : 'Choose your exercises'
          }
        </p>
      </div>

      {/* Progress indicator - hide if starting from template */}
      {!templateName && (
        <div className="flex gap-2">
          <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-primary-500' : 'bg-surface-700'}`} />
          <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-primary-500' : 'bg-surface-700'}`} />
        </div>
      )}

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {/* AI Suggestion Card */}
          <Card className="border-2 border-dashed border-accent-500/30 bg-gradient-to-r from-accent-500/5 to-primary-500/5">
            <CardContent className="p-5">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-accent-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div className="flex-1 text-center sm:text-left">
                  <h3 className="font-semibold text-surface-100">Not sure what to train?</h3>
                  <p className="text-sm text-surface-400 mt-0.5">
                    We&apos;ll suggest muscles and exercises based on your recent history and goals
                  </p>
                </div>
                <Button 
                  onClick={suggestExercises}
                  isLoading={isSuggesting}
                  className="whitespace-nowrap"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Suggest Workout
                </Button>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>What are you training today?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MUSCLE_GROUPS.map((muscle) => (
                  <button
                    key={muscle}
                    onClick={() => toggleMuscle(muscle)}
                    className={`p-4 rounded-lg text-left transition-all capitalize ${
                      selectedMuscles.includes(muscle)
                        ? 'bg-primary-500/20 border-2 border-primary-500 text-primary-400'
                        : 'bg-surface-800 border-2 border-transparent text-surface-300 hover:bg-surface-700'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>

              <div className="flex justify-between mt-6 pt-4 border-t border-surface-800">
                <Button variant="ghost" onClick={() => router.back()}>
                  Cancel
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  disabled={selectedMuscles.length === 0}
                >
                  Next: Choose Exercises
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          {/* Show AI suggestion reason */}
          {suggestions && (
            <div className="p-4 bg-accent-500/10 border border-accent-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-accent-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div>
                  <p className="font-medium text-accent-300">AI Suggestion</p>
                  <p className="text-sm text-surface-400 mt-0.5">{suggestions.reason}</p>
                </div>
              </div>
            </div>
          )}
          
          {isLoading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-surface-400">Loading exercises...</p>
              </CardContent>
            </Card>
          ) : (
            selectedMuscles.map((muscle) => (
              <Card key={muscle}>
                <CardHeader>
                  <CardTitle className="capitalize">{muscle}</CardTitle>
                </CardHeader>
                <CardContent>
                  {exercisesByMuscle[muscle]?.length > 0 ? (
                    <div className="space-y-2">
                      {exercisesByMuscle[muscle].map((exercise) => (
                        <button
                          key={exercise.id}
                          onClick={() => toggleExercise(exercise.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg transition-all ${
                            selectedExercises.includes(exercise.id)
                              ? 'bg-primary-500/20 border border-primary-500/50'
                              : 'bg-surface-800 border border-transparent hover:bg-surface-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                                selectedExercises.includes(exercise.id)
                                  ? 'bg-primary-500 border-primary-500'
                                  : 'border-surface-600'
                              }`}
                            >
                              {selectedExercises.includes(exercise.id) && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </div>
                            <span className="text-surface-200">{exercise.name}</span>
                          </div>
                          <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                            {exercise.mechanic}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-surface-500 text-center py-4">
                      No exercises found for this muscle group
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}

          <Card className="sticky bottom-4">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-surface-400">
                    {selectedExercises.length} exercises selected
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={() => setStep(1)}>
                    Back
                  </Button>
                  <Button
                    onClick={handleStartWorkout}
                    disabled={selectedExercises.length === 0 || isCreating}
                    isLoading={isCreating}
                  >
                    Start Workout
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function NewWorkoutPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <NewWorkoutContent />
    </Suspense>
  );
}
