'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, Input, Select, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { MUSCLE_GROUPS } from '@/types/schema';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { getLocalDateString } from '@/lib/utils';

interface Exercise {
  id: string;
  name: string;
  primary_muscle: string;
  mechanic: 'compound' | 'isolation';
  hypertrophy_tier?: 'S' | 'A' | 'B' | 'C' | 'D' | 'F';
}

interface CustomExerciseForm {
  name: string;
  muscle: string;
  mechanic: 'compound' | 'isolation';
}

type Goal = 'bulk' | 'cut' | 'maintain';

/**
 * Get rest period based on exercise type and user's goal
 */
function getRestPeriod(isCompound: boolean, goal: Goal): number {
  if (goal === 'cut') {
    return isCompound ? 120 : 60;  // 2min / 1min
  }
  if (goal === 'bulk') {
    return isCompound ? 180 : 90;  // 3min / 1.5min
  }
  // maintain
  return isCompound ? 150 : 75;    // 2.5min / 1.25min
}

/**
 * Estimate time for an exercise including all sets and rest
 * Returns time in minutes
 */
function estimateExerciseTime(
  isCompound: boolean, 
  goal: Goal, 
  setsCount: number,
  includeWarmup: boolean
): number {
  const restSeconds = getRestPeriod(isCompound, goal);
  const setDuration = isCompound ? 50 : 35; // seconds per working set
  
  // Working sets time: (set duration + rest) * sets, minus rest after last set
  const workingTime = (setDuration + restSeconds) * setsCount - restSeconds;
  
  // Warmup time: typically 3 sets taking about 3-4 minutes total
  const warmupTime = includeWarmup && isCompound ? 4 * 60 : 0;
  
  // Transition time between exercises
  const transitionTime = 60; // 1 minute
  
  return (workingTime + warmupTime + transitionTime) / 60;
}

/**
 * Calculate how many exercises fit in a given time
 */
function getMaxExercisesForTime(
  durationMinutes: number, 
  goal: Goal
): { compounds: number; isolations: number; total: number } {
  // Average time per exercise type (with warmup for first compound per muscle)
  const compoundWithWarmup = estimateExerciseTime(true, goal, 3, true);
  const compoundNoWarmup = estimateExerciseTime(true, goal, 3, false);
  const isolation = estimateExerciseTime(false, goal, 3, false);
  
  // Typically 1-2 muscles trained, so 1-2 warmups
  // Estimate: 50% compounds, 50% isolations
  // First compound per muscle gets warmup
  
  // Average exercise time (accounting for mix)
  // Assume 1 warmup per 3 exercises on average
  const avgCompoundTime = (compoundWithWarmup + compoundNoWarmup * 2) / 3;
  const avgIsolationTime = isolation;
  
  // 60/40 compound/isolation split
  const avgExerciseTime = avgCompoundTime * 0.5 + avgIsolationTime * 0.5;
  
  const maxExercises = Math.floor(durationMinutes / avgExerciseTime);
  
  // Split between compounds and isolations
  const compounds = Math.ceil(maxExercises * 0.5);
  const isolations = maxExercises - compounds;
  
  return { 
    compounds: Math.max(1, compounds), 
    isolations: Math.max(0, isolations), 
    total: Math.max(1, maxExercises) 
  };
}

/**
 * Get time estimate range for display
 */
function getExerciseRangeForTime(durationMinutes: number): string {
  // Use 'maintain' as middle ground for estimation
  const estimate = getMaxExercisesForTime(durationMinutes, 'maintain');
  const min = Math.max(1, estimate.total - 1);
  const max = estimate.total + 1;
  return `${min}-${max}`;
}

function NewWorkoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const templateName = searchParams.get('template');
  const templateMuscles = searchParams.get('muscles');
  const aiMode = searchParams.get('ai') === 'true';
  
  const [step, setStep] = useState(templateMuscles ? 2 : 1); // Skip to step 2 if template
  const [selectedMuscles, setSelectedMuscles] = useState<string[]>(
    templateMuscles ? templateMuscles.split(',') : []
  );
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [frequentExerciseIds, setFrequentExerciseIds] = useState<Map<string, number>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<{ 
    muscles: string[]; 
    exercises: string[]; 
    reason: string;
    detailedExplanations?: Array<{ exerciseId: string; exerciseName: string; explanation: string }>;
    skippedMuscles?: Array<{ muscle: string; reason: string }>;
  } | null>(null);
  const [showExplanations, setShowExplanations] = useState(false);
  
  // Search filter for exercises
  const [exerciseSearch, setExerciseSearch] = useState('');
  
  // Workout duration
  const [workoutDuration, setWorkoutDuration] = useState(45); // Default 45 minutes
  
  // Custom exercise modal state
  const [showCustomExerciseModal, setShowCustomExerciseModal] = useState(false);
  const [customExerciseForm, setCustomExerciseForm] = useState<CustomExerciseForm>({
    name: '',
    muscle: '',
    mechanic: 'compound',
  });
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customExerciseError, setCustomExerciseError] = useState<string | null>(null);

  // Suggest exercises based on recent history, goals, AND time available
  const suggestExercises = async () => {
    setIsSuggesting(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // Get user's goal
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('goal')
        .eq('user_id', user.id)
        .single();
      
      const userGoal: Goal = (userProfile?.goal as Goal) || 'maintain';
      
      // Calculate how many exercises fit in the time
      const exerciseBudget = getMaxExercisesForTime(workoutDuration, userGoal);
      
      // Get recent workouts (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const { data: recentWorkouts } = await supabase
        .from('workout_sessions')
        .select(`
          id,
          exercise_blocks (
            exercises (
              primary_muscle,
              secondary_muscles
            )
          )
        `)
        .eq('user_id', user.id)
        .gte('completed_at', weekAgo.toISOString())
        .eq('state', 'completed');
      
      // Count trained muscles (accounting for compound exercises - secondary muscles get 0.5x credit)
      const trainedMuscles: Record<string, number> = {};
      recentWorkouts?.forEach((workout: { id: string; exercise_blocks: Array<{ exercises: { primary_muscle: string; secondary_muscles?: string[] } | null }> | null }) => {
        (workout.exercise_blocks || []).forEach((block) => {
          const primaryMuscle = block.exercises?.primary_muscle;
          const secondaryMuscles = block.exercises?.secondary_muscles || [];
          
          // Primary muscle: full credit (1.0x)
          if (primaryMuscle) {
            trainedMuscles[primaryMuscle] = (trainedMuscles[primaryMuscle] || 0) + 1;
          }
          
          // Secondary muscles: partial credit (0.5x) for compound exercises
          secondaryMuscles.forEach((secondaryMuscle: string) => {
            const secondaryMuscleLower = secondaryMuscle.toLowerCase();
            trainedMuscles[secondaryMuscleLower] = (trainedMuscles[secondaryMuscleLower] || 0) + 0.5;
          });
        });
      });
      
      // Find least trained muscles with improved prioritization
      const allMuscles = ['chest', 'back', 'shoulders', 'quads', 'hamstrings', 'biceps', 'triceps', 'glutes', 'calves', 'abs'];
      
      // Opposing muscle groups (antagonist pairs)
      const opposingMuscles: Record<string, string> = {
        'biceps': 'triceps',
        'triceps': 'biceps',
        'chest': 'back',
        'back': 'chest',
        'quads': 'hamstrings',
        'hamstrings': 'quads',
      };
      
      // Get recent workout dates to check recovery
      const muscleLastTrained: Record<string, Date | null> = {};
      recentWorkouts?.forEach((workout: any) => {
        const workoutDate = new Date(workout.completed_at);
        (workout.exercise_blocks || []).forEach((block: any) => {
          const primaryMuscle = block.exercises?.primary_muscle;
          if (primaryMuscle) {
            const existing = muscleLastTrained[primaryMuscle];
            if (!existing || workoutDate > existing) {
              muscleLastTrained[primaryMuscle] = workoutDate;
            }
          }
        });
      });
      
      // Sort muscles with improved logic:
      // 1. Prioritize completely untrained (0 sets) over partially trained
      // 2. Consider opposing muscle balance (don't suggest triceps if biceps are at 0)
      // 3. Consider recovery time (avoid muscles trained very recently)
      const sortedMuscles = allMuscles.sort((a, b) => {
        const aCount = trainedMuscles[a] || 0;
        const bCount = trainedMuscles[b] || 0;
        
        // Priority 1: Completely untrained (0 sets) beats partially trained
        if (aCount === 0 && bCount > 0) return -1;
        if (bCount === 0 && aCount > 0) return 1;
        
        // Priority 2: Check opposing muscle balance
        // If biceps are at 0 and we're comparing biceps vs triceps, prioritize biceps
        const aOpposing = opposingMuscles[a];
        const bOpposing = opposingMuscles[b];
        
        // If 'a' is the opposing muscle of 'b', and 'a' is untrained, prioritize 'a'
        if (aOpposing === b && aCount === 0 && bCount > 0) {
          return -1; // Prioritize untrained 'a' over trained 'b'
        }
        // If 'b' is the opposing muscle of 'a', and 'b' is untrained, prioritize 'b'
        if (bOpposing === a && bCount === 0 && aCount > 0) {
          return 1; // Prioritize untrained 'b' over trained 'a'
        }
        
        // Priority 3: Least trained overall
        if (aCount !== bCount) return aCount - bCount;
        
        // Priority 4: Prefer muscles not trained recently (better recovery)
        const aLastTrained = muscleLastTrained[a];
        const bLastTrained = muscleLastTrained[b];
        if (aLastTrained && bLastTrained) {
          return aLastTrained.getTime() - bLastTrained.getTime(); // Older = better
        }
        if (aLastTrained && !bLastTrained) return 1; // b hasn't been trained, prefer it
        if (!aLastTrained && bLastTrained) return -1; // a hasn't been trained, prefer it
        
        return 0;
      });
      
      // Pick muscles based on time available
      // Short workouts: 1-2 muscles, long workouts: 2-3 muscles
      const muscleCount = workoutDuration <= 30 ? 2 : workoutDuration <= 45 ? 2 : 3;
      const suggestedMuscles = sortedMuscles.slice(0, muscleCount);
      
      // Debug logging
      console.log('[Workout Suggestion] Muscle prioritization:', {
        trainedMuscles,
        sortedOrder: sortedMuscles.map(m => ({ muscle: m, count: trainedMuscles[m] || 0 })),
        suggestedMuscles,
      });
      
      // Track which muscles were skipped and why (for explanations)
      const skippedMuscles: Array<{ muscle: string; reason: string }> = [];
      const checkedMuscles = new Set(suggestedMuscles);
      
      // Check why other top candidates were skipped
      for (let i = 0; i < Math.min(muscleCount + 3, sortedMuscles.length); i++) {
        const muscle = sortedMuscles[i];
        if (checkedMuscles.has(muscle)) continue;
        
        const lastTrained = muscleLastTrained[muscle];
        if (lastTrained) {
          const daysSince = Math.floor((Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince < 2) {
            skippedMuscles.push({ 
              muscle, 
              reason: `Trained ${daysSince === 0 ? 'today' : `${daysSince} day${daysSince > 1 ? 's' : ''} ago`} - allowing recovery time` 
            });
          }
        }
      }
      
      // Fetch exercises for suggested muscles, including hypertrophy tier
      const { data: exercisesData } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, mechanic, hypertrophy_tier')
        .in('primary_muscle', suggestedMuscles)
        .order('name');
      
      // Sort by hypertrophy tier (S > A > B > C > D > F), then by mechanic
      const tierRank: Record<string, number> = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
      const sortedExercises = (exercisesData || []).sort((a: any, b: any) => {
        const tierA = tierRank[a.hypertrophy_tier || 'C'] ?? 3;
        const tierB = tierRank[b.hypertrophy_tier || 'C'] ?? 3;
        if (tierA !== tierB) return tierA - tierB;
        // Then compounds first
        const mechA = a.mechanic === 'compound' ? 0 : 1;
        const mechB = b.mechanic === 'compound' ? 0 : 1;
        return mechA - mechB;
      });
      
      // Pick exercises based on time budget
      const compounds = sortedExercises.filter((e: { mechanic: string }) => e.mechanic === 'compound');
      const isolations = sortedExercises.filter((e: { mechanic: string }) => e.mechanic === 'isolation');
      
      // Prioritize S and A tier for short workouts
      const tieredCompounds = workoutDuration <= 30 
        ? compounds.filter((e: any) => ['S', 'A'].includes(e.hypertrophy_tier))
        : compounds;
      const tieredIsolations = workoutDuration <= 30
        ? isolations.filter((e: any) => ['S', 'A'].includes(e.hypertrophy_tier))
        : isolations;
      
      // Use the fallback if not enough S/A tier exercises
      const finalCompounds = tieredCompounds.length >= exerciseBudget.compounds ? tieredCompounds : compounds;
      const finalIsolations = tieredIsolations.length >= exerciseBudget.isolations ? tieredIsolations : isolations;
      
      const picked = [
        ...finalCompounds.slice(0, exerciseBudget.compounds),
        ...finalIsolations.slice(0, exerciseBudget.isolations),
      ];
      
      // Calculate estimated time for the picked exercises
      let estimatedMinutes = 0;
      const warmupMuscles = new Set<string>();
      picked.forEach((e: any) => {
        const isCompound = e.mechanic === 'compound';
        const needsWarmup = isCompound && !warmupMuscles.has(e.primary_muscle);
        if (needsWarmup) warmupMuscles.add(e.primary_muscle);
        estimatedMinutes += estimateExerciseTime(isCompound, userGoal, 3, needsWarmup);
      });
      
      const reason = Object.keys(trainedMuscles).length === 0 
        ? `${picked.length} exercises for your ${workoutDuration}-minute workout (~${Math.round(estimatedMinutes)} min estimated).`
        : `${picked.length} exercises targeting ${suggestedMuscles.join(', ')} for your ${workoutDuration}-minute session (~${Math.round(estimatedMinutes)} min estimated).`;
      
      // Generate detailed explanations for each exercise
      const detailedExplanations = picked.map((exercise: any) => {
        const explanations: string[] = [];
        
        // Why this muscle group?
        const muscle = exercise.primary_muscle;
        const muscleTrainingCount = trainedMuscles[muscle] || 0;
        const opposingMuscle = opposingMuscles[muscle];
        
        if (muscleTrainingCount === 0) {
          explanations.push(`You haven't trained ${muscle} in the last 7 days`);
          // If opposing muscle is also untrained, mention balance
          if (opposingMuscle && (trainedMuscles[opposingMuscle] || 0) === 0) {
            explanations.push(`Balancing with ${opposingMuscle} (also untrained)`);
          }
        } else if (muscleTrainingCount < 1) {
          explanations.push(`${muscle} was only partially trained recently (via compound exercises)`);
        } else {
          explanations.push(`${muscle} needs more volume (trained ${Math.round(muscleTrainingCount)} time${Math.round(muscleTrainingCount) > 1 ? 's' : ''} in last 7 days)`);
        }
        
        // Recovery consideration
        const lastTrained = muscleLastTrained[muscle];
        if (lastTrained) {
          const daysSince = Math.floor((Date.now() - lastTrained.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSince >= 2) {
            explanations.push(`Adequate recovery time (last trained ${daysSince} days ago)`);
          }
        }
        
        // Why this specific exercise?
        if (exercise.hypertrophy_tier === 'S' || exercise.hypertrophy_tier === 'A') {
          explanations.push(`S-tier exercise for maximum hypertrophy`);
        } else if (exercise.hypertrophy_tier === 'B') {
          explanations.push(`High-quality B-tier exercise`);
        }
        
        if (exercise.mechanic === 'compound') {
          explanations.push(`Compound movement (trains multiple muscles efficiently)`);
        } else {
          explanations.push(`Isolation exercise (targeted muscle focus)`);
        }
        
        // Time consideration
        if (workoutDuration <= 30) {
          explanations.push(`Time-efficient for your ${workoutDuration}-minute workout`);
        }
        
        return {
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          explanation: explanations.join('. ') + '.'
        };
      });
      
      setSuggestions({
        muscles: suggestedMuscles,
        exercises: picked.map((e: { id: string }) => e.id),
        reason,
        detailedExplanations,
        skippedMuscles, // Add skipped muscles info for display
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

  // Auto-trigger AI suggestions when ai=true in URL
  useEffect(() => {
    if (aiMode && !suggestions && !isSuggesting) {
      suggestExercises();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiMode]);

  // Fetch frequently used exercises on mount
  useEffect(() => {
    const fetchFrequentExercises = async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get exercise usage counts from the last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data } = await supabase
        .from('exercise_blocks')
        .select(`
          exercise_id,
          workout_sessions!inner(user_id, started_at)
        `)
        .eq('workout_sessions.user_id', user.id)
        .gte('workout_sessions.started_at', ninetyDaysAgo.toISOString());

      if (data) {
        // Count occurrences of each exercise
        const counts = new Map<string, number>();
        data.forEach((block: { exercise_id: string }) => {
          const id = block.exercise_id;
          counts.set(id, (counts.get(id) || 0) + 1);
        });
        setFrequentExerciseIds(counts);
      }
    };
    fetchFrequentExercises();
  }, []);

  // Fetch exercises when muscles are selected
  useEffect(() => {
    if (step === 2 && selectedMuscles.length > 0) {
      const fetchExercises = async () => {
        setIsLoading(true);
        const supabase = createUntypedClient();
        const { data, error } = await supabase
          .from('exercises')
          .select('id, name, primary_muscle, mechanic, hypertrophy_tier')
          .in('primary_muscle', selectedMuscles)
          .order('name');

        if (data && !error) {
          // Sort: frequently used first, then by hypertrophy tier, then alphabetically
          const tierRank: Record<string, number> = { 'S': 0, 'A': 1, 'B': 2, 'C': 3, 'D': 4, 'F': 5 };
          const sorted = [...data].sort((a: any, b: any) => {
            const freqA = frequentExerciseIds.get(a.id) || 0;
            const freqB = frequentExerciseIds.get(b.id) || 0;
            
            // Frequently used exercises first (higher count = earlier)
            if (freqA !== freqB) return freqB - freqA;
            
            // Then by tier
            const tierA = tierRank[a.hypertrophy_tier || 'C'] ?? 3;
            const tierB = tierRank[b.hypertrophy_tier || 'C'] ?? 3;
            if (tierA !== tierB) return tierA - tierB;
            
            // Then alphabetically
            return (a.name || '').localeCompare(b.name || '');
          });
          setExercises(sorted);
        }
        setIsLoading(false);
      };
      fetchExercises();
    }
  }, [step, selectedMuscles, frequentExerciseIds]);

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

  const openCustomExerciseModal = (muscle: string) => {
    setCustomExerciseForm({ name: '', muscle, mechanic: 'compound' });
    setCustomExerciseError(null);
    setShowCustomExerciseModal(true);
  };

  const createCustomExercise = async () => {
    if (!customExerciseForm.name.trim()) {
      setCustomExerciseError('Please enter an exercise name');
      return;
    }

    setIsCreatingCustom(true);
    setCustomExerciseError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        setCustomExerciseError('You must be logged in');
        return;
      }

      // Create the custom exercise
      const { data: newExercise, error: createError } = await supabase
        .from('exercises')
        .insert({
          name: customExerciseForm.name.trim(),
          primary_muscle: customExerciseForm.muscle,
          mechanic: customExerciseForm.mechanic,
          movement_pattern: customExerciseForm.mechanic === 'compound' ? 'compound' : 'isolation',
          is_custom: true,
          created_by: user.id,
        })
        .select('id, name, primary_muscle, mechanic')
        .single();

      if (createError) {
        if (createError.code === '23505') {
          setCustomExerciseError('An exercise with this name already exists');
        } else {
          setCustomExerciseError('Failed to create exercise. Please try again.');
        }
        return;
      }

      if (newExercise) {
        // Add to exercises list
        setExercises(prev => [...prev, newExercise as Exercise]);
        // Auto-select the new exercise
        setSelectedExercises(prev => [...prev, newExercise.id]);
        // Close modal
        setShowCustomExerciseModal(false);
        setCustomExerciseForm({ name: '', muscle: '', mechanic: 'compound' });
      }
    } catch (err) {
      setCustomExerciseError('An error occurred. Please try again.');
    } finally {
      setIsCreatingCustom(false);
    }
  };

  const handleStartWorkout = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) throw new Error('You must be logged in');

      // Fetch user's goal from profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('goal')
        .eq('user_id', user.id)
        .single();
      
      const userGoal: Goal = (userProfile?.goal as Goal) || 'maintain';

      // Create workout session
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          user_id: user.id,
          state: 'planned',
          planned_date: getLocalDateString(),
          completion_percent: 0,
        })
        .select()
        .single();

      if (sessionError || !session) throw sessionError || new Error('Failed to create session');

      // Track which muscle groups have had warmups
      const warmedUpMuscles = new Set<string>();

      // Create exercise blocks with warmup protocols (only for first exercise per muscle group)
      const exerciseBlocks = selectedExercises.map((exerciseId, index) => {
        const exercise = exercises.find(e => e.id === exerciseId);
        const isCompound = exercise?.mechanic === 'compound';
        const muscleGroup = exercise?.primary_muscle || '';
        
        // Only generate warmup for first compound exercise of each muscle group
        const isFirstForMuscle = !warmedUpMuscles.has(muscleGroup);
        const shouldWarmup = isCompound && isFirstForMuscle;
        
        if (shouldWarmup && muscleGroup) {
          warmedUpMuscles.add(muscleGroup);
        }
        
        // Generate warmup for first compound exercise of each muscle group
        const warmupSets = shouldWarmup ? generateWarmupProtocol({
          workingWeight: 60, // Default starting weight, user can adjust
          exercise: {
            id: exerciseId,
            name: exercise?.name || '',
            primaryMuscle: muscleGroup,
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
          isFirstExercise: index === 0, // First exercise overall gets general warmup
        }) : [];

        // Scale sets based on workout duration
        // 60 min = full sets, 30 min = ~50%, 20 min = ~33%
        const timeModifier = Math.min(1.0, workoutDuration / 60);
        const baseSets = isCompound ? 4 : 3;
        const scaledSets = Math.max(2, Math.round(baseSets * timeModifier)); // Minimum 2 sets
        
        return {
          workout_session_id: session.id,
          exercise_id: exerciseId,
          order: index + 1,
          target_sets: scaledSets,
          target_rep_range: isCompound ? [6, 10] : [10, 15], // Lower reps for compounds
          target_rir: 2,
          target_weight_kg: 0, // Will be set during workout
          target_rest_seconds: getRestPeriod(isCompound, userGoal),
          suggestion_reason: 'Selected by user',
          warmup_protocol: { sets: warmupSets },
        };
      });

      const { error: blocksError } = await supabase
        .from('exercise_blocks')
        .insert(exerciseBlocks);

      if (blocksError) throw blocksError;

      // Navigate to the workout - skip loading screen on destination (already saw one)
      router.replace(`/dashboard/workout/${session.id}?fromCreate=true`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workout');
      setIsCreating(false);
    }
  };

  // Group exercises by muscle, filtered by search term
  const exercisesByMuscle = selectedMuscles.reduce((acc, muscle) => {
    const muscleExercises = exercises.filter((e) => e.primary_muscle === muscle);
    // Apply search filter if search term exists
    if (exerciseSearch.trim()) {
      const searchLower = exerciseSearch.toLowerCase().trim();
      acc[muscle] = muscleExercises.filter((e) => 
        e.name.toLowerCase().includes(searchLower)
      );
    } else {
      acc[muscle] = muscleExercises;
    }
    return acc;
  }, {} as Record<string, Exercise[]>);
  
  // Count total filtered exercises
  const totalFilteredExercises = Object.values(exercisesByMuscle).reduce(
    (sum, exs) => sum + exs.length, 0
  );

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
          {/* Time Selection */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                How much time do you have?
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {[20, 30, 45, 60, 75, 90].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => setWorkoutDuration(mins)}
                    className={`p-3 rounded-lg text-center transition-all ${
                      workoutDuration === mins
                        ? 'bg-primary-500/20 border-2 border-primary-500 text-primary-400'
                        : 'bg-surface-800 border-2 border-transparent text-surface-300 hover:bg-surface-700'
                    }`}
                  >
                    <div className="font-semibold">{mins}</div>
                    <div className="text-xs text-surface-500">min</div>
                  </button>
                ))}
              </div>
              <p className="text-xs text-surface-500 mt-2 text-center">
                {workoutDuration <= 25 
                  ? '⚡ Quick mode: Only S & A-tier exercises'
                  : workoutDuration <= 45 
                  ? '⏱️ Time-efficient: Focused on key compounds'
                  : '💪 Full workout: Complete volume for optimal growth'}
              </p>
            </CardContent>
          </Card>

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
          {/* Time-based recommendation */}
          <div className="p-3 bg-surface-800/50 border border-surface-700 rounded-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm text-surface-300">
                <strong>{workoutDuration} min</strong> workout
              </span>
            </div>
            <span className="text-sm text-surface-500">
              Recommended: <strong>{getExerciseRangeForTime(workoutDuration)}</strong> exercises
            </span>
          </div>
          
          {/* Warning if too many exercises selected */}
          {selectedExercises.length > 0 && (() => {
            const budget = getMaxExercisesForTime(workoutDuration, 'maintain');
            if (selectedExercises.length > budget.total + 1) {
              return (
                <div className="p-3 bg-warning-500/10 border border-warning-500/20 rounded-lg flex items-center gap-2">
                  <svg className="w-5 h-5 text-warning-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span className="text-sm text-warning-300">
                    {selectedExercises.length} exercises may exceed your {workoutDuration} min target. Consider removing {selectedExercises.length - budget.total} exercise{selectedExercises.length - budget.total > 1 ? 's' : ''}.
                  </span>
                </div>
              );
            }
            return null;
          })()}

          {/* Show AI suggestion reason */}
          {suggestions && (
            <div className="p-4 bg-accent-500/10 border border-accent-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-accent-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <div className="flex-1">
                  <p className="font-medium text-accent-300">AI Suggestion</p>
                  <p className="text-sm text-surface-400 mt-0.5">{suggestions.reason}</p>
                  
                  {/* Expandable detailed explanations */}
                  {suggestions.detailedExplanations && suggestions.detailedExplanations.length > 0 && (
                    <button
                      onClick={() => setShowExplanations(!showExplanations)}
                      className="mt-3 flex items-center gap-2 text-sm text-accent-400 hover:text-accent-300 transition-colors"
                    >
                      <svg 
                        className={`w-4 h-4 transition-transform ${showExplanations ? 'rotate-180' : ''}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                      {showExplanations ? 'Hide' : 'Show'} why these exercises were chosen
                    </button>
                  )}
                  
                  {showExplanations && (
                    <div className="mt-4 space-y-3 pt-3 border-t border-accent-500/20">
                      {/* Exercise explanations */}
                      {suggestions.detailedExplanations && suggestions.detailedExplanations.map((item) => {
                        const exercise = exercises.find(e => e.id === item.exerciseId);
                        if (!exercise) return null;
                        
                        return (
                          <div key={item.exerciseId} className="bg-surface-800/50 rounded-lg p-3">
                            <p className="font-medium text-surface-200 mb-1">{exercise.name}</p>
                            <p className="text-sm text-surface-400">{item.explanation}</p>
                          </div>
                        );
                      })}
                      
                      {/* Skipped muscles (recovery considerations) */}
                      {suggestions.skippedMuscles && suggestions.skippedMuscles.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-surface-700">
                          <p className="text-xs font-medium text-surface-500 uppercase mb-2">Muscles Skipped (Recovery)</p>
                          {suggestions.skippedMuscles.map((item, idx) => (
                            <div key={idx} className="text-sm text-surface-400 mb-1">
                              <span className="capitalize font-medium text-surface-300">{item.muscle}</span>: {item.reason}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          
          {/* Search bar */}
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="w-5 h-5 text-surface-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search exercises..."
              value={exerciseSearch}
              onChange={(e) => setExerciseSearch(e.target.value)}
              className="w-full pl-10 pr-10 py-3 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {exerciseSearch && (
              <button
                onClick={() => setExerciseSearch('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-surface-500 hover:text-surface-300"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          {/* Search results count */}
          {exerciseSearch && (
            <p className="text-sm text-surface-400">
              {totalFilteredExercises} exercise{totalFilteredExercises !== 1 ? 's' : ''} found
              {totalFilteredExercises === 0 && (
                <span className="ml-1">— try a different search or <button onClick={() => setExerciseSearch('')} className="text-primary-400 hover:underline">clear filter</button></span>
              )}
            </p>
          )}
          
          {isLoading ? (
            <Card>
              <CardContent className="py-8 flex flex-col items-center justify-center">
                <LoadingAnimation type="random" size="md" />
                <p className="text-surface-400 mt-3">Loading exercises...</p>
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
                      {exercisesByMuscle[muscle].map((exercise) => {
                        const usageCount = frequentExerciseIds.get(exercise.id) || 0;
                        const isFrequent = usageCount >= 2; // Show badge if used 2+ times
                        
                        return (
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
                              <div className="flex items-center gap-2">
                                <span className="text-surface-200">{exercise.name}</span>
                                {isFrequent && (
                                  <span className="text-xs text-amber-400" title={`Used ${usageCount} times recently`}>
                                    ★
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              {exercise.hypertrophy_tier && ['S', 'A'].includes(exercise.hypertrophy_tier) && (
                                <Badge 
                                  variant="success" 
                                  size="sm"
                                  className="font-semibold"
                                >
                                  {exercise.hypertrophy_tier}-tier
                                </Badge>
                              )}
                              <Badge variant={exercise.mechanic === 'compound' ? 'info' : 'default'} size="sm">
                                {exercise.mechanic}
                              </Badge>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-surface-500 text-center py-4">
                      No exercises found for this muscle group
                    </p>
                  )}
                  
                  {/* Add Custom Exercise Button */}
                  <button
                    onClick={() => openCustomExerciseModal(muscle)}
                    className="w-full mt-3 p-3 rounded-lg border-2 border-dashed border-surface-600 text-surface-400 hover:border-primary-500 hover:text-primary-400 transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add Custom Exercise
                  </button>
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
                  {selectedExercises.length > 0 && (() => {
                    // Calculate estimated time for selected exercises
                    let estimatedMinutes = 0;
                    const warmupMuscles = new Set<string>();
                    selectedExercises.forEach(exId => {
                      const ex = exercises.find(e => e.id === exId);
                      if (ex) {
                        const isCompound = ex.mechanic === 'compound';
                        const needsWarmup = isCompound && !warmupMuscles.has(ex.primary_muscle);
                        if (needsWarmup) warmupMuscles.add(ex.primary_muscle);
                        estimatedMinutes += estimateExerciseTime(isCompound, 'maintain', 3, needsWarmup);
                      }
                    });
                    const isOverTime = estimatedMinutes > workoutDuration + 5;
                    return (
                      <p className={`text-xs ${isOverTime ? 'text-warning-400' : 'text-surface-500'}`}>
                        ~{Math.round(estimatedMinutes)} min estimated
                        {isOverTime && ` (${Math.round(estimatedMinutes - workoutDuration)} min over)`}
                      </p>
                    );
                  })()}
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

      {/* Custom Exercise Modal */}
      {showCustomExerciseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-900 border border-surface-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-surface-100">Add Custom Exercise</h3>
              <button
                onClick={() => setShowCustomExerciseModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Exercise Name
                </label>
                <Input
                  value={customExerciseForm.name}
                  onChange={(e) => setCustomExerciseForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Cable Lateral Raise"
                  autoFocus
                />
              </div>

              <div>
                <Select
                  label="Muscle Group"
                  value={customExerciseForm.muscle}
                  onChange={(e) => setCustomExerciseForm(prev => ({ ...prev, muscle: e.target.value }))}
                  options={MUSCLE_GROUPS.map((muscle) => ({
                    value: muscle,
                    label: muscle.charAt(0).toUpperCase() + muscle.slice(1),
                  }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-1">
                  Exercise Type
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setCustomExerciseForm(prev => ({ ...prev, mechanic: 'compound' }))}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      customExerciseForm.mechanic === 'compound'
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-surface-600 text-surface-400 hover:border-surface-500'
                    }`}
                  >
                    <div className="font-medium">Compound</div>
                    <div className="text-xs opacity-70">Multi-joint movement</div>
                  </button>
                  <button
                    onClick={() => setCustomExerciseForm(prev => ({ ...prev, mechanic: 'isolation' }))}
                    className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                      customExerciseForm.mechanic === 'isolation'
                        ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                        : 'border-surface-600 text-surface-400 hover:border-surface-500'
                    }`}
                  >
                    <div className="font-medium">Isolation</div>
                    <div className="text-xs opacity-70">Single-joint movement</div>
                  </button>
                </div>
              </div>

              {customExerciseError && (
                <div className="p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-sm">
                  {customExerciseError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => setShowCustomExerciseModal(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={createCustomExercise}
                  isLoading={isCreatingCustom}
                  disabled={!customExerciseForm.name.trim()}
                  className="flex-1"
                >
                  Add Exercise
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NewWorkoutPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Setting up your workout...</p>
      </div>
    }>
      <NewWorkoutContent />
    </Suspense>
  );
}
