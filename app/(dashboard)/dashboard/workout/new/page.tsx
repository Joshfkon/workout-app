'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

export default function NewWorkoutPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>([]);
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <h1 className="text-2xl font-bold text-surface-100">New Workout</h1>
        <p className="text-surface-400 mt-1">
          {step === 1 ? 'Select muscle groups to train' : 'Choose your exercises'}
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex gap-2">
        <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-primary-500' : 'bg-surface-700'}`} />
        <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-primary-500' : 'bg-surface-700'}`} />
      </div>

      {error && (
        <div className="p-4 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
          {error}
        </div>
      )}

      {step === 1 && (
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
      )}

      {step === 2 && (
        <div className="space-y-4">
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
