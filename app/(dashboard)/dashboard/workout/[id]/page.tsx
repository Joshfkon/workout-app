'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge, Input } from '@/components/ui';
import { ExerciseCard, SetInputRow, RestTimer, WarmupProtocol, ReadinessCheckIn, SessionSummary } from '@/components/workout';
import type { Exercise, ExerciseBlock, SetLog, WorkoutSession } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { MUSCLE_GROUPS } from '@/types/schema';

type WorkoutPhase = 'loading' | 'checkin' | 'workout' | 'summary' | 'error';

interface ExerciseBlockWithExercise extends ExerciseBlock {
  exercise: Exercise;
}

interface AvailableExercise {
  id: string;
  name: string;
  primary_muscle: string;
  mechanic: 'compound' | 'isolation';
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [phase, setPhase] = useState<WorkoutPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlockWithExercise[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState<SetLog[]>([]);
  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [showRestTimer, setShowRestTimer] = useState(false);
  
  // Add exercise modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<AvailableExercise[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('');
  const [isAddingExercise, setIsAddingExercise] = useState(false);

  const currentBlock = blocks[currentBlockIndex];
  const currentExercise = currentBlock?.exercise;
  const currentBlockSets = completedSets.filter(s => s.exerciseBlockId === currentBlock?.id);

  // Load workout data
  useEffect(() => {
    async function loadWorkout() {
      try {
        const supabase = createUntypedClient();

        // Fetch session
        const { data: sessionData, error: sessionError } = await supabase
          .from('workout_sessions')
          .select('*')
          .eq('id', sessionId)
          .single();

        if (sessionError || !sessionData) {
          throw new Error('Workout session not found');
        }

        // Fetch exercise blocks with exercises
        const { data: blocksData, error: blocksError } = await supabase
          .from('exercise_blocks')
          .select(`
            *,
            exercises (*)
          `)
          .eq('workout_session_id', sessionId)
          .order('order');

        if (blocksError) throw blocksError;

        // Transform data
        const transformedSession: WorkoutSession = {
          id: sessionData.id,
          userId: sessionData.user_id,
          mesocycleId: sessionData.mesocycle_id,
          state: sessionData.state,
          plannedDate: sessionData.planned_date,
          startedAt: sessionData.started_at,
          completedAt: sessionData.completed_at,
          preWorkoutCheckIn: sessionData.pre_workout_check_in,
          sessionRpe: sessionData.session_rpe,
          pumpRating: sessionData.pump_rating,
          sessionNotes: sessionData.session_notes,
          completionPercent: sessionData.completion_percent,
        };

        const transformedBlocks: ExerciseBlockWithExercise[] = (blocksData || [])
          .filter((block: any) => block.exercises) // Filter out blocks without exercises
          .map((block: any) => ({
            id: block.id,
            workoutSessionId: block.workout_session_id,
            exerciseId: block.exercise_id,
            order: block.order,
            supersetGroupId: block.superset_group_id,
            supersetOrder: block.superset_order,
            targetSets: block.target_sets,
            targetRepRange: block.target_rep_range,
            targetRir: block.target_rir,
            targetWeightKg: block.target_weight_kg,
            targetRestSeconds: block.target_rest_seconds,
            progressionType: block.progression_type,
            suggestionReason: block.suggestion_reason,
            warmupProtocol: block.warmup_protocol?.sets || [],
            note: block.note,
            exercise: {
              id: block.exercises.id,
              name: block.exercises.name,
              primaryMuscle: block.exercises.primary_muscle,
              secondaryMuscles: block.exercises.secondary_muscles || [],
              mechanic: block.exercises.mechanic,
              defaultRepRange: block.exercises.default_rep_range || [8, 12],
              defaultRir: block.exercises.default_rir || 2,
              minWeightIncrementKg: block.exercises.min_weight_increment_kg || 2.5,
              formCues: block.exercises.form_cues || [],
              commonMistakes: block.exercises.common_mistakes || [],
              setupNote: block.exercises.setup_note || '',
              movementPattern: block.exercises.movement_pattern || '',
              equipmentRequired: block.exercises.equipment_required || [],
            },
          }));

        setSession(transformedSession);
        setBlocks(transformedBlocks);
        
        // If already in progress, skip check-in
        if (sessionData.state === 'in_progress') {
          setPhase('workout');
        } else {
          setPhase('checkin');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workout');
        setPhase('error');
      }
    }

    loadWorkout();
  }, [sessionId]);

  const handleCheckInComplete = async () => {
    try {
      const supabase = createUntypedClient();
      await supabase
        .from('workout_sessions')
        .update({
          state: 'in_progress',
          started_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
      
      setPhase('workout');
    } catch (err) {
      console.error('Failed to update session:', err);
      setPhase('workout'); // Continue anyway
    }
  };

  const handleSetComplete = async (data: { weightKg: number; reps: number; rpe: number; note?: string }) => {
    if (!currentBlock) return;

    const newSet: SetLog = {
      id: `set-${Date.now()}`,
      exerciseBlockId: currentBlock.id,
      setNumber: currentSetNumber,
      weightKg: data.weightKg,
      reps: data.reps,
      rpe: data.rpe,
      restSeconds: null,
      isWarmup: false,
      quality: data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective',
      qualityReason: '',
      note: data.note || null,
      loggedAt: new Date().toISOString(),
    };

    // Save to database
    try {
      const supabase = createUntypedClient();
      await supabase.from('set_logs').insert({
        id: newSet.id,
        exercise_block_id: newSet.exerciseBlockId,
        set_number: newSet.setNumber,
        weight_kg: newSet.weightKg,
        reps: newSet.reps,
        rpe: newSet.rpe,
        is_warmup: false,
        quality: newSet.quality,
        quality_reason: newSet.qualityReason,
        note: newSet.note,
        logged_at: newSet.loggedAt,
      });
    } catch (err) {
      console.error('Failed to save set:', err);
    }

    setCompletedSets([...completedSets, newSet]);
    setCurrentSetNumber(currentSetNumber + 1);
    setShowRestTimer(true);
  };

  const handleSetEdit = async (setId: string, data: { weightKg: number; reps: number; rpe: number }) => {
    // Update local state
    setCompletedSets(completedSets.map(set => 
      set.id === setId 
        ? { 
            ...set, 
            weightKg: data.weightKg, 
            reps: data.reps, 
            rpe: data.rpe,
            quality: data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective' as const,
          }
        : set
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      await supabase.from('set_logs').update({
        weight_kg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        quality: data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective',
      }).eq('id', setId);
    } catch (err) {
      console.error('Failed to update set:', err);
    }
  };

  const handleNextExercise = () => {
    if (currentBlockIndex < blocks.length - 1) {
      setCurrentBlockIndex(currentBlockIndex + 1);
      setCurrentSetNumber(1);
      setShowRestTimer(false);
    }
  };

  // Fetch exercises when add exercise modal opens
  const fetchExercises = async (muscle?: string) => {
    const supabase = createUntypedClient();
    let query = supabase
      .from('exercises')
      .select('id, name, primary_muscle, mechanic')
      .order('name');
    
    if (muscle) {
      query = query.eq('primary_muscle', muscle);
    }
    
    const { data } = await query;
    if (data) {
      setAvailableExercises(data);
    }
  };

  const handleOpenAddExercise = () => {
    setShowAddExercise(true);
    fetchExercises();
  };

  const handleMuscleFilter = (muscle: string) => {
    setSelectedMuscle(muscle);
    if (muscle) {
      fetchExercises(muscle);
    } else {
      fetchExercises();
    }
  };

  const handleAddExercise = async (exercise: AvailableExercise) => {
    setIsAddingExercise(true);
    
    try {
      const supabase = createUntypedClient();
      const isCompound = exercise.mechanic === 'compound';
      
      // Generate warmup for compound exercises
      const warmupSets = isCompound ? generateWarmupProtocol({
        workingWeight: 60,
        exercise: {
          id: exercise.id,
          name: exercise.name,
          primaryMuscle: exercise.primary_muscle,
          secondaryMuscles: [],
          mechanic: exercise.mechanic,
          defaultRepRange: [8, 12],
          defaultRir: 2,
          minWeightIncrementKg: 2.5,
          formCues: [],
          commonMistakes: [],
          setupNote: '',
          movementPattern: '',
          equipmentRequired: [],
        },
        isFirstExercise: false,
      }) : [];

      // Create new exercise block
      const newOrder = blocks.length + 1;
      const { data: newBlock, error: blockError } = await supabase
        .from('exercise_blocks')
        .insert({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: newOrder,
          target_sets: isCompound ? 4 : 3,
          target_rep_range: isCompound ? [6, 10] : [10, 15],
          target_rir: 2,
          target_weight_kg: 0,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: 'Added mid-workout',
          warmup_protocol: { sets: warmupSets },
        })
        .select()
        .single();

      if (blockError || !newBlock) throw blockError;

      // Fetch full exercise data
      const { data: exerciseData } = await supabase
        .from('exercises')
        .select('*')
        .eq('id', exercise.id)
        .single();

      // Add to blocks state
      const newBlockWithExercise: ExerciseBlockWithExercise = {
        id: newBlock.id,
        workoutSessionId: newBlock.workout_session_id,
        exerciseId: newBlock.exercise_id,
        order: newBlock.order,
        supersetGroupId: null,
        supersetOrder: null,
        targetSets: newBlock.target_sets,
        targetRepRange: newBlock.target_rep_range,
        targetRir: newBlock.target_rir,
        targetWeightKg: newBlock.target_weight_kg,
        targetRestSeconds: newBlock.target_rest_seconds,
        progressionType: null,
        suggestionReason: newBlock.suggestion_reason,
        warmupProtocol: warmupSets,
        note: null,
        exercise: {
          id: exerciseData.id,
          name: exerciseData.name,
          primaryMuscle: exerciseData.primary_muscle,
          secondaryMuscles: exerciseData.secondary_muscles || [],
          mechanic: exerciseData.mechanic,
          defaultRepRange: exerciseData.default_rep_range || [8, 12],
          defaultRir: exerciseData.default_rir || 2,
          minWeightIncrementKg: exerciseData.min_weight_increment_kg || 2.5,
          formCues: exerciseData.form_cues || [],
          commonMistakes: exerciseData.common_mistakes || [],
          setupNote: exerciseData.setup_note || '',
          movementPattern: exerciseData.movement_pattern || '',
          equipmentRequired: exerciseData.equipment_required || [],
        },
      };

      setBlocks([...blocks, newBlockWithExercise]);
      setShowAddExercise(false);
      setExerciseSearch('');
      setSelectedMuscle('');
    } catch (err) {
      console.error('Failed to add exercise:', err);
    } finally {
      setIsAddingExercise(false);
    }
  };

  const handleWorkoutComplete = () => {
    setPhase('summary');
  };

  const handleSummarySubmit = async (data: { sessionRpe: number; pumpRating: number; notes: string }) => {
    try {
      const supabase = createUntypedClient();
      await supabase
        .from('workout_sessions')
        .update({
          state: 'completed',
          completed_at: new Date().toISOString(),
          session_rpe: data.sessionRpe,
          pump_rating: data.pumpRating,
          session_notes: data.notes,
          completion_percent: 100,
        })
        .eq('id', sessionId);

      router.push('/dashboard/history');
    } catch (err) {
      console.error('Failed to complete workout:', err);
      router.push('/dashboard/history');
    }
  };

  if (phase === 'loading') {
    return (
      <div className="max-w-lg mx-auto py-8 text-center">
        <p className="text-surface-400">Loading workout...</p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="max-w-lg mx-auto py-8">
        <Card className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-danger-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-lg font-medium text-surface-200">Error Loading Workout</p>
          <p className="text-surface-500 mt-1">{error}</p>
          <Button className="mt-4" onClick={() => router.push('/dashboard/workout')}>
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  if (phase === 'checkin') {
    return (
      <div className="max-w-lg mx-auto py-8">
        <ReadinessCheckIn
          onSubmit={handleCheckInComplete}
          onSkip={handleCheckInComplete}
        />
      </div>
    );
  }

  if (phase === 'summary' && session) {
    return (
      <div className="py-8">
        <SessionSummary
          session={{
            ...session,
            state: 'completed',
            completedAt: new Date().toISOString(),
          }}
          exerciseBlocks={blocks}
          allSets={completedSets}
          onSubmit={handleSummarySubmit}
        />
      </div>
    );
  }

  if (!currentBlock || !currentExercise) {
    return (
      <div className="max-w-lg mx-auto py-8">
        <Card className="text-center py-8">
          <p className="text-surface-400">No exercises in this workout</p>
          <Button className="mt-4" onClick={() => router.push('/dashboard/workout')}>
            Go Back
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Workout header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout</h1>
          <p className="text-surface-400">
            Exercise {currentBlockIndex + 1} of {blocks.length}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={handleOpenAddExercise}>
            <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add
          </Button>
          <Button variant="outline" onClick={handleWorkoutComplete}>
            Finish
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-surface-800 rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary-500 h-full transition-all duration-300"
          style={{ width: `${(currentBlockSets.length / currentBlock.targetSets) * 100}%` }}
        />
      </div>

      {/* Rest timer - fixed on mobile */}
      {showRestTimer && (
        <RestTimer
          defaultSeconds={currentBlock.targetRestSeconds}
          autoStart
          onComplete={() => setShowRestTimer(false)}
          onDismiss={() => setShowRestTimer(false)}
        />
      )}

      {/* Spacer for fixed timer on mobile */}
      {showRestTimer && <div className="h-40 lg:hidden" />}

      {/* Warmup protocol */}
      {currentBlock.warmupProtocol && currentBlock.warmupProtocol.length > 0 && (
        <WarmupProtocol
          warmupSets={currentBlock.warmupProtocol}
          workingWeight={currentBlock.targetWeightKg}
          minIncrement={currentExercise.minWeightIncrementKg}
        />
      )}

      {/* Exercise card */}
      <ExerciseCard
        exercise={currentExercise}
        block={currentBlock}
        sets={currentBlockSets}
        onSetEdit={handleSetEdit}
        isActive
      />

      {/* Set input */}
      {currentBlockSets.length < currentBlock.targetSets && (
        <SetInputRow
          setNumber={currentBlockSets.length + 1}
          targetWeight={currentBlock.targetWeightKg}
          targetRepRange={currentBlock.targetRepRange}
          targetRir={currentBlock.targetRir}
          previousSet={currentBlockSets[currentBlockSets.length - 1]}
          isLastSet={currentBlockSets.length + 1 === currentBlock.targetSets}
          onSubmit={handleSetComplete}
        />
      )}

      {/* All sets completed for current exercise */}
      {currentBlockSets.length >= currentBlock.targetSets && (
        <Card className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success-500/20 flex items-center justify-center">
            <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-medium text-surface-200">Exercise Complete!</p>
          <p className="text-surface-500 mt-1">
            {currentBlockIndex < blocks.length - 1 
              ? 'Move to next exercise or finish workout'
              : 'All exercises done! Finish your workout'}
          </p>
          <div className="flex justify-center gap-3 mt-4">
            {currentBlockIndex < blocks.length - 1 && (
              <Button variant="secondary" onClick={handleNextExercise}>
                Next Exercise
              </Button>
            )}
            <Button variant="ghost" onClick={handleOpenAddExercise}>
              Add Exercise
            </Button>
            <Button onClick={handleWorkoutComplete}>Finish Workout</Button>
          </div>
        </Card>
      )}

      {/* Add Exercise Modal */}
      {showAddExercise && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowAddExercise(false)}
          />
          
          {/* Modal */}
          <div className="relative w-full max-w-lg max-h-[80vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
              <button
                onClick={() => setShowAddExercise(false)}
                className="p-2 text-surface-400 hover:text-surface-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Search and filter */}
            <div className="p-4 space-y-3 border-b border-surface-800">
              <Input
                placeholder="Search exercises..."
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => handleMuscleFilter('')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
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
                    onClick={() => handleMuscleFilter(muscle)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap capitalize transition-colors ${
                      selectedMuscle === muscle
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    {muscle}
                  </button>
                ))}
              </div>
            </div>

            {/* Exercise list */}
            <div className="flex-1 overflow-y-auto p-4">
              {availableExercises.length === 0 ? (
                <p className="text-center text-surface-500 py-8">Loading exercises...</p>
              ) : (
                <div className="space-y-2">
                  {availableExercises
                    .filter(ex => 
                      exerciseSearch === '' || 
                      ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
                    )
                    .map((exercise) => (
                      <button
                        key={exercise.id}
                        onClick={() => handleAddExercise(exercise)}
                        disabled={isAddingExercise}
                        className="w-full flex items-center justify-between p-3 bg-surface-800/50 rounded-lg hover:bg-surface-800 transition-colors text-left disabled:opacity-50"
                      >
                        <div>
                          <p className="font-medium text-surface-200">{exercise.name}</p>
                          <p className="text-xs text-surface-500 capitalize">
                            {exercise.primary_muscle} • {exercise.mechanic}
                          </p>
                        </div>
                        <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                          {exercise.mechanic}
                        </Badge>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
