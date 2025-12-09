'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge, Input } from '@/components/ui';
import { ExerciseCard, SetInputRow, RestTimer, WarmupProtocol, ReadinessCheckIn, SessionSummary } from '@/components/workout';
import type { Exercise, ExerciseBlock, SetLog, WorkoutSession, WeightUnit, DexaRegionalData } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { MUSCLE_GROUPS } from '@/types/schema';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { quickWeightEstimate, type WorkingWeightRecommendation } from '@/services/weightEstimationEngine';
import { formatWeight } from '@/lib/utils';

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

interface UserProfileForWeights {
  weightKg: number;
  heightCm: number;
  bodyFatPercent: number;
  experience: 'novice' | 'intermediate' | 'advanced';
  regionalData?: DexaRegionalData;
}

// Generate coach message based on workout structure
function generateCoachMessage(
  blocks: ExerciseBlockWithExercise[],
  userProfile?: UserProfileForWeights
): {
  greeting: string;
  overview: string;
  exerciseNotes: { name: string; reason: string; weightRec?: WorkingWeightRecommendation }[];
  tips: string[];
} {
  if (blocks.length === 0) {
    return {
      greeting: "Let's get started!",
      overview: "Your workout is ready.",
      exerciseNotes: [],
      tips: [],
    };
  }

  // Analyze workout structure
  const muscles = Array.from(new Set(blocks.map(b => b.exercise.primaryMuscle)));
  const compoundCount = blocks.filter(b => b.exercise.mechanic === 'compound').length;
  const isolationCount = blocks.filter(b => b.exercise.mechanic === 'isolation').length;
  const totalSets = blocks.reduce((sum, b) => sum + b.targetSets, 0);

  // Determine workout type
  let workoutType = '';
  if (muscles.length >= 5) workoutType = 'Full Body';
  else if (muscles.includes('chest') && muscles.includes('back')) workoutType = 'Upper Body';
  else if (muscles.includes('quads') && muscles.includes('hamstrings')) workoutType = 'Lower Body';
  else if (muscles.includes('chest') && muscles.includes('shoulders') && muscles.includes('triceps')) workoutType = 'Push';
  else if (muscles.includes('back') && muscles.includes('biceps')) workoutType = 'Pull';
  else workoutType = muscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' & ');

  // Generate greeting based on time of day
  const hour = new Date().getHours();
  let timeGreeting = 'Hey';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  const greetings = [
    `${timeGreeting}! Ready to crush this ${workoutType} session? 💪`,
    `${timeGreeting}! Today's ${workoutType} workout is designed for maximum gains.`,
    `${timeGreeting}! Let's make this ${workoutType} session count!`,
  ];

  // Generate overview
  const overviews = [
    `Today you're hitting ${totalSets} total sets across ${blocks.length} exercises. ${compoundCount > 0 ? `Starting with ${compoundCount} compound movement${compoundCount > 1 ? 's' : ''} for strength and muscle activation, ` : ''}${isolationCount > 0 ? `then ${isolationCount} isolation exercise${isolationCount > 1 ? 's' : ''} to really target each muscle.` : ''}`,
    `This session includes ${compoundCount} compound and ${isolationCount} isolation exercises (${totalSets} sets total). The order is optimized—big movements first when you're fresh, then targeted work to maximize the pump.`,
  ];

  // Generate exercise-specific notes
  const exerciseNotes: { name: string; reason: string; weightRec?: WorkingWeightRecommendation }[] = [];
  
  blocks.forEach((block, idx) => {
    const ex = block.exercise;
    const repRange = block.targetRepRange;
    const isFirst = idx === 0;
    const isCompound = ex.mechanic === 'compound';
    
    let reason = '';
    
    if (isFirst && isCompound) {
      reason = `Leading with this compound to maximize neural drive while fresh. ${repRange[0]}-${repRange[1]} reps keeps intensity high for strength gains.`;
    } else if (isCompound) {
      reason = `Heavy compound for overall ${ex.primaryMuscle} development. Rep range of ${repRange[0]}-${repRange[1]} balances strength and hypertrophy.`;
    } else if (idx >= blocks.length - 2) {
      reason = `Finishing with isolation to fully fatigue the ${ex.primaryMuscle}. Higher reps (${repRange[0]}-${repRange[1]}) for metabolic stress and pump.`;
    } else {
      reason = `Targeted ${ex.primaryMuscle} work. ${repRange[0]}-${repRange[1]} reps optimized for muscle fiber type.`;
    }

    // Add specific notes based on muscle
    if (ex.primaryMuscle === 'calves') {
      reason += ' Calves are slow-twitch dominant—higher reps with controlled tempo work best.';
    } else if (ex.primaryMuscle === 'hamstrings') {
      reason += ' Hamstrings are fast-twitch dominant—heavier loads with full stretch.';
    }

    // Get weight recommendation if user profile available
    let weightRec: WorkingWeightRecommendation | undefined;
    if (userProfile && userProfile.weightKg > 0 && userProfile.heightCm > 0) {
      try {
        weightRec = quickWeightEstimate(
          ex.name,
          { min: repRange[0], max: repRange[1] },
          block.targetRir || 2,
          userProfile.weightKg,
          userProfile.heightCm,
          userProfile.bodyFatPercent || 20,
          userProfile.experience,
          userProfile.regionalData  // Pass regional data for personalized adjustments
        );
      } catch (e) {
        // Silently fail if weight estimation fails
      }
    }

    exerciseNotes.push({ name: ex.name, reason, weightRec });
  });

  // Generate tips
  const tips: string[] = [];
  
  if (compoundCount > 0) {
    tips.push('Take full rest (2-3 min) between compound sets to maintain strength.');
  }
  if (isolationCount > 0) {
    tips.push('Shorter rest (60-90 sec) for isolation work to keep metabolic stress high.');
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'back')) {
    tips.push('Focus on initiating pulls with your elbows, not your hands—better lat activation.');
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'chest')) {
    tips.push('Squeeze at the top of each rep and control the eccentric for chest exercises.');
  }
  tips.push('Log your RPE honestly—it helps the app optimize your future workouts.');

  return {
    greeting: greetings[Math.floor(Math.random() * greetings.length)],
    overview: overviews[Math.floor(Math.random() * overviews.length)],
    exerciseNotes,
    tips: tips.slice(0, 3), // Limit to 3 tips
  };
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const { preferences } = useUserPreferences();

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
  
  // Coach message state
  const [showCoachMessage, setShowCoachMessage] = useState(true);
  const [coachMessage, setCoachMessage] = useState<ReturnType<typeof generateCoachMessage> | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfileForWeights | null>(null);

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
        
        // Fetch user profile for weight estimation
        const { data: userData } = await supabase
          .from('users')
          .select('weight_kg, height_cm, experience, training_age')
          .eq('id', sessionData.user_id)
          .single();
        
        // Fetch latest DEXA scan for body fat and regional data if available
        const { data: dexaData } = await supabase
          .from('dexa_scans')
          .select('body_fat_percentage, regional_data')
          .eq('user_id', sessionData.user_id)
          .order('scan_date', { ascending: false })
          .limit(1)
          .single();
        
        const profile: UserProfileForWeights | undefined = userData ? {
          weightKg: userData.weight_kg || 70,
          heightCm: userData.height_cm || 175,
          bodyFatPercent: dexaData?.body_fat_percentage || 20,
          experience: (userData.experience as 'novice' | 'intermediate' | 'advanced') || 'intermediate',
          regionalData: dexaData?.regional_data as DexaRegionalData | undefined
        } : undefined;
        
        if (profile) {
          setUserProfile(profile);
        }
        
        // Generate coach message with profile for weight recommendations
        setCoachMessage(generateCoachMessage(transformedBlocks, profile));
        
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
    setError(null);
    
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
      console.log('Creating exercise block:', { sessionId, exerciseId: exercise.id, order: newOrder });
      
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

      console.log('Insert result:', { newBlock, blockError });

      if (blockError) {
        throw new Error(`Failed to create exercise block: ${blockError.message}`);
      }
      
      if (!newBlock) {
        throw new Error('No data returned after creating exercise block');
      }

      // Fetch full exercise data
      const { data: exerciseData, error: exerciseError } = await supabase
        .from('exercises')
        .select('*')
        .eq('id', exercise.id)
        .single();

      if (exerciseError || !exerciseData) {
        throw new Error(`Failed to fetch exercise data: ${exerciseError?.message || 'Not found'}`);
      }

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

      setBlocks(prevBlocks => [...prevBlocks, newBlockWithExercise]);
      setShowAddExercise(false);
      setExerciseSearch('');
      setSelectedMuscle('');
      
      // Navigate to the new exercise
      setCurrentBlockIndex(blocks.length);
    } catch (err) {
      console.error('Failed to add exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to add exercise');
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

  // Helper to get sets for a specific block
  const getSetsForBlock = (blockId: string) => completedSets.filter(s => s.exerciseBlockId === blockId);

  // Check if a block is complete
  const isBlockComplete = (block: ExerciseBlockWithExercise) => {
    const blockSets = getSetsForBlock(block.id);
    return blockSets.length >= block.targetSets;
  };

  // Calculate overall workout progress
  const totalPlannedSets = blocks.reduce((sum, b) => sum + b.targetSets, 0);
  const totalCompletedSets = completedSets.filter(s => !s.isWarmup).length;
  const overallProgress = totalPlannedSets > 0 ? (totalCompletedSets / totalPlannedSets) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      {/* Workout header */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-surface-950/95 backdrop-blur py-4 -mx-4 px-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout</h1>
          <p className="text-surface-400">
            {totalCompletedSets} of {totalPlannedSets} sets completed
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

      {/* Overall progress bar */}
      <div className="bg-surface-800 rounded-full h-2 overflow-hidden">
        <div
          className="bg-primary-500 h-full transition-all duration-300"
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {/* Coach Message */}
      {coachMessage && (
        <Card className="overflow-hidden border-primary-500/20 bg-gradient-to-br from-primary-500/5 to-surface-900">
          <button
            onClick={() => setShowCoachMessage(!showCoachMessage)}
            className="w-full p-4 flex items-center gap-3 text-left"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-purple-500 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🏋️</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-surface-100">Coach&apos;s Notes</p>
              <p className="text-sm text-surface-400 truncate">
                {showCoachMessage ? 'Tap to collapse' : coachMessage.greeting}
              </p>
            </div>
            <svg 
              className={`w-5 h-5 text-surface-400 transition-transform ${showCoachMessage ? 'rotate-180' : ''}`} 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {showCoachMessage && (
            <div className="px-4 pb-4 space-y-4">
              {/* Greeting & Overview */}
              <div className="pl-13 space-y-2">
                <p className="text-surface-200 font-medium">{coachMessage.greeting}</p>
                <p className="text-sm text-surface-400">{coachMessage.overview}</p>
              </div>

              {/* Exercise Breakdown */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider pl-13">
                  Exercise Breakdown
                </p>
                <div className="space-y-2">
                  {coachMessage.exerciseNotes.map((note, idx) => (
                    <div 
                      key={idx} 
                      className="p-3 rounded-lg bg-surface-800/50"
                    >
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full bg-surface-700 flex items-center justify-center flex-shrink-0 text-xs font-bold text-surface-400">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-surface-200">{note.name}</p>
                          <p className="text-xs text-surface-500 mt-1">{note.reason}</p>
                          
                          {/* Weight Recommendation */}
                          {note.weightRec && (
                            <div className="mt-2 p-2 rounded bg-surface-900/50 border border-surface-700">
                              {note.weightRec.confidence === 'find_working_weight' ? (
                                <div>
                                  <p className="text-xs font-medium text-warning-400 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Finding Weight Protocol
                                  </p>
                                  <p className="text-xs text-surface-400 mt-1">
                                    {note.weightRec.findingWeightProtocol?.instructions}
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-medium text-primary-400">
                                      💡 Recommended: {formatWeight(note.weightRec.recommendedWeight, preferences.units)}
                                    </p>
                                    <Badge 
                                      variant={note.weightRec.confidence === 'high' ? 'success' : note.weightRec.confidence === 'medium' ? 'info' : 'warning'} 
                                      size="sm"
                                    >
                                      {note.weightRec.confidence}
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-surface-500 mt-1">
                                    Range: {formatWeight(note.weightRec.weightRange.low, preferences.units)} - {formatWeight(note.weightRec.weightRange.high, preferences.units)}
                                  </p>
                                  <p className="text-xs text-surface-600 mt-0.5 italic">
                                    {note.weightRec.rationale}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tips */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-surface-500 uppercase tracking-wider pl-13">
                  Pro Tips
                </p>
                <div className="pl-13 space-y-1">
                  {coachMessage.tips.map((tip, idx) => (
                    <p key={idx} className="text-xs text-surface-400 flex gap-2">
                      <span className="text-primary-400">•</span>
                      {tip}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

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

      {/* All exercises list */}
      <div className="space-y-4">
        {blocks.map((block, index) => {
          const blockSets = getSetsForBlock(block.id);
          const isComplete = blockSets.length >= block.targetSets;
          const isCurrent = index === currentBlockIndex;
          const isPast = index < currentBlockIndex;
          const isFuture = index > currentBlockIndex;

          return (
            <div 
              key={block.id} 
              id={`exercise-${index}`}
              className={`transition-all duration-300 ${
                isCurrent ? '' : 'opacity-80'
              }`}
            >
              {/* Exercise header with status */}
              <div 
                className={`flex items-center gap-3 mb-2 cursor-pointer`}
                onClick={() => {
                  setCurrentBlockIndex(index);
                  setCurrentSetNumber(blockSets.length + 1);
                }}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                  isComplete 
                    ? 'bg-success-500/20 text-success-400' 
                    : isCurrent 
                      ? 'bg-primary-500 text-white' 
                      : 'bg-surface-800 text-surface-400'
                }`}>
                  {isComplete ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <div className="flex-1">
                  <p className={`font-medium ${isCurrent ? 'text-surface-100' : 'text-surface-300'}`}>
                    {block.exercise.name}
                  </p>
                  <p className="text-xs text-surface-500">
                    {blockSets.length}/{block.targetSets} sets • {block.targetRepRange[0]}-{block.targetRepRange[1]} reps
                  </p>
                </div>
                {isCurrent && (
                  <Badge variant="info" size="sm">Current</Badge>
                )}
                {isComplete && !isCurrent && (
                  <Badge variant="success" size="sm">Done</Badge>
                )}
              </div>

              {/* Expanded content for current exercise */}
              {isCurrent && (
                <div className="ml-11 space-y-4">
                  {/* Warmup protocol */}
                  {block.warmupProtocol && block.warmupProtocol.length > 0 && (
                    <WarmupProtocol
                      warmupSets={block.warmupProtocol}
                      workingWeight={block.targetWeightKg}
                      minIncrement={block.exercise.minWeightIncrementKg}
                    />
                  )}

                  {/* Exercise card */}
                  <ExerciseCard
                    exercise={block.exercise}
                    block={block}
                    sets={blockSets}
                    onSetEdit={handleSetEdit}
                    isActive
                    unit={preferences.units}
                  />

                  {/* Set input */}
                  {blockSets.length < block.targetSets && (
                    <SetInputRow
                      setNumber={blockSets.length + 1}
                      targetWeight={block.targetWeightKg}
                      targetRepRange={block.targetRepRange}
                      targetRir={block.targetRir}
                      previousSet={blockSets[blockSets.length - 1]}
                      isLastSet={blockSets.length + 1 === block.targetSets}
                      onSubmit={handleSetComplete}
                      unit={preferences.units}
                    />
                  )}

                  {/* Exercise complete actions */}
                  {isComplete && (
                    <div className="flex justify-center gap-3 py-4">
                      {index < blocks.length - 1 && (
                        <Button variant="secondary" onClick={handleNextExercise}>
                          Next Exercise →
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Collapsed preview for non-current exercises */}
              {!isCurrent && (
                <div 
                  className={`ml-11 p-3 rounded-lg cursor-pointer transition-colors ${
                    isComplete ? 'bg-success-500/5 border border-success-500/20' : 'bg-surface-800/30 hover:bg-surface-800/50'
                  }`}
                  onClick={() => {
                    setCurrentBlockIndex(index);
                    setCurrentSetNumber(blockSets.length + 1);
                  }}
                >
                  {isComplete ? (
                    <div className="flex items-center justify-between">
                      <div className="flex gap-3 flex-wrap">
                        {blockSets.map((set, setIdx) => (
                          <span key={set.id} className="text-xs text-surface-400">
                            Set {setIdx + 1}: {set.weightKg}kg × {set.reps}
                          </span>
                        ))}
                      </div>
                      <button className="text-xs text-primary-400 hover:text-primary-300">
                        Edit
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-surface-500">
                      <span className="text-sm">
                        {block.targetSets} sets × {block.targetRepRange[0]}-{block.targetRepRange[1]} reps
                        {block.targetWeightKg > 0 && ` @ ${block.targetWeightKg}kg`}
                      </span>
                      <span className="text-xs">Tap to start</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Finish workout button at bottom */}
      <Card className="text-center py-6 mt-8">
        <p className="text-surface-400 mb-4">
          {overallProgress >= 100 
            ? '🎉 All exercises complete!' 
            : `${Math.round(overallProgress)}% complete`}
        </p>
        <div className="flex justify-center gap-3">
          <Button variant="ghost" onClick={handleOpenAddExercise}>
            + Add Exercise
          </Button>
          <Button onClick={handleWorkoutComplete}>
            Finish Workout
          </Button>
        </div>
      </Card>

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
              
              {/* Error display */}
              {error && (
                <div className="mt-2 p-2 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-xs">
                  {error}
                </div>
              )}
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
