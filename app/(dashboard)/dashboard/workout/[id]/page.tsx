'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, Button, Badge, Input } from '@/components/ui';
import { ExerciseCard, RestTimer, WarmupProtocol, ReadinessCheckIn, SessionSummary } from '@/components/workout';
import type { Exercise, ExerciseBlock, SetLog, WorkoutSession, WeightUnit, DexaRegionalData } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { MUSCLE_GROUPS } from '@/types/schema';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { quickWeightEstimate, quickWeightEstimateWithCalibration, type WorkingWeightRecommendation } from '@/services/weightEstimationEngine';
import { formatWeight } from '@/lib/utils';

type WorkoutPhase = 'loading' | 'checkin' | 'workout' | 'summary' | 'error';

interface ExerciseBlockWithExercise extends ExerciseBlock {
  exercise: Exercise;
}

interface AvailableExercise {
  id: string;
  name: string;
  primary_muscle: string;
  secondary_muscles?: string[];
  mechanic: 'compound' | 'isolation';
}

interface CalibratedLift {
  lift_name: string;
  estimated_1rm: number;
  tested_at: string;
}

interface UserProfileForWeights {
  weightKg: number;
  heightCm: number;
  bodyFatPercent: number;
  experience: 'novice' | 'intermediate' | 'advanced';
  regionalData?: DexaRegionalData;
  calibratedLifts?: CalibratedLift[];
}

interface UserContext {
  goal?: 'bulk' | 'cut' | 'recomp' | 'maintain';
  laggingAreas?: string[];  // From regional DEXA analysis
  recentPlateaus?: string[];  // Exercise names with recent plateaus
  weekInMesocycle?: number;
  mesocycleName?: string;
}

interface ExerciseHistoryData {
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

// Generate coach message based on workout structure and user context
function generateCoachMessage(
  blocks: ExerciseBlockWithExercise[],
  userProfile?: UserProfileForWeights,
  userContext?: UserContext,
  unit: 'kg' | 'lb' = 'kg'
): {
  greeting: string;
  overview: string;
  personalizedInsight?: string;
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

  // Generate greeting based on time of day and goal
  const hour = new Date().getHours();
  let timeGreeting = 'Hey';
  if (hour < 12) timeGreeting = 'Good morning';
  else if (hour < 17) timeGreeting = 'Good afternoon';
  else timeGreeting = 'Good evening';

  // Personalize greeting based on goal
  let goalPhrase = '';
  if (userContext?.goal === 'bulk') {
    goalPhrase = 'Time to build! 💪';
  } else if (userContext?.goal === 'cut') {
    goalPhrase = 'Stay strong in your cut! 🔥';
  } else if (userContext?.goal === 'recomp') {
    goalPhrase = 'Building while leaning out! 💎';
  }

  const greetings = goalPhrase
    ? [`${timeGreeting}! ${goalPhrase} Today's ${workoutType} workout is ready.`]
    : [
        `${timeGreeting}! Ready to crush this ${workoutType} session? 💪`,
        `${timeGreeting}! Today's ${workoutType} workout is designed for maximum gains.`,
        `${timeGreeting}! Let's make this ${workoutType} session count!`,
      ];

  // Generate personalized insight based on context
  let personalizedInsight: string | undefined;
  const insights: string[] = [];

  // Goal-specific insights
  if (userContext?.goal === 'bulk') {
    insights.push(`Since you're bulking, prioritize progressive overload—try to add a rep or small weight increase today.`);
    if (totalSets > 20) {
      insights.push(`High volume today (${totalSets} sets) is perfect for your bulk. Make sure you're eating enough to recover!`);
    }
  } else if (userContext?.goal === 'cut') {
    insights.push(`During your cut, maintaining intensity is key to preserving muscle. Don't drop the weight—keep it heavy, just manage volume.`);
    if (compoundCount > 2) {
      insights.push(`The compound focus helps maintain strength while in a deficit. If energy is low, prioritize these over isolation work.`);
    }
  }

  // Lagging area insights
  if (userContext?.laggingAreas && userContext.laggingAreas.length > 0) {
    const laggingMusclesInWorkout = userContext.laggingAreas.filter(area => {
      const areaLower = area.toLowerCase();
      return muscles.some(m => {
        if (areaLower.includes('arm')) return m === 'biceps' || m === 'triceps';
        if (areaLower.includes('leg')) return m === 'quads' || m === 'hamstrings' || m === 'glutes' || m === 'calves';
        if (areaLower.includes('trunk')) return m === 'chest' || m === 'back' || m === 'shoulders';
        return areaLower.includes(m);
      });
    });
    
    if (laggingMusclesInWorkout.length > 0) {
      insights.push(`📊 Your DEXA showed ${laggingMusclesInWorkout.join(', ')} as areas to bring up. Focus on mind-muscle connection and full ROM on those exercises today.`);
    }
  }

  // Plateau insights
  if (userContext?.recentPlateaus && userContext.recentPlateaus.length > 0) {
    const plateauExercisesInWorkout = userContext.recentPlateaus.filter(ex => 
      blocks.some(b => b.exercise.name.toLowerCase().includes(ex.toLowerCase()))
    );
    
    if (plateauExercisesInWorkout.length > 0) {
      insights.push(`⚠️ You've hit a plateau on ${plateauExercisesInWorkout.join(', ')}. Today, try a slightly different rep range or tempo to break through.`);
    }
  }

  // Week in mesocycle insights
  if (userContext?.weekInMesocycle) {
    if (userContext.weekInMesocycle === 1) {
      insights.push(`Week 1 of your ${userContext.mesocycleName || 'mesocycle'}—find your working weights and focus on form. Leave 2-3 reps in reserve.`);
    } else if (userContext.weekInMesocycle >= 4) {
      insights.push(`Week ${userContext.weekInMesocycle}—you should be approaching peak intensity. Push close to failure on your last sets!`);
    }
  }

  // Combine insights
  if (insights.length > 0) {
    personalizedInsight = insights.slice(0, 2).join(' ');  // Max 2 insights to avoid overwhelm
  }

  // Generate overview
  let overviewBase = `${totalSets} total sets across ${blocks.length} exercises. `;
  if (compoundCount > 0) {
    overviewBase += `Starting with ${compoundCount} compound movement${compoundCount > 1 ? 's' : ''} for strength, `;
  }
  if (isolationCount > 0) {
    overviewBase += `then ${isolationCount} isolation exercise${isolationCount > 1 ? 's' : ''} for targeted work.`;
  }

  const overviews = [overviewBase];

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
        // Use calibration data if available for more accurate estimates
        if (userProfile.calibratedLifts && userProfile.calibratedLifts.length > 0) {
          weightRec = quickWeightEstimateWithCalibration(
            ex.name,
            { min: repRange[0], max: repRange[1] },
            block.targetRir || 2,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent || 20,
            userProfile.experience,
            userProfile.calibratedLifts,
            userProfile.regionalData,
            unit
          );
        } else {
          weightRec = quickWeightEstimate(
            ex.name,
            { min: repRange[0], max: repRange[1] },
            block.targetRir || 2,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent || 20,
            userProfile.experience,
            userProfile.regionalData,
            unit
          );
        }
      } catch (e) {
        // Silently fail if weight estimation fails
      }
    }

    exerciseNotes.push({ name: ex.name, reason, weightRec });
  });

  // Generate tips based on goal and workout
  const tips: string[] = [];
  
  // Goal-specific tips
  if (userContext?.goal === 'cut') {
    tips.push('💡 In a cut: Keep intensity high but listen to your body. Lower energy is normal—prioritize compounds if needed.');
  } else if (userContext?.goal === 'bulk') {
    tips.push('💡 In a bulk: Push for progressive overload—even one extra rep counts toward gains!');
  }
  
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
  if (blocks.some(b => b.exercise.primaryMuscle === 'biceps' || b.exercise.primaryMuscle === 'triceps')) {
    if (userContext?.laggingAreas?.some(a => a.toLowerCase().includes('arm'))) {
      tips.push('🎯 Arms are a focus area—slow eccentrics (3 sec) boost time under tension for growth.');
    }
  }
  if (blocks.some(b => b.exercise.primaryMuscle === 'quads' || b.exercise.primaryMuscle === 'hamstrings')) {
    if (userContext?.laggingAreas?.some(a => a.toLowerCase().includes('leg'))) {
      tips.push('🎯 Legs are a focus area—full depth and controlled negatives maximize stimulus.');
    }
  }
  tips.push('Log your RPE honestly—it helps the app optimize your future workouts.');

  return {
    greeting: greetings[Math.floor(Math.random() * greetings.length)],
    overview: overviews[0],  // Use the personalized overview
    personalizedInsight,
    exerciseNotes,
    tips: tips.slice(0, 4), // Limit to 4 tips
  };
}

export default function WorkoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;
  const { preferences, updatePreference } = useUserPreferences();

  const [phase, setPhase] = useState<WorkoutPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlockWithExercise[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState<SetLog[]>([]);
  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistoryData>>({});
  
  // Add exercise modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<AvailableExercise[]>([]);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('');
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  
  // Custom exercise creation state
  const [showCustomExercise, setShowCustomExercise] = useState(false);
  const [customExerciseName, setCustomExerciseName] = useState('');
  const [customExerciseMuscle, setCustomExerciseMuscle] = useState('chest');
  const [customExerciseMechanic, setCustomExerciseMechanic] = useState<'compound' | 'isolation'>('compound');
  const [isCreatingExercise, setIsCreatingExercise] = useState(false);
  
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
        
        // Fetch existing sets for this workout (important for viewing completed workouts or resuming)
        const blockIds = transformedBlocks.map((b: ExerciseBlockWithExercise) => b.id);
        if (blockIds.length > 0) {
          const { data: existingSets } = await supabase
            .from('set_logs')
            .select('*')
            .in('exercise_block_id', blockIds)
            .order('set_number');
          
          if (existingSets && existingSets.length > 0) {
            const transformedSets: SetLog[] = existingSets.map((set: any) => ({
              id: set.id,
              exerciseBlockId: set.exercise_block_id,
              setNumber: set.set_number,
              weightKg: set.weight_kg,
              reps: set.reps,
              rpe: set.rpe,
              restSeconds: set.rest_seconds,
              isWarmup: set.is_warmup,
              quality: set.quality,
              qualityReason: set.quality_reason || '',
              note: set.note,
              loggedAt: set.logged_at,
            }));
            setCompletedSets(transformedSets);
            
            // Set current set number based on existing sets for the first incomplete block
            const firstIncompleteBlock = transformedBlocks.find((block: ExerciseBlockWithExercise) => {
              const blockSets = transformedSets.filter(s => s.exerciseBlockId === block.id && !s.isWarmup);
              return blockSets.length < block.targetSets;
            });
            
            if (firstIncompleteBlock) {
              const blockIdx = transformedBlocks.findIndex((b: ExerciseBlockWithExercise) => b.id === firstIncompleteBlock.id);
              const existingBlockSets = transformedSets.filter(s => s.exerciseBlockId === firstIncompleteBlock.id && !s.isWarmup);
              setCurrentBlockIndex(blockIdx);
              setCurrentSetNumber(existingBlockSets.length + 1);
            }
          }
        }
        
        // Fetch user profile for weight estimation
        const { data: userData } = await supabase
          .from('users')
          .select('weight_kg, height_cm, experience, training_age, goal')
          .eq('id', sessionData.user_id)
          .single();
        
        // Fetch latest DEXA scan for body fat and regional data if available
        const { data: dexaData } = await supabase
          .from('dexa_scans')
          .select('body_fat_percentage, regional_data, lean_mass_kg')
          .eq('user_id', sessionData.user_id)
          .order('scan_date', { ascending: false })
          .limit(1)
          .single();
        
        // Fetch calibrated lifts for weight estimation
        const { data: calibratedLifts } = await supabase
          .from('calibrated_lifts')
          .select('lift_name, estimated_1rm, tested_at')
          .eq('user_id', sessionData.user_id)
          .order('tested_at', { ascending: false });
        
        // Fetch mesocycle info if this workout is part of one
        const { data: mesocycleData } = await supabase
          .from('mesocycles')
          .select('name, start_date, weeks')
          .eq('user_id', sessionData.user_id)
          .eq('is_active', true)
          .single();
        
        const profile: UserProfileForWeights | undefined = userData ? {
          weightKg: userData.weight_kg || 70,
          heightCm: userData.height_cm || 175,
          bodyFatPercent: dexaData?.body_fat_percentage || 20,
          experience: (userData.experience as 'novice' | 'intermediate' | 'advanced') || 'intermediate',
          regionalData: dexaData?.regional_data as DexaRegionalData | undefined,
          calibratedLifts: calibratedLifts as CalibratedLift[] | undefined,
        } : undefined;
        
        if (profile) {
          setUserProfile(profile);
        }
        
        // Build user context for personalized coaching
        const userContext: UserContext = {
          goal: userData?.goal as UserContext['goal'] || undefined,
        };
        
        // Analyze regional data for lagging areas
        if (dexaData?.regional_data && dexaData?.lean_mass_kg && userData?.height_cm) {
          try {
            const { analyzeRegionalComposition } = await import('@/services/regionalAnalysis');
            const regionalAnalysis = analyzeRegionalComposition(
              dexaData.regional_data as DexaRegionalData,
              dexaData.lean_mass_kg
            );
            userContext.laggingAreas = regionalAnalysis.laggingAreas;
          } catch (e) {
            // Regional analysis optional
          }
        }
        
        // Add mesocycle context
        if (mesocycleData) {
          userContext.mesocycleName = mesocycleData.name;
          const startDate = new Date(mesocycleData.start_date);
          const now = new Date();
          const weeksSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
          userContext.weekInMesocycle = Math.min(weeksSinceStart, mesocycleData.weeks);
        }
        
        // Generate coach message with profile and context
        setCoachMessage(generateCoachMessage(transformedBlocks, profile, userContext));
        
        // Fetch exercise history for all exercises in this workout
        const exerciseIds = transformedBlocks.map((b: ExerciseBlockWithExercise) => b.exerciseId);
        if (exerciseIds.length > 0) {
          const histories: Record<string, ExerciseHistoryData> = {};
          
          for (const exerciseId of exerciseIds) {
            try {
              // Get all completed workout blocks for this exercise
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
                .eq('workout_sessions.user_id', sessionData.user_id)
                .eq('workout_sessions.state', 'completed')
                .order('workout_sessions(completed_at)', { ascending: false })
                .limit(20);
              
              if (historyBlocks && historyBlocks.length > 0) {
                let bestE1RM = 0;
                let personalRecord: ExerciseHistoryData['personalRecord'] = null;
                let totalSessions = 0;
                const seenSessions = new Set<string>();
                
                // Get last workout data
                const lastBlock = historyBlocks[0];
                const lastSession = lastBlock.workout_sessions as any;
                const lastSets = ((lastBlock.set_logs as any[]) || [])
                  .filter((s: any) => !s.is_warmup)
                  .map((s: any) => ({
                    weightKg: s.weight_kg,
                    reps: s.reps,
                    rpe: s.rpe,
                  }));
                
                // Calculate best E1RM and PR
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
                
                histories[exerciseId] = {
                  lastWorkoutDate: lastSession?.completed_at || '',
                  lastWorkoutSets: lastSets,
                  estimatedE1RM: bestE1RM,
                  personalRecord,
                  totalSessions,
                };
              }
            } catch (histErr) {
              console.error('Failed to fetch history for exercise:', exerciseId, histErr);
            }
          }
          
          setExerciseHistories(histories);
        }
        
        // Set phase based on workout state
        if (sessionData.state === 'completed') {
          setPhase('summary');  // Show summary for completed workouts (read-only)
        } else if (sessionData.state === 'in_progress') {
          setPhase('workout');
        } else {
          // Check if user wants to skip pre-workout check-in
          if (preferences.skipPreWorkoutCheckIn) {
            // Skip check-in, go directly to workout
            const supabase = createUntypedClient();
            await supabase
              .from('workout_sessions')
              .update({
                state: 'in_progress',
                started_at: new Date().toISOString(),
              })
              .eq('id', sessionId);
            setPhase('workout');
          } else {
            setPhase('checkin');
          }
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

  const handleSkipCheckInPermanently = async () => {
    // Save preference to skip check-ins in the future
    await updatePreference('skipPreWorkoutCheckIn', true);
    // Then complete the check-in for this workout
    await handleCheckInComplete();
  };

  const handleSetComplete = async (data: { weightKg: number; reps: number; rpe: number; note?: string }) => {
    if (!currentBlock) return;

    const quality = data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective';
    const loggedAt = new Date().toISOString();

    // Save to database first - let DB generate the UUID
    try {
      const supabase = createUntypedClient();
      const { data: insertedData, error: insertError } = await supabase
        .from('set_logs')
        .insert({
          exercise_block_id: currentBlock.id,
          set_number: currentSetNumber,
          weight_kg: data.weightKg,
          reps: data.reps,
          rpe: data.rpe,
          is_warmup: false,
          quality: quality,
          quality_reason: '',
          note: data.note || null,
          logged_at: loggedAt,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error('Failed to save set:', insertError);
        setError(`Failed to save set: ${insertError.message}`);
        return; // Don't add to local state if save failed
      }
      
      // Create the set object with the database-generated ID
      const newSet: SetLog = {
        id: insertedData.id,
        exerciseBlockId: currentBlock.id,
        setNumber: currentSetNumber,
        weightKg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        restSeconds: null,
        isWarmup: false,
        quality: quality,
        qualityReason: '',
        note: data.note || null,
        loggedAt: loggedAt,
      };
      
      // Update local state
      setCompletedSets([...completedSets, newSet]);
      setCurrentSetNumber(currentSetNumber + 1);
      setShowRestTimer(true);
      setError(null);
    } catch (err) {
      console.error('Failed to save set:', err);
      setError(err instanceof Error ? err.message : 'Failed to save set - please try again');
    }
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
      const { error: updateError } = await supabase.from('set_logs').update({
        weight_kg: data.weightKg,
        reps: data.reps,
        rpe: data.rpe,
        quality: data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective',
      }).eq('id', setId);
      
      if (updateError) {
        console.error('Failed to update set:', updateError);
        setError(`Failed to update set: ${updateError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to update set:', err);
      setError(err instanceof Error ? err.message : 'Failed to update set');
    }
  };

  const handleDeleteSet = async (setId: string) => {
    // Remove from local state
    const setToDelete = completedSets.find(s => s.id === setId);
    if (!setToDelete) return;
    
    setCompletedSets(completedSets.filter(set => set.id !== setId));
    
    // Renumber remaining sets for the same block
    const blockSets = completedSets.filter(s => s.exerciseBlockId === setToDelete.exerciseBlockId && s.id !== setId);
    blockSets.forEach((set, idx) => {
      set.setNumber = idx + 1;
    });
    
    // Delete from database
    try {
      const supabase = createUntypedClient();
      const { error: deleteError } = await supabase.from('set_logs').delete().eq('id', setId);
      
      if (deleteError) {
        console.error('Failed to delete set:', deleteError);
        setError(`Failed to delete set: ${deleteError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to delete set:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete set');
    }
  };

  // State for adding extra sets beyond target
  const [addingExtraSet, setAddingExtraSet] = useState<string | null>(null);

  // Handle changing target sets for an exercise
  const handleTargetSetsChange = async (blockId: string, newTargetSets: number) => {
    // Update local state immediately
    setBlocks(prevBlocks => prevBlocks.map(block => 
      block.id === blockId 
        ? { ...block, targetSets: newTargetSets }
        : block
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ target_sets: newTargetSets })
        .eq('id', blockId);
      
      if (updateError) {
        console.error('Failed to update target sets:', updateError);
        setError(`Failed to update sets: ${updateError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to update target sets:', err);
      setError(err instanceof Error ? err.message : 'Failed to update sets');
    }
  };

  const handleExerciseSwap = async (blockId: string, newExercise: Exercise) => {
    // Update local state immediately
    setBlocks(prevBlocks => prevBlocks.map(block => 
      block.id === blockId 
        ? { ...block, exerciseId: newExercise.id, exercise: newExercise }
        : block
    ));

    // Update in database
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase
        .from('exercise_blocks')
        .update({ exercise_id: newExercise.id })
        .eq('id', blockId);
      
      if (updateError) {
        console.error('Failed to swap exercise:', updateError);
        setError(`Failed to swap exercise: ${updateError.message}`);
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to swap exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to swap exercise');
    }
  };

  // Handle deleting an exercise from the workout
  const handleExerciseDelete = async (blockId: string) => {
    try {
      const supabase = createUntypedClient();
      
      // First delete any set logs for this block
      const { error: setsError } = await supabase
        .from('set_logs')
        .delete()
        .eq('exercise_block_id', blockId);
      
      if (setsError) {
        console.error('Failed to delete set logs:', setsError);
      }
      
      // Then delete the exercise block
      const { error: blockError } = await supabase
        .from('exercise_blocks')
        .delete()
        .eq('id', blockId);
      
      if (blockError) {
        console.error('Failed to delete exercise block:', blockError);
        setError(`Failed to delete exercise: ${blockError.message}`);
        return;
      }
      
      // Update local state - remove the block and update set logs
      setBlocks(prevBlocks => {
        const newBlocks = prevBlocks.filter(b => b.id !== blockId);
        // Adjust current block index if needed
        if (currentBlockIndex >= newBlocks.length) {
          setCurrentBlockIndex(Math.max(0, newBlocks.length - 1));
        }
        return newBlocks;
      });
      
      setCompletedSets(prevSets => prevSets.filter(s => s.exerciseBlockId !== blockId));
      setError(null);
      
    } catch (err) {
      console.error('Failed to delete exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete exercise');
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
      
      // Get weight recommendation for the new exercise
      let suggestedWeight = 0;
      if (userProfile) {
        const repRange = isCompound ? { min: 6, max: 10 } : { min: 10, max: 15 };
        const targetRir = 2;
        let weightRec: WorkingWeightRecommendation;
        
        // Use calibration data if available
        if (userProfile.calibratedLifts && userProfile.calibratedLifts.length > 0) {
          weightRec = quickWeightEstimateWithCalibration(
            exercise.name,
            repRange,
            targetRir,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent,
            userProfile.experience,
            userProfile.calibratedLifts,
            userProfile.regionalData,
            preferences.units
          );
        } else {
          weightRec = quickWeightEstimate(
            exercise.name,
            repRange,
            targetRir,
            userProfile.weightKg,
            userProfile.heightCm,
            userProfile.bodyFatPercent,
            userProfile.experience,
            userProfile.regionalData,
            preferences.units
          );
        }
        
        if (weightRec.confidence !== 'find_working_weight') {
          suggestedWeight = weightRec.recommendedWeight;
        }
      }
      
      // Check if this is the first exercise for this muscle group in the workout
      const muscleAlreadyWarmedUp = blocks.some(
        block => block.exercise.primaryMuscle === exercise.primary_muscle
      );
      
      // Only generate warmup for first compound exercise of each muscle group
      const shouldWarmup = isCompound && !muscleAlreadyWarmedUp;
      const workingWeight = suggestedWeight > 0 ? suggestedWeight : 60;
      const warmupSets = shouldWarmup ? generateWarmupProtocol({
        workingWeight,
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
        isFirstExercise: blocks.length === 0, // First exercise overall gets general warmup
      }) : [];

      // Create new exercise block with suggested weight
      const newOrder = blocks.length + 1;
      console.log('Creating exercise block:', { sessionId, exerciseId: exercise.id, order: newOrder, suggestedWeight });
      
      const { data: newBlock, error: blockError } = await supabase
        .from('exercise_blocks')
        .insert({
          workout_session_id: sessionId,
          exercise_id: exercise.id,
          order: newOrder,
          target_sets: isCompound ? 4 : 3,
          target_rep_range: isCompound ? [6, 10] : [10, 15],
          target_rir: 2,
          target_weight_kg: suggestedWeight,
          target_rest_seconds: isCompound ? 180 : 90,
          suggestion_reason: suggestedWeight > 0 ? `Added mid-workout • Suggested ${formatWeight(suggestedWeight, preferences.units)}` : 'Added mid-workout',
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

      // Add to blocks state with suggested weight
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
        targetWeightKg: suggestedWeight,  // Use the calculated suggested weight
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

  // Create custom exercise and add to workout
  const handleCreateCustomExercise = async () => {
    if (!customExerciseName.trim()) {
      setError('Please enter an exercise name');
      return;
    }

    setIsCreatingExercise(true);
    setError(null);

    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create the custom exercise
      const { data: newExercise, error: createError } = await supabase
        .from('exercises')
        .insert({
          name: customExerciseName.trim(),
          primary_muscle: customExerciseMuscle,
          secondary_muscles: [],
          mechanic: customExerciseMechanic,
          default_rep_range: customExerciseMechanic === 'compound' ? [6, 10] : [10, 15],
          default_rir: 2,
          min_weight_increment_kg: 2.5,
          form_cues: [],
          common_mistakes: [],
          setup_note: '',
          movement_pattern: customExerciseMechanic === 'compound' ? 'compound' : 'isolation',
          equipment_required: [],
          is_custom: true,
          created_by: user.id,
        })
        .select()
        .single();

      if (createError || !newExercise) {
        throw new Error(createError?.message || 'Failed to create exercise');
      }

      // Add it to the available exercises list
      setAvailableExercises(prev => [...prev, {
        id: newExercise.id,
        name: newExercise.name,
        primary_muscle: newExercise.primary_muscle,
        secondary_muscles: newExercise.secondary_muscles || [],
        mechanic: newExercise.mechanic,
      }]);

      // Now add it to the workout
      await handleAddExercise({
        id: newExercise.id,
        name: newExercise.name,
        primary_muscle: newExercise.primary_muscle,
        secondary_muscles: newExercise.secondary_muscles || [],
        mechanic: newExercise.mechanic,
      });

      // Reset custom exercise form
      setShowCustomExercise(false);
      setCustomExerciseName('');
      setCustomExerciseMuscle('chest');
      setCustomExerciseMechanic('compound');
    } catch (err) {
      console.error('Failed to create custom exercise:', err);
      setError(err instanceof Error ? err.message : 'Failed to create exercise');
    } finally {
      setIsCreatingExercise(false);
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
          onSkipPermanently={handleSkipCheckInPermanently}
        />
      </div>
    );
  }

  if (phase === 'summary' && session) {
    // Check if this is a previously completed workout (viewing from history)
    const isViewingCompleted = session.state === 'completed' && !!session.completedAt;
    
    return (
      <div className="py-8">
        <SessionSummary
          session={isViewingCompleted ? session : {
            ...session,
            state: 'completed',
            completedAt: new Date().toISOString(),
          }}
          exerciseBlocks={blocks}
          allSets={completedSets}
          onSubmit={isViewingCompleted ? undefined : handleSummarySubmit}
          readOnly={isViewingCompleted}
        />
        {isViewingCompleted && (
          <div className="mt-6 text-center">
            <Button variant="outline" onClick={() => router.push('/dashboard/history')}>
              ← Back to History
            </Button>
          </div>
        )}
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

      {/* Error alert */}
      {error && (
        <div className="p-3 bg-danger-500/10 border border-danger-500/30 rounded-lg flex items-center gap-2">
          <svg className="w-5 h-5 text-danger-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-danger-300">{error}</span>
          <button 
            onClick={() => setError(null)} 
            className="ml-auto p-1 hover:bg-danger-500/20 rounded"
          >
            <svg className="w-4 h-4 text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

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

              {/* Personalized Insight */}
              {coachMessage.personalizedInsight && (
                <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                  <p className="text-sm text-primary-300">
                    {coachMessage.personalizedInsight}
                  </p>
                </div>
              )}

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
              {isCurrent && (() => {
                // Calculate AI recommended weight first so it can be used for warmup
                const exerciseNote = coachMessage?.exerciseNotes.find(
                  n => n.name === block.exercise.name
                );
                const aiRecommendedWeight = exerciseNote?.weightRec?.recommendedWeight || 0;
                const effectiveWorkingWeight = block.targetWeightKg > 0 ? block.targetWeightKg : aiRecommendedWeight;
                
                return (
                <div className="ml-11 space-y-4">
                  {/* Warmup protocol */}
                  {block.warmupProtocol && block.warmupProtocol.length > 0 && effectiveWorkingWeight > 0 && (
                    <WarmupProtocol
                      warmupSets={block.warmupProtocol}
                      workingWeight={effectiveWorkingWeight}
                      minIncrement={block.exercise.minWeightIncrementKg}
                      unit={preferences.units}
                    />
                  )}

                  {/* Exercise card with integrated set inputs */}
                  <ExerciseCard
                    exercise={block.exercise}
                    block={addingExtraSet === block.id 
                      ? { ...block, targetSets: block.targetSets + 1 }  // Add one more set when adding extra
                      : block
                    }
                    sets={blockSets}
                    onSetComplete={(data) => {
                      handleSetComplete(data);
                      setAddingExtraSet(null);
                      setShowRestTimer(true);
                    }}
                    onSetEdit={handleSetEdit}
                    onSetDelete={handleDeleteSet}
                    onTargetSetsChange={(newSets) => handleTargetSetsChange(block.id, newSets)}
                    onExerciseSwap={(newEx) => handleExerciseSwap(block.id, newEx)}
                    onExerciseDelete={() => handleExerciseDelete(block.id)}
                    availableExercises={blocks.map(b => b.exercise).concat(
                      availableExercises.map(ex => ({
                        id: ex.id,
                        name: ex.name,
                        primaryMuscle: ex.primary_muscle,
                        secondaryMuscles: [],
                        mechanic: ex.mechanic,
                        defaultRepRange: [8, 12] as [number, number],
                        defaultRir: 2,
                        minWeightIncrementKg: 2.5,
                        formCues: [],
                        commonMistakes: [],
                        setupNote: '',
                        movementPattern: '',
                        equipmentRequired: [],
                      }))
                    )}
                    isActive
                    unit={preferences.units}
                    recommendedWeight={aiRecommendedWeight}
                    exerciseHistory={exerciseHistories[block.exerciseId]}
                  />

                  {/* Exercise complete actions */}
                  {isComplete && addingExtraSet !== block.id && (
                    <div className="flex justify-center gap-3 py-4">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setAddingExtraSet(block.id)}
                      >
                        + Add Extra Set
                      </Button>
                      {index < blocks.length - 1 && (
                        <Button variant="secondary" onClick={handleNextExercise}>
                          Next Exercise →
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}

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
              
              {/* Create custom exercise button */}
              <button
                onClick={() => setShowCustomExercise(true)}
                className="w-full p-3 bg-surface-800/50 hover:bg-surface-800 rounded-lg border border-dashed border-surface-600 hover:border-primary-500/50 transition-all flex items-center justify-center gap-2 text-surface-400 hover:text-primary-400"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span className="text-sm font-medium">Create Custom Exercise</span>
              </button>
              
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

      {/* Custom Exercise Creation Modal */}
      {showCustomExercise && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div 
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowCustomExercise(false)}
          />
          
          {/* Modal */}
          <div className="relative w-full max-w-md bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowCustomExercise(false)}
                  className="p-1 text-surface-400 hover:text-surface-200"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold text-surface-100">Create Custom Exercise</h2>
              </div>
            </div>

            {/* Form */}
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Exercise Name *
                </label>
                <Input
                  placeholder="e.g., Cable Chest Fly Machine"
                  value={customExerciseName}
                  onChange={(e) => setCustomExerciseName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Primary Muscle Group *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {MUSCLE_GROUPS.map((muscle) => (
                    <button
                      key={muscle}
                      onClick={() => setCustomExerciseMuscle(muscle)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                        customExerciseMuscle === muscle
                          ? 'bg-primary-500 text-white'
                          : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                      }`}
                    >
                      {muscle}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-300 mb-2">
                  Exercise Type *
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setCustomExerciseMechanic('compound')}
                    className={`p-3 rounded-lg text-center transition-colors ${
                      customExerciseMechanic === 'compound'
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    <p className="font-medium">Compound</p>
                    <p className="text-xs opacity-75 mt-0.5">Multi-joint movement</p>
                  </button>
                  <button
                    onClick={() => setCustomExerciseMechanic('isolation')}
                    className={`p-3 rounded-lg text-center transition-colors ${
                      customExerciseMechanic === 'isolation'
                        ? 'bg-primary-500 text-white'
                        : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
                    }`}
                  >
                    <p className="font-medium">Isolation</p>
                    <p className="text-xs opacity-75 mt-0.5">Single-joint movement</p>
                  </button>
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="p-2 bg-danger-500/10 border border-danger-500/20 rounded-lg text-danger-400 text-xs">
                  {error}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setShowCustomExercise(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleCreateCustomExercise}
                  disabled={!customExerciseName.trim() || isCreatingExercise}
                  isLoading={isCreatingExercise}
                >
                  Create & Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
