'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Card, Button, Badge, Input, LoadingAnimation } from '@/components/ui';
import { ExerciseCard, RestTimerControlPanel, WarmupProtocol, ReadinessCheckIn, SessionSummary } from '@/components/workout';
import { useRestTimer } from '@/hooks/useRestTimer';
import type { Exercise, ExerciseBlock, SetLog, WorkoutSession, WeightUnit, DexaRegionalData, TemporaryInjury, PreWorkoutCheckIn } from '@/types/schema';
import { createUntypedClient } from '@/lib/supabase/client';
import { generateWarmupProtocol } from '@/services/progressionEngine';
import { MUSCLE_GROUPS } from '@/types/schema';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { quickWeightEstimate, quickWeightEstimateWithCalibration, type WorkingWeightRecommendation } from '@/services/weightEstimationEngine';
import { formatWeight } from '@/lib/utils';
import { generateWorkoutCoachNotes, type WorkoutCoachNotesInput } from '@/lib/actions/coaching';
import { 
  getInjuryRisk, 
  getSafeAlternatives, 
  autoSwapForInjuries,
  getInjuryDescription,
  INJURY_LABELS,
  type InjuryArea,
  type InjuryContext,
  type InjuryRisk
} from '@/services/injuryAwareSwapper';

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

// Wrapper to convert injuries array to get risk info using new intelligent swapper
function getExerciseInjuryRisk(
  exercise: Exercise, 
  injuries: { area: string; severity: 1 | 2 | 3 }[]
): { isRisky: boolean; severity: number; reasons: string[]; risk: InjuryRisk } {
  if (injuries.length === 0) return { isRisky: false, severity: 0, reasons: [], risk: 'safe' };
  
  let worstRisk: InjuryRisk = 'safe';
  let maxSeverity = 0;
  const reasons: string[] = [];
  
  for (const injury of injuries) {
    const risk = getInjuryRisk(exercise, injury.area as InjuryArea);
    
    if (risk === 'avoid') {
      worstRisk = 'avoid';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`May aggravate ${INJURY_LABELS[injury.area] || injury.area}`);
    } else if (risk === 'caution' && worstRisk !== 'avoid') {
      worstRisk = 'caution';
      maxSeverity = Math.max(maxSeverity, injury.severity);
      reasons.push(`Use caution (${INJURY_LABELS[injury.area] || injury.area})`);
    }
  }
  
  return {
    isRisky: worstRisk !== 'safe',
    severity: maxSeverity,
    reasons: Array.from(new Set(reasons)),
    risk: worstRisk
  };
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
  const searchParams = useSearchParams();
  const sessionId = params.id as string;
  const fromCreate = searchParams.get('fromCreate') === 'true';
  const { preferences, updatePreference, isLoading: preferencesLoading } = useUserPreferences();

  const [phase, setPhase] = useState<WorkoutPhase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [blocks, setBlocks] = useState<ExerciseBlockWithExercise[]>([]);
  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState<SetLog[]>([]);
  const [currentSetNumber, setCurrentSetNumber] = useState(1);
  const [showRestTimer, setShowRestTimer] = useState(false);
  const [restTimerDuration, setRestTimerDuration] = useState<number | null>(null); // Custom rest time (for warmups)
  const [restTimerPanelVisible, setRestTimerPanelVisible] = useState(true);
  const [exerciseHistories, setExerciseHistories] = useState<Record<string, ExerciseHistoryData>>({});
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  
  // Drag reorder state for exercises
  const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
  const [dragOverBlockIndex, setDragOverBlockIndex] = useState<number | null>(null);
  const [isDraggingBlock, setIsDraggingBlock] = useState(false);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const preCollapseStateRef = useRef<{ allCollapsed: boolean; collapsedBlocks: Set<string> } | null>(null);
  // Floating drag preview state
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragTouchOffset, setDragTouchOffset] = useState<number>(0); // Offset from touch point to top of element
  const [draggedBlockRect, setDraggedBlockRect] = useState<DOMRect | null>(null);
  const draggedBlockRef = useRef<HTMLDivElement | null>(null);
  const exerciseListRef = useRef<HTMLDivElement | null>(null);
  const dragTouchOffsetRef = useRef<number>(0);
  
  // Add exercise modal state
  const [showAddExercise, setShowAddExercise] = useState(false);
  const [availableExercises, setAvailableExercises] = useState<AvailableExercise[]>([]);
  const [frequentExerciseIds, setFrequentExerciseIds] = useState<Map<string, number>>(new Map());
  const [lastDoneExercises, setLastDoneExercises] = useState<Map<string, Date>>(new Map());
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('');
  const [isAddingExercise, setIsAddingExercise] = useState(false);
  const [selectedMuscleFilter, setSelectedMuscleFilter] = useState<string | null>(null);
  const [showMuscleDropdown, setShowMuscleDropdown] = useState(false);
  const [selectedExercisesToAdd, setSelectedExercisesToAdd] = useState<AvailableExercise[]>([]);
  const [exerciseSortOption, setExerciseSortOption] = useState<'frequency' | 'name' | 'recent'>('frequency');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  
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
  const [aiCoachNotes, setAiCoachNotes] = useState<string | null>(null);
  const [isLoadingAiNotes, setIsLoadingAiNotes] = useState(false);
  const [aiCoachNotesEnabled, setAiCoachNotesEnabled] = useState(false);
  
  // Store AI context for regenerating notes when injuries change
  const [aiNotesContext, setAiNotesContext] = useState<{
    exercises: WorkoutCoachNotesInput['exercises'];
    workoutType: string;
    weekInMesocycle?: number;
    mesocycleName?: string;
    totalWeeks?: number;
  } | null>(null);
  
  // Injury report modal state
  const [showInjuryModal, setShowInjuryModal] = useState(false);
  const [temporaryInjuries, setTemporaryInjuries] = useState<{ area: string; severity: 1 | 2 | 3 }[]>([]);
  const [userGoal, setUserGoal] = useState<'bulk' | 'cut' | 'recomp' | 'maintain' | undefined>(undefined);
  const [selectedInjuryArea, setSelectedInjuryArea] = useState<string>('');
  const [selectedInjurySeverity, setSelectedInjurySeverity] = useState<1 | 2 | 3>(1);
  
  // Today's nutrition for pre-workout check-in
  const [todayNutrition, setTodayNutrition] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    targetCalories?: number;
    targetProtein?: number;
  } | null>(null);
  
  // State for showing swap modal for a specific exercise due to injury
  const [showSwapForInjury, setShowSwapForInjury] = useState<string | null>(null);
  const [showPageLevelSwapModal, setShowPageLevelSwapModal] = useState(false);
  const [swapTargetBlockId, setSwapTargetBlockId] = useState<string | null>(null);
  const [swapSearchQuery, setSwapSearchQuery] = useState('');

  const currentBlock = blocks[currentBlockIndex];
  const currentExercise = currentBlock?.exercise;
  const currentBlockSets = completedSets.filter(s => s.exerciseBlockId === currentBlock?.id);

  // Memoize rest timer options to prevent hook reinitialization
  const restTimerOptions = useMemo(() => ({
    defaultSeconds: restTimerDuration ?? currentBlock?.targetRestSeconds ?? 180,
    autoStart: false,
    onComplete: () => {
      // Timer completed - could optionally auto-dismiss
    },
  }), [restTimerDuration, currentBlock?.targetRestSeconds]);

  // Rest timer hook
  const restTimer = useRestTimer(restTimerOptions);

  // Clear timer when session changes or component unmounts
  useEffect(() => {
    // Clear timer when sessionId changes (new workout started)
    console.log('[WORKOUT] Session changed or component mounted, clearing timer');
    restTimer.dismiss();
    
    return () => {
      // Cleanup: dismiss timer when leaving the workout page
      console.log('[WORKOUT] Cleaning up rest timer on unmount');
      restTimer.dismiss();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // Only depend on sessionId, not restTimer to avoid loops

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
              // Include hypertrophy scoring for tier badges
              hypertrophyScore: block.exercises.hypertrophy_tier ? {
                tier: block.exercises.hypertrophy_tier,
                stretchUnderLoad: block.exercises.stretch_under_load || 3,
                resistanceProfile: block.exercises.resistance_profile || 3,
                progressionEase: block.exercises.progression_ease || 3,
              } : undefined,
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
        
        // Fetch user profile, DEXA, calibrated lifts, and mesocycle in parallel
        const [userResult, dexaResult, calibratedResult, mesocycleResult] = await Promise.all([
          // User profile for weight estimation (including preferences for AI coach notes setting)
          supabase
            .from('users')
            .select('weight_kg, height_cm, experience, training_age, goal, preferences')
            .eq('id', sessionData.user_id)
            .single(),
          // Latest DEXA scan for body fat and regional data
          supabase
            .from('dexa_scans')
            .select('body_fat_percentage, regional_data, lean_mass_kg')
            .eq('user_id', sessionData.user_id)
            .order('scan_date', { ascending: false })
            .limit(1)
            .single(),
          // Calibrated lifts for weight estimation
          supabase
            .from('calibrated_lifts')
            .select('lift_name, estimated_1rm, tested_at')
            .eq('user_id', sessionData.user_id)
            .order('tested_at', { ascending: false }),
          // Mesocycle info
          supabase
            .from('mesocycles')
            .select('name, start_date, total_weeks')
            .eq('user_id', sessionData.user_id)
            .eq('is_active', true)
            .single(),
        ]);

        const userData = userResult.data;
        const dexaData = dexaResult.data;
        const calibratedLifts = calibratedResult.data;
        const mesocycleData = mesocycleResult.data;
        
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
        
        // Store user's goal for check-in component
        if (userData?.goal) {
          setUserGoal(userData.goal as 'bulk' | 'cut' | 'recomp' | 'maintain');
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
          userContext.weekInMesocycle = Math.min(weeksSinceStart, mesocycleData.total_weeks);
        }
        
        // Generate coach message with profile and context
        setCoachMessage(generateCoachMessage(transformedBlocks, profile, userContext));
        
        // Check for existing injuries from session's pre_workout_check_in
        const existingCheckIn = sessionData.pre_workout_check_in as { temporaryInjuries?: Array<{ area: string; severity: 1 | 2 | 3 }> } | null;
        const existingInjuries = existingCheckIn?.temporaryInjuries || [];
        if (existingInjuries.length > 0) {
          setTemporaryInjuries(existingInjuries);
          console.log('[Workout] Loaded existing injuries from session:', existingInjuries);
        }
        
        // Check if AI coach notes are enabled in user preferences
        const userPrefs = (userData?.preferences as Record<string, unknown>) || {};
        const aiCoachNotesEnabledValue = (userPrefs.showAiCoachNotes as boolean) ?? false;
        setAiCoachNotesEnabled(aiCoachNotesEnabledValue);
        
        // Generate AI-powered coach notes in the background (only if enabled)
        if (aiCoachNotesEnabledValue) {
          (async () => {
            setIsLoadingAiNotes(true);
            try {
              // Determine workout type from exercises
              const muscles = Array.from(new Set(transformedBlocks.map((b: ExerciseBlockWithExercise) => b.exercise.primaryMuscle)));
              let inferredWorkoutType = '';
              if (muscles.length >= 5) inferredWorkoutType = 'Full Body';
              else if (muscles.includes('chest') && muscles.includes('back')) inferredWorkoutType = 'Upper Body';
              else if (muscles.includes('quads') && muscles.includes('hamstrings')) inferredWorkoutType = 'Lower Body';
              else if (muscles.includes('chest') && muscles.includes('shoulders') && muscles.includes('triceps')) inferredWorkoutType = 'Push';
              else if (muscles.includes('back') && muscles.includes('biceps')) inferredWorkoutType = 'Pull';
              else inferredWorkoutType = muscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(' & ');
            
            // Build exercises data for AI context
            const exercisesData = transformedBlocks.map((b: ExerciseBlockWithExercise) => ({
              name: b.exercise.name,
              primaryMuscle: b.exercise.primaryMuscle,
              mechanic: b.exercise.mechanic,
              sets: b.targetSets,
              targetReps: `${b.targetRepRange[0]}-${b.targetRepRange[1]}`,
            }));
            
            // Store context for potential regeneration later
            setAiNotesContext({
              exercises: exercisesData,
              workoutType: inferredWorkoutType,
              weekInMesocycle: userContext.weekInMesocycle,
              mesocycleName: userContext.mesocycleName,
              totalWeeks: mesocycleData?.total_weeks,
            });
            
            const aiInput: WorkoutCoachNotesInput = {
              exercises: exercisesData,
              workoutType: inferredWorkoutType,
              weekInMesocycle: userContext.weekInMesocycle,
              mesocycleName: userContext.mesocycleName,
              totalWeeks: mesocycleData?.total_weeks,
              // Include existing injuries if any (from previous session state)
              injuries: existingInjuries.length > 0 ? existingInjuries : undefined,
            };
            const result = await generateWorkoutCoachNotes(aiInput);
            setAiCoachNotes(result.notes);
          } catch (error) {
            console.error('[AI Coach Notes] Failed to generate:', error);
          } finally {
            setIsLoadingAiNotes(false);
          }
          })();
        }
        
        // Fetch exercise history for all exercises in parallel
        const exerciseIds = transformedBlocks.map((b: ExerciseBlockWithExercise) => b.exerciseId);
        if (exerciseIds.length > 0) {
          // Fetch all exercise histories in parallel
          const historyPromises = exerciseIds.map(exerciseId =>
            supabase
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
              .limit(20)
              .then((result: { data: any[] | null }) => ({ exerciseId, data: result.data }))
              .catch(() => ({ exerciseId, data: null }))
          );

          const historyResults = await Promise.all(historyPromises);
          const histories: Record<string, ExerciseHistoryData> = {};

          for (const { exerciseId, data: historyBlocks } of historyResults) {
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
          // Fetch preference directly from DB to avoid race condition with React state
          const { data: { user } } = await supabase.auth.getUser();
          let shouldSkipCheckIn = false;
          
          if (user) {
            const { data: userData } = await supabase
              .from('users')
              .select('preferences')
              .eq('id', user.id)
              .single();
            
            const prefs = (userData?.preferences as Record<string, unknown>) || {};
            shouldSkipCheckIn = (prefs.skipPreWorkoutCheckIn as boolean) ?? false;
          }
          
          if (shouldSkipCheckIn) {
            // Skip check-in, go directly to workout
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

  // Fetch frequently used exercises for sorting
  useEffect(() => {
    async function loadFrequentExercises() {
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
        // Count occurrences of each exercise and track most recent date
        const counts = new Map<string, number>();
        const lastDone = new Map<string, Date>();
        data.forEach((block: { exercise_id: string; workout_sessions: { started_at: string } }) => {
          const id = block.exercise_id;
          counts.set(id, (counts.get(id) || 0) + 1);

          const sessionDate = new Date(block.workout_sessions.started_at);
          const currentLastDone = lastDone.get(id);
          if (!currentLastDone || sessionDate > currentLastDone) {
            lastDone.set(id, sessionDate);
          }
        });
        setFrequentExerciseIds(counts);
        setLastDoneExercises(lastDone);
      }
    }
    loadFrequentExercises();
  }, []);

  // Fetch today's nutrition data for check-in
  useEffect(() => {
    async function loadTodayNutrition() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const today = new Date().toISOString().split('T')[0];

        // Fetch today's food log entries (logged_at is a DATE column, not timestamp)
        const { data: foodEntries } = await supabase
          .from('food_log')
          .select('calories, protein, carbs, fat')
          .eq('user_id', user.id)
          .eq('logged_at', today);

        // Fetch nutrition targets
        const { data: targets } = await supabase
          .from('nutrition_targets')
          .select('calories, protein')
          .eq('user_id', user.id)
          .single();

        if (foodEntries) {
          const totals = foodEntries.reduce(
            (acc: { calories: number; protein: number; carbs: number; fat: number }, entry: { calories?: number; protein?: number; carbs?: number; fat?: number }) => ({
              calories: acc.calories + (entry.calories || 0),
              protein: acc.protein + (entry.protein || 0),
              carbs: acc.carbs + (entry.carbs || 0),
              fat: acc.fat + (entry.fat || 0),
            }),
            { calories: 0, protein: 0, carbs: 0, fat: 0 }
          );

          setTodayNutrition({
            ...totals,
            targetCalories: targets?.calories,
            targetProtein: targets?.protein,
          });
        }
      } catch (err) {
        console.error('Failed to load nutrition:', err);
      }
    }

    loadTodayNutrition();
  }, []);

  // Function to regenerate AI coach notes with injury context
  const regenerateAiCoachNotes = async (injuries: { area: string; severity: 1 | 2 | 3 }[]) => {
    if (!aiNotesContext) {
      console.log('[AI Coach] No context stored, skipping regeneration');
      return;
    }
    
    setIsLoadingAiNotes(true);
    try {
      const aiInput: WorkoutCoachNotesInput = {
        ...aiNotesContext,
        injuries: injuries.length > 0 ? injuries : undefined,
      };
      console.log('[AI Coach] Regenerating notes with injuries:', injuries);
      const result = await generateWorkoutCoachNotes(aiInput);
      setAiCoachNotes(result.notes);
    } catch (error) {
      console.error('[AI Coach Notes] Failed to regenerate:', error);
    } finally {
      setIsLoadingAiNotes(false);
    }
  };

  const handleCheckInComplete = async (checkInData?: PreWorkoutCheckIn) => {
    try {
      const supabase = createUntypedClient();
      
      // Prepare check-in data for database
      const updateData: Record<string, unknown> = {
        state: 'in_progress',
        started_at: new Date().toISOString(),
      };
      
      // If we have check-in data, save it
      if (checkInData) {
        updateData.pre_workout_check_in = {
          sleepHours: checkInData.sleepHours,
          sleepQuality: checkInData.sleepQuality,
          stressLevel: checkInData.stressLevel,
          nutritionRating: checkInData.nutritionRating,
          bodyweightKg: checkInData.bodyweightKg,
          readinessScore: checkInData.readinessScore,
          temporaryInjuries: checkInData.temporaryInjuries,
        };
        
        // Set temporary injuries in state so they carry over to workout
        if (checkInData.temporaryInjuries && checkInData.temporaryInjuries.length > 0) {
          setTemporaryInjuries(
            checkInData.temporaryInjuries.map(i => ({
              area: i.area,
              severity: i.severity,
            }))
          );
        }
        
        // If bodyweight was provided, also log it to weight log
        if (checkInData.bodyweightKg) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const today = new Date().toISOString().split('T')[0];
            await supabase
              .from('weight_log')
              .upsert(
                {
                  user_id: user.id,
                  weight: checkInData.bodyweightKg,
                  unit: 'kg',
                  logged_at: today,
                },
                { onConflict: 'user_id,logged_at' }
              );
          }
        }
        
        // Auto-adjust exercises if injuries were reported
        if (checkInData.temporaryInjuries && checkInData.temporaryInjuries.length > 0) {
          const injuriesForAi = checkInData.temporaryInjuries.map(i => ({
            area: i.area,
            severity: i.severity,
          }));
          
          // Schedule auto-adjust after state updates
          setTimeout(() => {
            autoAdjustForInjuries(injuriesForAi);
          }, 500);
          
          // Regenerate AI coach notes with injury context
          regenerateAiCoachNotes(injuriesForAi);
        }
      }
      
      await supabase
        .from('workout_sessions')
        .update(updateData)
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
    // Then complete the check-in for this workout (without check-in data)
    await handleCheckInComplete();
  };

  const handleSetComplete = async (data: { 
    weightKg: number; 
    reps: number; 
    rpe: number; 
    note?: string;
    setType?: 'normal' | 'warmup' | 'dropset' | 'myorep' | 'rest_pause';
    parentSetId?: string;
  }) => {
    if (!currentBlock) return;

    const quality = data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective';
    const loggedAt = new Date().toISOString();
    const setType = data.setType || 'normal';

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
          set_type: setType,
          parent_set_id: data.parentSetId || null,
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
        setType: setType,
        parentSetId: data.parentSetId || null,
        quality: quality,
        qualityReason: '',
        note: data.note || null,
        loggedAt: loggedAt,
      };
      
      // Update local state using functional updates to avoid stale closures
      setCompletedSets(prevSets => [...prevSets, newSet]);
      setCurrentSetNumber(prev => prev + 1);
      setShowRestTimer(true);
      setRestTimerPanelVisible(true); // Show panel when timer starts
      setRestTimerDuration(null); // Use default rest time for working sets
      restTimer.start(currentBlock?.targetRestSeconds ?? 180);
      setError(null);
    } catch (err) {
      console.error('Failed to save set:', err);
      setError(err instanceof Error ? err.message : 'Failed to save set - please try again');
    }
  };

  const handleSetEdit = async (setId: string, data: { weightKg: number; reps: number; rpe: number }) => {
    const quality = data.rpe >= 7.5 && data.rpe <= 9.5 ? 'stimulative' : data.rpe <= 5 ? 'junk' : 'effective' as const;
    
    // Update local state using functional update to avoid stale closure
    setCompletedSets(prevSets => prevSets.map(set => 
      set.id === setId 
        ? { 
            ...set, 
            weightKg: data.weightKg, 
            reps: data.reps, 
            rpe: data.rpe,
            quality,
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
        quality,
      }).eq('id', setId);
      
      if (updateError) {
        console.error('Failed to update set:', updateError);
        setError(`Failed to update set: ${updateError.message}`);
        // Revert local state on error - refetch from database
        // For now, just show error; user can refresh if needed
      } else {
        setError(null);
      }
    } catch (err) {
      console.error('Failed to update set:', err);
      setError(err instanceof Error ? err.message : 'Failed to update set');
    }
  };

  const handleDeleteSet = async (setId: string) => {
    // Remove from local state using functional update to avoid stale closure
    setCompletedSets(prevSets => {
      const setToDelete = prevSets.find(s => s.id === setId);
      if (!setToDelete) return prevSets;

      // Filter out the deleted set and renumber remaining sets in the same block
      const filteredSets = prevSets.filter(set => set.id !== setId);
      const blockId = setToDelete.exerciseBlockId;

      // Renumber sets in the same block (immutably)
      let blockSetNumber = 1;
      return filteredSets.map(set => {
        if (set.exerciseBlockId === blockId && !set.isWarmup) {
          return { ...set, setNumber: blockSetNumber++ };
        }
        return set;
      });
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
  
  // Auto-adjust message state
  const [autoAdjustMessage, setAutoAdjustMessage] = useState<string | null>(null);

  // Auto-swap or remove exercises based on injuries using intelligent injury-aware swapper
  const autoAdjustForInjuries = async (injuries: { area: string; severity: 1 | 2 | 3 }[]) => {
    if (injuries.length === 0 || blocks.length === 0) return;
    
    const supabase = createUntypedClient();
    const adjustments: string[] = [];
    
    // Convert to InjuryContext format
    const injuryContexts: InjuryContext[] = injuries.map(i => ({
      area: i.area as InjuryArea,
      severity: i.severity
    }));
    
    // Fetch all exercises if not already loaded
    let exercisesToUse = availableExercises;
    if (exercisesToUse.length === 0) {
      const { data: allExercises } = await supabase
        .from('exercises')
        .select('id, name, primary_muscle, secondary_muscles, mechanic')
        .order('name');
      
      if (allExercises) {
        exercisesToUse = allExercises;
        setAvailableExercises(allExercises);
      }
    }
    
    if (exercisesToUse.length === 0) {
      console.error('No exercises available for swap');
      return;
    }
    
    // Build full exercise list from available exercises
    const fullExercises: Exercise[] = exercisesToUse.map(ex => ({
      id: ex.id,
      name: ex.name,
      primaryMuscle: ex.primary_muscle,
      secondaryMuscles: ex.secondary_muscles || [],
      mechanic: ex.mechanic,
      defaultRepRange: [8, 12] as [number, number],
      defaultRir: 2,
      minWeightIncrementKg: 2.5,
      formCues: [],
      commonMistakes: [],
      setupNote: '',
      movementPattern: '',
      equipmentRequired: [],
    }));
    
    // Get auto-swap results from the intelligent swapper
    const workoutExercises = blocks.map(b => ({ id: b.id, exercise: b.exercise }));
    const swapResults = autoSwapForInjuries(workoutExercises, fullExercises, injuryContexts);
    
    if (swapResults.length === 0) return;
    
    for (const result of swapResults) {
      const block = blocks.find(b => b.id === result.originalId);
      if (!block) continue;
      
      if (result.action === 'swapped' && result.replacement) {
        // Fetch full exercise data from database
        try {
          const { data: fullExData } = await supabase
            .from('exercises')
            .select('*')
            .eq('id', result.replacement.id)
            .single();
          
          if (fullExData) {
            // Update in database
            await supabase
              .from('exercise_blocks')
              .update({ exercise_id: result.replacement.id })
              .eq('id', block.id);
            
            // Update local state
            const completeExercise: Exercise = {
              id: fullExData.id,
              name: fullExData.name,
              primaryMuscle: fullExData.primary_muscle,
              secondaryMuscles: fullExData.secondary_muscles || [],
              mechanic: fullExData.mechanic,
              defaultRepRange: fullExData.default_rep_range || [8, 12],
              defaultRir: fullExData.default_rir || 2,
              minWeightIncrementKg: fullExData.min_weight_increment_kg || 2.5,
              formCues: fullExData.form_cues || [],
              commonMistakes: fullExData.common_mistakes || [],
              setupNote: fullExData.setup_note || '',
              movementPattern: fullExData.movement_pattern || '',
              equipmentRequired: fullExData.equipment_required || [],
              hypertrophyScore: fullExData.hypertrophy_tier ? {
                tier: fullExData.hypertrophy_tier,
                stretchUnderLoad: fullExData.stretch_under_load || 3,
                resistanceProfile: fullExData.resistance_profile || 3,
                progressionEase: fullExData.progression_ease || 3,
              } : undefined,
            };
            
            setBlocks(prevBlocks => prevBlocks.map(b => 
              b.id === block.id 
                ? { ...b, exerciseId: result.replacement!.id, exercise: completeExercise }
                : b
            ));
            
            adjustments.push(`${result.originalName} → ${result.replacement.name}`);
          }
        } catch (err) {
          console.error('Failed to auto-swap exercise:', err);
        }
      } else if (result.action === 'removed') {
        // No safe alternative - remove the exercise
        try {
          // Delete from database
          await supabase
            .from('exercise_blocks')
            .delete()
            .eq('id', block.id);
          
          // Update local state
          setBlocks(prevBlocks => prevBlocks.filter(b => b.id !== block.id));
          
          adjustments.push(`Removed ${result.originalName}`);
        } catch (err) {
          console.error('Failed to remove exercise:', err);
        }
      }
    }
    
    // Show adjustment message
    if (adjustments.length > 0) {
      setAutoAdjustMessage(`🔄 Auto-adjusted for injury: ${adjustments.join('; ')}`);
      // Clear message after 8 seconds
      setTimeout(() => setAutoAdjustMessage(null), 8000);
    }
  };

  // Handle applying injuries and saving to session
  const handleApplyInjuries = async () => {
    try {
      const supabase = createUntypedClient();
      
      // Update session's pre_workout_check_in with temporary injuries
      const { data: sessionData } = await supabase
        .from('workout_sessions')
        .select('pre_workout_check_in')
        .eq('id', sessionId)
        .single();
      
      const existingCheckIn = sessionData?.pre_workout_check_in || {};
      
      await supabase
        .from('workout_sessions')
        .update({
          pre_workout_check_in: {
            ...existingCheckIn,
            temporaryInjuries: temporaryInjuries,
          },
        })
        .eq('id', sessionId);
      
      // Auto-adjust exercises based on injuries
      await autoAdjustForInjuries(temporaryInjuries);
      
      // Regenerate AI coach notes with the updated injury context
      if (temporaryInjuries.length > 0) {
        regenerateAiCoachNotes(temporaryInjuries);
      }
      
      setShowInjuryModal(false);
    } catch (err) {
      console.error('Failed to save injury data:', err);
      setShowInjuryModal(false);
    }
  };

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

  // Toggle individual exercise collapse
  const toggleBlockCollapse = useCallback((blockId: string) => {
    setCollapsedBlocks(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  // Long press handlers for drag reorder
  const handleBlockLongPressStart = useCallback((index: number, clientY: number) => {
    longPressTimerRef.current = setTimeout(() => {
      // Save current collapse state before collapsing all for drag mode
      preCollapseStateRef.current = {
        allCollapsed,
        collapsedBlocks: new Set(collapsedBlocks),
      };

      // Get the element being dragged and its dimensions
      const element = document.querySelector(`[data-block-index="${index}"]`) as HTMLElement;
      if (element) {
        const rect = element.getBoundingClientRect();
        setDraggedBlockRect(rect);
        // Calculate offset from touch point to top of element - keeps preview under finger
        const touchOffset = clientY - rect.top;
        setDragTouchOffset(touchOffset);
        dragTouchOffsetRef.current = touchOffset;
        // Position preview so it stays under the finger
        setDragPosition({ x: rect.left, y: clientY - touchOffset });
      }

      setDraggedBlockIndex(index);
      setIsDraggingBlock(true);
      // Collapse all exercises for iPhone-style drag mode
      setAllCollapsed(true);

      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 700); // 700ms long press to activate drag
  }, [allCollapsed, collapsedBlocks]);

  const handleBlockLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // Calculate the target index based on current drag position
  const calculateDragTargetIndex = useCallback((clientY: number): number => {
    if (!exerciseListRef.current || draggedBlockIndex === null) return draggedBlockIndex ?? 0;

    const listItems = exerciseListRef.current.querySelectorAll('[data-block-index]');
    let targetIndex = draggedBlockIndex;

    for (let i = 0; i < listItems.length; i++) {
      const item = listItems[i] as HTMLElement;
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        targetIndex = i;
        break;
      }
      targetIndex = i + 1;
    }

    // Clamp to valid range
    return Math.max(0, Math.min(targetIndex, blocks.length - 1));
  }, [draggedBlockIndex, blocks.length]);

  const handleBlockDragMove = useCallback((clientY: number) => {
    if (!isDraggingBlock || draggedBlockIndex === null) return;

    // Update floating preview position - use touch offset to keep preview under finger
    if (draggedBlockRect) {
      setDragPosition({
        x: draggedBlockRect.left,
        y: clientY - dragTouchOffset
      });
    }

    // Calculate which position the item would drop at
    const targetIndex = calculateDragTargetIndex(clientY);
    if (targetIndex !== dragOverBlockIndex && targetIndex !== draggedBlockIndex) {
      setDragOverBlockIndex(targetIndex);
    }
  }, [isDraggingBlock, draggedBlockIndex, draggedBlockRect, dragTouchOffset, calculateDragTargetIndex, dragOverBlockIndex]);

  // Use refs to access latest values in document event listeners
  const isDraggingBlockRef = useRef(isDraggingBlock);
  const draggedBlockIndexRef = useRef(draggedBlockIndex);
  const draggedBlockRectRef = useRef(draggedBlockRect);
  const dragOverBlockIndexRef = useRef(dragOverBlockIndex);

  // Keep refs in sync with state
  useEffect(() => {
    isDraggingBlockRef.current = isDraggingBlock;
    draggedBlockIndexRef.current = draggedBlockIndex;
    draggedBlockRectRef.current = draggedBlockRect;
    dragOverBlockIndexRef.current = dragOverBlockIndex;
  }, [isDraggingBlock, draggedBlockIndex, draggedBlockRect, dragOverBlockIndex]);

  const handleBlockDragEnd = useCallback(async () => {
    const finalTargetIndex = dragOverBlockIndex ?? draggedBlockIndex;

    if (draggedBlockIndex !== null && finalTargetIndex !== null && draggedBlockIndex !== finalTargetIndex) {
      const newBlocks = [...blocks];
      const [removed] = newBlocks.splice(draggedBlockIndex, 1);
      newBlocks.splice(finalTargetIndex, 0, removed);

      // Update local state immediately
      setBlocks(newBlocks);

      // Update current block index if needed
      if (currentBlockIndex === draggedBlockIndex) {
        setCurrentBlockIndex(finalTargetIndex);
      } else if (draggedBlockIndex < currentBlockIndex && finalTargetIndex >= currentBlockIndex) {
        setCurrentBlockIndex(currentBlockIndex - 1);
      } else if (draggedBlockIndex > currentBlockIndex && finalTargetIndex <= currentBlockIndex) {
        setCurrentBlockIndex(currentBlockIndex + 1);
      }

      // Update sort orders in database
      try {
        const supabase = createUntypedClient();
        for (let i = 0; i < newBlocks.length; i++) {
          await supabase
            .from('exercise_blocks')
            .update({ sort_order: i })
            .eq('id', newBlocks[i].id);
        }
      } catch (err) {
        console.error('Error saving reorder:', err);
      }
    }

    setDraggedBlockIndex(null);
    setDragOverBlockIndex(null);
    setIsDraggingBlock(false);
    setDragPosition(null);
    setDraggedBlockRect(null);

    // Restore pre-drag collapse state
    if (preCollapseStateRef.current) {
      setAllCollapsed(preCollapseStateRef.current.allCollapsed);
      setCollapsedBlocks(preCollapseStateRef.current.collapsedBlocks);
      preCollapseStateRef.current = null;
    }
  }, [draggedBlockIndex, dragOverBlockIndex, blocks, currentBlockIndex]);

  // Document-level touch/mouse event listeners for drag
  useEffect(() => {
    if (!isDraggingBlock) return;

    const handleDocumentMove = (clientY: number) => {
      if (!isDraggingBlockRef.current || draggedBlockIndexRef.current === null) return;

      // Update floating preview position - use touch offset to keep preview under finger
      if (draggedBlockRectRef.current) {
        setDragPosition({
          x: draggedBlockRectRef.current.left,
          y: clientY - dragTouchOffsetRef.current
        });
      }

      // Calculate which position the item would drop at
      if (!exerciseListRef.current) return;
      const listItems = exerciseListRef.current.querySelectorAll('[data-block-index]');
      let targetIndex = draggedBlockIndexRef.current;

      for (let i = 0; i < listItems.length; i++) {
        const item = listItems[i] as HTMLElement;
        const rect = item.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        if (clientY < midY) {
          targetIndex = i;
          break;
        }
        targetIndex = i + 1;
      }

      // Clamp to valid range
      targetIndex = Math.max(0, Math.min(targetIndex, blocks.length - 1));

      if (targetIndex !== draggedBlockIndexRef.current) {
        setDragOverBlockIndex(targetIndex);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleDocumentMove(e.touches[0].clientY);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleDocumentMove(e.clientY);
    };

    const handleTouchEnd = () => {
      handleBlockDragEnd();
    };

    const handleMouseUp = () => {
      handleBlockDragEnd();
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingBlock, blocks.length, handleBlockDragEnd]);

  const handleExerciseSwap = async (blockId: string, newExercise: Exercise) => {
    try {
      const supabase = createUntypedClient();
      
      // Fetch full exercise data from database (for hypertrophy scores, equipment, etc.)
      const { data: fullExerciseData, error: fetchError } = await supabase
        .from('exercises')
        .select('*')
        .eq('id', newExercise.id)
        .single();
      
      if (fetchError || !fullExerciseData) {
        console.error('Failed to fetch exercise data:', fetchError);
        // Fall back to the passed exercise data
        setBlocks(prevBlocks => prevBlocks.map(block => 
          block.id === blockId 
            ? { ...block, exerciseId: newExercise.id, exercise: newExercise }
            : block
        ));
      } else {
        // Create complete exercise object with all fields
        const completeExercise: Exercise = {
          id: fullExerciseData.id,
          name: fullExerciseData.name,
          primaryMuscle: fullExerciseData.primary_muscle,
          secondaryMuscles: fullExerciseData.secondary_muscles || [],
          mechanic: fullExerciseData.mechanic,
          defaultRepRange: fullExerciseData.default_rep_range || [8, 12],
          defaultRir: fullExerciseData.default_rir || 2,
          minWeightIncrementKg: fullExerciseData.min_weight_increment_kg || 2.5,
          formCues: fullExerciseData.form_cues || [],
          commonMistakes: fullExerciseData.common_mistakes || [],
          setupNote: fullExerciseData.setup_note || '',
          movementPattern: fullExerciseData.movement_pattern || '',
          equipmentRequired: fullExerciseData.equipment_required || [],
          hypertrophyScore: fullExerciseData.hypertrophy_tier ? {
            tier: fullExerciseData.hypertrophy_tier,
            stretchUnderLoad: fullExerciseData.stretch_under_load || 3,
            resistanceProfile: fullExerciseData.resistance_profile || 3,
            progressionEase: fullExerciseData.progression_ease || 3,
          } : undefined,
        };
        
        // Update local state with complete exercise data
        setBlocks(prevBlocks => prevBlocks.map(block => 
          block.id === blockId 
            ? { ...block, exerciseId: completeExercise.id!, exercise: completeExercise }
            : block
        ));
      }

      // Update in database
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

  // Toggle superset between two adjacent exercises
  const toggleSuperset = async (blockIndex: number) => {
    if (blockIndex >= blocks.length - 1) return;
    
    const block1 = blocks[blockIndex];
    const block2 = blocks[blockIndex + 1];
    
    // Check if they're already in a superset together
    const areSupersetted = block1.supersetGroupId && block1.supersetGroupId === block2.supersetGroupId;
    
    try {
      const supabase = createUntypedClient();
      
      if (areSupersetted) {
        // Remove superset - clear both blocks' superset fields
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: null, superset_order: null })
          .in('id', [block1.id, block2.id]);
        
        // Update local state
        setBlocks(prevBlocks => prevBlocks.map(b => 
          b.id === block1.id || b.id === block2.id
            ? { ...b, supersetGroupId: null, supersetOrder: null }
            : b
        ));
      } else {
        // Create superset - generate a new group ID
        const newGroupId = crypto.randomUUID();
        
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: newGroupId, superset_order: 1 })
          .eq('id', block1.id);
        
        await supabase
          .from('exercise_blocks')
          .update({ superset_group_id: newGroupId, superset_order: 2 })
          .eq('id', block2.id);
        
        // Update local state
        setBlocks(prevBlocks => prevBlocks.map(b => {
          if (b.id === block1.id) return { ...b, supersetGroupId: newGroupId, supersetOrder: 1 };
          if (b.id === block2.id) return { ...b, supersetGroupId: newGroupId, supersetOrder: 2 };
          return b;
        }));
      }
    } catch (err) {
      console.error('Failed to toggle superset:', err);
      setError('Failed to toggle superset');
    }
  };

  const handleNextExercise = () => {
    if (currentBlockIndex < blocks.length - 1) {
      setCurrentBlockIndex(currentBlockIndex + 1);
      setCurrentSetNumber(1);
      setShowRestTimer(false);
      restTimer.dismiss();
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

      // Get max order from database to avoid duplicate key error
      const { data: maxOrderResult } = await supabase
        .from('exercise_blocks')
        .select('order')
        .eq('workout_session_id', sessionId)
        .order('order', { ascending: false })
        .limit(1)
        .single();
      
      const maxExistingOrder = maxOrderResult?.order || 0;
      const newOrder = maxExistingOrder + 1;
      console.log('Creating exercise block:', { sessionId, exerciseId: exercise.id, order: newOrder, suggestedWeight, maxExistingOrder });
      
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

  // Toggle exercise selection for multi-add
  const toggleExerciseSelection = (exercise: AvailableExercise) => {
    setSelectedExercisesToAdd(prev => {
      const isSelected = prev.some(e => e.id === exercise.id);
      if (isSelected) {
        return prev.filter(e => e.id !== exercise.id);
      } else {
        return [...prev, exercise];
      }
    });
  };

  // Add all selected exercises
  const handleAddSelectedExercises = async () => {
    if (selectedExercisesToAdd.length === 0) return;
    
    setIsAddingExercise(true);
    
    // Add exercises one by one
    for (const exercise of selectedExercisesToAdd) {
      await handleAddExercise(exercise);
    }
    
    // Clear selections and close modal
    setSelectedExercisesToAdd([]);
    setShowAddExercise(false);
    setShowMuscleDropdown(false);
    setSelectedMuscleFilter(null);
    setExerciseSearch('');
    setIsAddingExercise(false);
  };

  // Close modal and clear selections
  const handleCloseAddExerciseModal = () => {
    setShowAddExercise(false);
    setShowMuscleDropdown(false);
    setSelectedExercisesToAdd([]);
    setSelectedMuscleFilter(null);
    setExerciseSearch('');
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
    // Skip showing loading screen if coming from quick workout page (already saw one)
    if (fromCreate) {
      return null;
    }
    return (
      <div className="max-w-lg mx-auto py-8 flex flex-col items-center justify-center min-h-[400px]">
        <LoadingAnimation type="random" size="lg" />
        <p className="mt-4 text-surface-400">Loading workout...</p>
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
          onSkip={() => handleCheckInComplete()}
          onSkipPermanently={handleSkipCheckInPermanently}
          unit={preferences.units}
          todayNutrition={todayNutrition || undefined}
          userGoal={userGoal}
        />
      </div>
    );
  }

  if (phase === 'summary' && session) {
    // Check if this is a previously completed workout (viewing from history)
    const isViewingCompleted = session.state === 'completed' && !!session.completedAt;
    
    // Build exercise histories for PR detection in summary
    const exerciseHistoriesForSummary = Object.entries(exerciseHistories).reduce((acc, [exerciseId, history]) => {
      acc[exerciseId] = {
        exerciseId,
        exerciseName: blocks.find(b => b.exerciseId === exerciseId)?.exercise?.name || 'Exercise',
        previousBest: history.personalRecord ? {
          weight: history.personalRecord.weightKg,
          reps: history.personalRecord.reps,
          e1rm: history.personalRecord.e1rm,
        } : undefined,
      };
      return acc;
    }, {} as Record<string, { exerciseId: string; exerciseName: string; previousBest?: { weight: number; reps: number; e1rm: number } }>);
    
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
          exerciseHistories={exerciseHistoriesForSummary}
          unit={preferences.units}
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

  // Empty workout - show standard header with add button (no extra page)
  if (!currentBlock || !currentExercise) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 pb-8">
        {/* Same header as normal workout */}
        <div className="flex items-center justify-between sticky top-0 z-10 bg-surface-950/95 backdrop-blur py-4 -mx-4 px-4">
          <div>
            <h1 className="text-2xl font-bold text-surface-100">Workout</h1>
            <p className="text-surface-400">0 of 0 sets completed</p>
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

        {/* Progress bar (empty) */}
        <div className="bg-surface-800 rounded-full h-2 overflow-hidden">
          <div className="bg-primary-500 h-full transition-all duration-300" style={{ width: '0%' }} />
        </div>

        {/* Empty state hint */}
        <div className="text-center py-12 text-surface-500">
          <p>Tap <button onClick={handleOpenAddExercise} className="text-primary-400 font-medium hover:text-primary-300 underline cursor-pointer">+ Add</button> to add exercises</p>
        </div>

        {/* Add Exercise Modal */}
        {showAddExercise && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div 
              className="absolute inset-0 bg-black/60"
              onClick={handleCloseAddExerciseModal}
            />
            <div className="relative w-full max-w-lg max-h-[80vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-surface-800 flex items-center justify-between">
                <button
                  onClick={handleCloseAddExerciseModal}
                  className="p-2 text-surface-400 hover:text-surface-200 -ml-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
                <button
                  onClick={handleAddSelectedExercises}
                  disabled={selectedExercisesToAdd.length === 0 || isAddingExercise}
                  className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-colors ${
                    selectedExercisesToAdd.length > 0
                      ? 'bg-primary-500 text-white hover:bg-primary-600'
                      : 'bg-surface-700 text-surface-500 cursor-not-allowed'
                  }`}
                >
                  {isAddingExercise ? 'Adding...' : `Add${selectedExercisesToAdd.length > 0 ? ` (${selectedExercisesToAdd.length})` : ''}`}
                </button>
              </div>
              
              {/* Search and Filters */}
              <div className="p-4 border-b border-surface-800 space-y-3">
                <input
                  type="text"
                  value={exerciseSearch}
                  onChange={(e) => setExerciseSearch(e.target.value)}
                  placeholder="Search exercises..."
                  className="w-full px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500"
                />

                {/* Body Part Dropdown and Sort Button */}
                <div className="flex gap-2">
                  {/* Body Part Dropdown */}
                  <div className="relative flex-1">
                    <button
                      onClick={() => { setShowMuscleDropdown(!showMuscleDropdown); setShowSortDropdown(false); }}
                      className="w-full flex items-center justify-between px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 hover:bg-surface-700 transition-colors"
                    >
                      <span className={selectedMuscleFilter ? 'capitalize' : 'text-surface-400'}>
                        {selectedMuscleFilter || 'Any Body Part'}
                      </span>
                      <svg className={`w-4 h-4 text-surface-400 transition-transform ${showMuscleDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {/* Dropdown Menu */}
                    {showMuscleDropdown && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                        <button
                          onClick={() => { setSelectedMuscleFilter(null); setShowMuscleDropdown(false); }}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                            !selectedMuscleFilter ? 'text-primary-400' : 'text-surface-200'
                          }`}
                        >
                          <span>Any Body Part</span>
                          {!selectedMuscleFilter && (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        {(() => {
                          const muscles = Array.from(new Set(availableExercises.map(ex => ex.primary_muscle).filter(Boolean))).sort();
                          return muscles.map(muscle => (
                            <button
                              key={muscle}
                              onClick={() => { setSelectedMuscleFilter(muscle!); setShowMuscleDropdown(false); }}
                              className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors capitalize flex items-center justify-between ${
                                selectedMuscleFilter === muscle ? 'text-primary-400' : 'text-surface-200'
                              }`}
                            >
                              <span>{muscle}</span>
                              {selectedMuscleFilter === muscle && (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          ));
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Sort Button */}
                  <div className="relative">
                    <button
                      onClick={() => { setShowSortDropdown(!showSortDropdown); setShowMuscleDropdown(false); }}
                      className="flex items-center justify-center px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
                      title="Sort exercises"
                    >
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                    </button>

                    {/* Sort Dropdown */}
                    {showSortDropdown && (
                      <div className="absolute top-full right-0 mt-1 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10">
                        <button
                          onClick={() => { setExerciseSortOption('frequency'); setShowSortDropdown(false); }}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                            exerciseSortOption === 'frequency' ? 'text-primary-400' : 'text-surface-200'
                          }`}
                        >
                          <span>Most Frequent</span>
                          {exerciseSortOption === 'frequency' && (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => { setExerciseSortOption('recent'); setShowSortDropdown(false); }}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                            exerciseSortOption === 'recent' ? 'text-primary-400' : 'text-surface-200'
                          }`}
                        >
                          <span>Recently Done</span>
                          {exerciseSortOption === 'recent' && (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => { setExerciseSortOption('name'); setShowSortDropdown(false); }}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                            exerciseSortOption === 'name' ? 'text-primary-400' : 'text-surface-200'
                          }`}
                        >
                          <span>Name (A-Z)</span>
                          {exerciseSortOption === 'name' && (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              {/* Exercise List */}
              <div className="flex-1 overflow-y-auto">
                {(() => {
                  let filteredExercises = availableExercises;
                  
                  // Filter by muscle
                  if (selectedMuscleFilter) {
                    filteredExercises = filteredExercises.filter(ex => ex.primary_muscle === selectedMuscleFilter);
                  }
                  
                  // Filter by search
                  if (exerciseSearch) {
                    filteredExercises = filteredExercises.filter(ex => 
                      ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
                    );
                  }
                  
                  // Sort based on selected option
                  filteredExercises = [...filteredExercises].sort((a, b) => {
                    switch (exerciseSortOption) {
                      case 'frequency': {
                        // Sort by frequency (highest first), then by name for ties
                        const freqA = frequentExerciseIds.get(a.id) || 0;
                        const freqB = frequentExerciseIds.get(b.id) || 0;
                        if (freqB !== freqA) return freqB - freqA;
                        return a.name.localeCompare(b.name);
                      }
                      case 'recent': {
                        // Sort by most recently done first, then by name for ties
                        const dateA = lastDoneExercises.get(a.id);
                        const dateB = lastDoneExercises.get(b.id);
                        // Exercises without a date go to the bottom
                        if (!dateA && !dateB) return a.name.localeCompare(b.name);
                        if (!dateA) return 1;
                        if (!dateB) return -1;
                        return dateB.getTime() - dateA.getTime();
                      }
                      case 'name':
                      default:
                        return a.name.localeCompare(b.name);
                    }
                  });
                  
                  if (availableExercises.length === 0) {
                    return <p className="text-center text-surface-400 py-8">Loading exercises...</p>;
                  }
                  
                  if (filteredExercises.length === 0) {
                    return <p className="text-center text-surface-400 py-8">No exercises found</p>;
                  }
                  
                  return filteredExercises.map((exercise) => {
                    const isSelected = selectedExercisesToAdd.some(e => e.id === exercise.id);
                    return (
                      <button
                        key={exercise.id}
                        onClick={() => toggleExerciseSelection(exercise)}
                        disabled={isAddingExercise}
                        className={`w-full flex items-center justify-between p-4 transition-colors text-left disabled:opacity-50 border-b border-surface-800/50 ${
                          isSelected ? 'bg-primary-500/10' : 'hover:bg-surface-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-surface-200">{exercise.name}</span>
                          {frequentExerciseIds.has(exercise.id) && (
                            <span className="text-amber-400 text-sm">★</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${
                            exercise.mechanic === 'compound' 
                              ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' 
                              : 'bg-surface-700 text-surface-400'
                          }`}>
                            {exercise.mechanic}
                          </span>
                          {isSelected && (
                            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
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
      {/* Auto-adjust message */}
      {autoAdjustMessage && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-full mx-4">
          <div className="bg-primary-500/20 backdrop-blur-sm border border-primary-500/30 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
            <span className="text-primary-400 text-lg">🔄</span>
            <p className="text-sm text-primary-200 flex-1">{autoAdjustMessage}</p>
            <button 
              onClick={() => setAutoAdjustMessage(null)}
              className="text-primary-400 hover:text-primary-200"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      
      {/* Workout header */}
      <div className="flex items-center justify-between sticky top-0 z-10 bg-surface-950/95 backdrop-blur py-4 -mx-4 px-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-100">Workout</h1>
          <p className="text-surface-400">
            {totalCompletedSets} of {totalPlannedSets} sets completed
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAllCollapsed(!allCollapsed)}
            className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium ${
              allCollapsed 
                ? 'bg-primary-500/20 hover:bg-primary-500/30 text-primary-400' 
                : 'bg-surface-800 hover:bg-surface-700 text-surface-400'
            }`}
            title={allCollapsed ? 'Expand all exercises' : 'Collapse all exercises'}
          >
            {allCollapsed ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                <span className="hidden sm:inline">Expand</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
                <span className="hidden sm:inline">Collapse</span>
              </>
            )}
          </button>
          <button
            onClick={() => setShowInjuryModal(true)}
            className={`px-3 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium ${
              temporaryInjuries.length > 0
                ? 'bg-warning-500/20 hover:bg-warning-500/30 text-warning-400'
                : 'bg-surface-800 hover:bg-surface-700 text-surface-400'
            }`}
            title="Report pain or injury"
          >
            <span>🤕</span>
            <span className="hidden sm:inline">{temporaryInjuries.length > 0 ? 'Injured' : 'Hurt?'}</span>
          </button>
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

      {/* Coach Message - only show if AI coach notes are enabled */}
      {coachMessage && aiCoachNotesEnabled && (
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

              {/* AI-Powered Coach Notes - only show if enabled */}
              {aiCoachNotesEnabled && (
                <>
                  {isLoadingAiNotes ? (
                    <div className="ml-13 p-3 rounded-lg bg-surface-800 border border-surface-700">
                      <div className="flex items-center gap-3">
                        <LoadingAnimation type="dots" size="sm" />
                        <p className="text-sm text-surface-400">Your coach is reviewing your session...</p>
                      </div>
                    </div>
                  ) : aiCoachNotes ? (
                    <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                      <div className="flex items-start gap-2">
                        <span className="text-primary-400 text-lg mt-0.5">💬</span>
                        <p className="text-sm text-primary-300 leading-relaxed">
                          {aiCoachNotes}
                        </p>
                      </div>
                    </div>
                  ) : coachMessage.personalizedInsight && (
                    <div className="ml-13 p-3 rounded-lg bg-primary-500/10 border border-primary-500/20">
                      <p className="text-sm text-primary-300">
                        {coachMessage.personalizedInsight}
                      </p>
                    </div>
                  )}
                </>
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

      {/* Rest timer control panel - fixed at bottom */}
      {showRestTimer && (
        <RestTimerControlPanel
          isRunning={restTimer.isRunning}
          isFinished={restTimer.isFinished}
          onToggle={restTimer.toggle}
          onAddTime={restTimer.addTime}
          onReset={restTimer.reset}
          onSkip={() => {
            restTimer.skip();
            // Keep timer visible briefly to show "Rested for X" message
            setTimeout(() => {
              setShowRestTimer(false);
              setRestTimerDuration(null);
            }, 2000); // Show for 2 seconds
          }}
          isVisible={restTimerPanelVisible}
          onVisibilityChange={setRestTimerPanelVisible}
        />
      )}

      {/* All exercises list */}
      <div className="space-y-4" ref={exerciseListRef}>
        <p className="text-xs text-surface-500">💡 Hold the ≡ handle to drag reorder</p>
        {blocks.map((block, index) => {
          const blockSets = getSetsForBlock(block.id);
          const isComplete = blockSets.length >= block.targetSets;
          const isCurrent = index === currentBlockIndex;
          const nextBlock = index < blocks.length - 1 ? blocks[index + 1] : null;
          const isInSuperset = block.supersetGroupId !== null;
          const isSupersetWithNext = nextBlock && block.supersetGroupId && block.supersetGroupId === nextBlock.supersetGroupId;
          const isPast = index < currentBlockIndex;
          const isFuture = index > currentBlockIndex;
          const isBlockCollapsed = collapsedBlocks.has(block.id);
          const isBeingDragged = draggedBlockIndex === index;
          const isDragTarget = dragOverBlockIndex === index && draggedBlockIndex !== index;

          // Calculate if this item should be visually shifted during drag
          let translateY = 0;
          if (isDraggingBlock && draggedBlockIndex !== null && dragOverBlockIndex !== null && !isBeingDragged) {
            const itemHeight = 60; // Approximate height of collapsed item
            if (draggedBlockIndex < dragOverBlockIndex) {
              // Dragging down: items between original and target shift up
              if (index > draggedBlockIndex && index <= dragOverBlockIndex) {
                translateY = -itemHeight;
              }
            } else if (draggedBlockIndex > dragOverBlockIndex) {
              // Dragging up: items between target and original shift down
              if (index >= dragOverBlockIndex && index < draggedBlockIndex) {
                translateY = itemHeight;
              }
            }
          }

          return (
            <React.Fragment key={block.id}>
            <div
              id={`exercise-${index}`}
              data-block-index={index}
              style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
              className={`transition-transform duration-200 ease-out ${
                isCurrent ? '' : 'opacity-80'
              } ${isInSuperset ? 'border-l-2 border-cyan-500/50 pl-2' : ''} ${
                isBeingDragged ? 'opacity-0 pointer-events-none' : ''
              }`}
              onClick={(e) => {
                // Only activate if not already current and click wasn't on an interactive element
                if (!isCurrent && !isDraggingBlock) {
                  const target = e.target as HTMLElement;
                  const isInteractive = target.closest('button, input, select, textarea, a, [data-drag-handle]');
                  if (!isInteractive) {
                    setCurrentBlockIndex(index);
                    setCurrentSetNumber(blockSets.length + 1);
                  }
                }
              }}
            >
              {/* Exercise header with status */}
              <div 
                className={`flex items-center gap-3 mb-2 ${!isCurrent ? 'cursor-pointer' : ''}`}
              >
                {/* Drag handle - long press here to reorder */}
                <div
                  data-drag-handle
                  className="flex flex-col gap-0.5 text-surface-500 cursor-grab active:cursor-grabbing p-2 -m-1 touch-none"
                  onTouchStart={(e) => {
                    e.stopPropagation();
                    handleBlockLongPressStart(index, e.touches[0].clientY);
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    handleBlockLongPressEnd();
                    handleBlockDragEnd();
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleBlockLongPressStart(index, e.clientY);
                  }}
                  onMouseUp={(e) => {
                    e.stopPropagation();
                    handleBlockLongPressEnd();
                    handleBlockDragEnd();
                  }}
                  onMouseLeave={handleBlockLongPressEnd}
                >
                  <div className="w-5 h-0.5 bg-current rounded" />
                  <div className="w-5 h-0.5 bg-current rounded" />
                  <div className="w-5 h-0.5 bg-current rounded" />
                </div>
                
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
                  {(() => {
                    const injuryRisk = getExerciseInjuryRisk(block.exercise, temporaryInjuries);
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <p className={`font-medium ${isCurrent ? 'text-surface-100' : 'text-surface-300'}`}>
                            {block.exercise.name}
                            {block.exercise.equipmentRequired && block.exercise.equipmentRequired.length > 0 && (
                              <span className="text-surface-500 font-normal text-sm ml-1">
                                ({block.exercise.equipmentRequired[0]})
                              </span>
                            )}
                          </p>
                          {/* Tier badge */}
                          {block.exercise.hypertrophyScore?.tier && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                              block.exercise.hypertrophyScore.tier === 'S' 
                                ? 'bg-gradient-to-r from-amber-500 to-yellow-400 text-black' 
                                : block.exercise.hypertrophyScore.tier === 'A' 
                                  ? 'bg-emerald-500/30 text-emerald-400'
                                  : block.exercise.hypertrophyScore.tier === 'B'
                                    ? 'bg-blue-500/30 text-blue-400'
                                    : 'bg-surface-600 text-surface-400'
                            }`}>
                              {block.exercise.hypertrophyScore.tier}
                            </span>
                          )}
                          {/* Superset badge */}
                          {block.supersetGroupId && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-cyan-500/20 text-cyan-400">
                              SS{block.supersetOrder}
                            </span>
                          )}
                          {/* Injury risk warning */}
                          {injuryRisk.isRisky && (
                            <span 
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                                injuryRisk.severity === 3 
                                  ? 'bg-danger-500/20 text-danger-400' 
                                  : injuryRisk.severity === 2
                                    ? 'bg-warning-500/20 text-warning-400'
                                    : 'bg-surface-600 text-surface-400'
                              }`}
                              title={injuryRisk.reasons.join(', ')}
                            >
                              ⚠️ {injuryRisk.severity === 3 ? 'Avoid' : injuryRisk.severity === 2 ? 'Caution' : 'Note'}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          {blockSets.length}/{block.targetSets} sets • {block.targetRepRange[0]}-{block.targetRepRange[1]} reps
                        </p>
                        {/* Show injury warning detail */}
                        {injuryRisk.isRisky && isCurrent && (
                          <div className={`mt-1 text-xs ${
                            injuryRisk.severity === 3 ? 'text-danger-400' : 'text-warning-400'
                          }`}>
                            ⚠️ {injuryRisk.reasons[0]}
                            <button 
                              className="ml-2 underline font-medium"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Open page-level swap modal
                                setSwapTargetBlockId(block.id);
                                setSwapSearchQuery('');
                                // Fetch exercises if not loaded
                                if (availableExercises.length === 0) {
                                  fetchExercises();
                                }
                                setShowPageLevelSwapModal(true);
                              }}
                            >
                              Swap exercise?
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
                {isCurrent && (
                  <Badge variant="info" size="sm">Current</Badge>
                )}
                {isComplete && !isCurrent && (
                  <Badge variant="success" size="sm">Done</Badge>
                )}
                {/* Collapse/expand button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleBlockCollapse(block.id);
                  }}
                  className="p-2 text-surface-400 hover:text-surface-200 transition-colors"
                >
                  <svg 
                    className={`w-5 h-5 transition-transform ${isBlockCollapsed ? '' : 'rotate-180'}`}
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Expanded content - show when not globally collapsed and not individually collapsed */}
              {!allCollapsed && !isBlockCollapsed && (() => {
                // Calculate AI recommended weight first so it can be used for warmup
                const exerciseNote = coachMessage?.exerciseNotes.find(
                  n => n.name === block.exercise.name
                );
                const aiRecommendedWeight = exerciseNote?.weightRec?.recommendedWeight || 0;
                const effectiveWorkingWeight = block.targetWeightKg > 0 ? block.targetWeightKg : aiRecommendedWeight;
                
                return (
                <div className="mt-3 space-y-3">
                  {/* Exercise card with integrated set inputs and warmups - hideHeader on mobile since name shows above */}
                  <ExerciseCard
                    hideHeader
                    exercise={block.exercise}
                    block={addingExtraSet === block.id 
                      ? { ...block, targetSets: block.targetSets + 1 }  // Add one more set when adding extra
                      : block
                    }
                    sets={blockSets}
                    onSetComplete={(data) => {
                      handleSetComplete(data);
                      setAddingExtraSet(null);
                    }}
                    onWarmupComplete={(restSeconds) => {
                      setRestTimerDuration(restSeconds);
                      setShowRestTimer(true);
                      setRestTimerPanelVisible(true); // Show panel when timer starts
                      restTimer.start(restSeconds);
                    }}
                    showRestTimer={showRestTimer && isCurrent}
                    timerSeconds={restTimer.seconds}
                    timerInitialSeconds={restTimer.initialSeconds}
                    timerIsRunning={restTimer.isRunning}
                    timerIsFinished={restTimer.isFinished}
                    timerIsSkipped={restTimer.isSkipped}
                    timerRestedSeconds={restTimer.restedSeconds}
                    onShowTimerControls={() => setRestTimerPanelVisible(true)}
                    onSetEdit={handleSetEdit}
                    onSetDelete={handleDeleteSet}
                    onTargetSetsChange={(newSets) => handleTargetSetsChange(block.id, newSets)}
                    onExerciseSwap={(newEx) => {
                      handleExerciseSwap(block.id, newEx);
                      setShowSwapForInjury(null); // Clear after swap
                    }}
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
                    isActive={isCurrent}
                    unit={preferences.units}
                    recommendedWeight={aiRecommendedWeight}
                    exerciseHistory={exerciseHistories[block.exerciseId]}
                    warmupSets={(() => {
                      if (!isCurrent) return undefined;
                      
                      // Check if this block has warmup protocol defined
                      if (block.warmupProtocol && block.warmupProtocol.length > 0) {
                        return block.warmupProtocol;
                      }
                      
                      // Check if this muscle group has already been warmed up
                      // (any completed sets for exercises in this muscle group)
                      const muscleGroup = block.exercise.primaryMuscle;
                      const muscleGroupExerciseIds = blocks
                        .filter(b => b.exercise.primaryMuscle === muscleGroup)
                        .map(b => b.id);
                      
                      const hasCompletedSetsForMuscle = completedSets.some(
                        s => muscleGroupExerciseIds.includes(s.exerciseBlockId)
                      );
                      
                      // If muscle already warmed up or has completed sets, no warmups needed
                      if (hasCompletedSetsForMuscle) return undefined;
                      
                      // Check if another exercise in this muscle group has warmups defined
                      const blockWithWarmups = blocks.find(
                        b => b.exercise.primaryMuscle === muscleGroup && 
                             b.warmupProtocol && 
                             b.warmupProtocol.length > 0
                      );
                      
                      // Use the warmups from the first exercise of this muscle group
                      if (blockWithWarmups && blockWithWarmups.warmupProtocol) {
                        return blockWithWarmups.warmupProtocol;
                      }
                      
                      // Generate warmups dynamically for compound exercises
                      if (block.exercise.mechanic === 'compound') {
                        return generateWarmupProtocol({
                          workingWeight: effectiveWorkingWeight,
                          exercise: block.exercise,
                          isFirstExercise: index === 0,
                        });
                      }
                      
                      return undefined;
                    })()}
                    workingWeight={effectiveWorkingWeight}
                    showSwapOnMount={showSwapForInjury === block.id}
                    currentInjuries={temporaryInjuries}
                    frequentExerciseIds={frequentExerciseIds}
                  />

                  {/* Exercise complete actions - only show for current exercise */}
                  {isCurrent && isComplete && addingExtraSet !== block.id && (
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

              {/* Collapsed preview - show when all collapsed */}
              {allCollapsed && (
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
            
            {/* Superset link button between exercises */}
            {index < blocks.length - 1 && (
              <div className="flex justify-center -my-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSuperset(index);
                  }}
                  className={`px-3 py-1 text-xs rounded-full transition-all flex items-center gap-1 ${
                    isSupersetWithNext
                      ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                      : 'bg-surface-800 text-surface-500 hover:bg-surface-700 hover:text-surface-400'
                  }`}
                  title={isSupersetWithNext ? 'Remove superset' : 'Link as superset'}
                >
                  {isSupersetWithNext ? (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      Superset
                    </>
                  ) : (
                    <>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      Link Superset
                    </>
                  )}
                </button>
              </div>
            )}
          </React.Fragment>
          );
        })}
      </div>

      {/* Floating drag preview */}
      {isDraggingBlock && draggedBlockIndex !== null && dragPosition && (
        <div
          className="fixed pointer-events-none z-50 transition-transform duration-75"
          style={{
            left: dragPosition.x,
            top: dragPosition.y,
            width: draggedBlockRect?.width ?? 'auto',
          }}
        >
          <div className="bg-surface-900 rounded-xl p-3 shadow-2xl shadow-black/50 ring-2 ring-primary-500 scale-[1.02]">
            <div className="flex items-center gap-3">
              {/* Drag handle */}
              <div className="flex flex-col gap-0.5 text-surface-400 p-1">
                <div className="w-4 h-0.5 bg-current rounded" />
                <div className="w-4 h-0.5 bg-current rounded" />
                <div className="w-4 h-0.5 bg-current rounded" />
              </div>
              {/* Exercise number circle */}
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-primary-500 text-white">
                {draggedBlockIndex + 1}
              </div>
              {/* Exercise name */}
              <div className="flex-1">
                <p className="font-medium text-surface-100">
                  {blocks[draggedBlockIndex]?.exercise?.name}
                </p>
                <p className="text-xs text-surface-500">
                  {getSetsForBlock(blocks[draggedBlockIndex]?.id).length}/{blocks[draggedBlockIndex]?.targetSets} sets
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
            onClick={handleCloseAddExerciseModal}
          />
          
          {/* Modal */}
          <div className="relative w-full max-w-lg max-h-[80vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <button
                onClick={handleCloseAddExerciseModal}
                className="p-2 text-surface-400 hover:text-surface-200 -ml-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <h2 className="text-lg font-semibold text-surface-100">Add Exercise</h2>
              <button
                onClick={handleAddSelectedExercises}
                disabled={selectedExercisesToAdd.length === 0 || isAddingExercise}
                className={`px-3 py-1.5 rounded-lg font-medium text-sm transition-colors ${
                  selectedExercisesToAdd.length > 0
                    ? 'bg-primary-500 text-white hover:bg-primary-600'
                    : 'bg-surface-700 text-surface-500 cursor-not-allowed'
                }`}
              >
                {isAddingExercise ? 'Adding...' : `Add${selectedExercisesToAdd.length > 0 ? ` (${selectedExercisesToAdd.length})` : ''}`}
              </button>
            </div>

            {/* Search and Filters */}
            <div className="p-4 space-y-3 border-b border-surface-800">
              <Input
                placeholder="Search exercises..."
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
              />

              {/* Body Part Dropdown and Sort Button */}
              <div className="flex gap-2">
                {/* Body Part Dropdown */}
                <div className="relative flex-1">
                  <button
                    onClick={() => { setShowMuscleDropdown(!showMuscleDropdown); setShowSortDropdown(false); }}
                    className="w-full flex items-center justify-between px-4 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 hover:bg-surface-700 transition-colors"
                  >
                    <span className={selectedMuscleFilter ? 'capitalize' : 'text-surface-400'}>
                      {selectedMuscleFilter || 'Any Body Part'}
                    </span>
                    <svg className={`w-4 h-4 text-surface-400 transition-transform ${showMuscleDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Dropdown Menu */}
                  {showMuscleDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                      <button
                        onClick={() => { setSelectedMuscleFilter(null); setShowMuscleDropdown(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                          !selectedMuscleFilter ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>Any Body Part</span>
                        {!selectedMuscleFilter && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      {(() => {
                        const muscles = Array.from(new Set(availableExercises.map(ex => ex.primary_muscle).filter(Boolean))).sort();
                        return muscles.map(muscle => (
                          <button
                            key={muscle}
                            onClick={() => { setSelectedMuscleFilter(muscle!); setShowMuscleDropdown(false); }}
                            className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors capitalize flex items-center justify-between ${
                              selectedMuscleFilter === muscle ? 'text-primary-400' : 'text-surface-200'
                            }`}
                          >
                            <span>{muscle}</span>
                            {selectedMuscleFilter === muscle && (
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ));
                      })()}
                    </div>
                  )}
                </div>

                {/* Sort Button */}
                <div className="relative">
                  <button
                    onClick={() => { setShowSortDropdown(!showSortDropdown); setShowMuscleDropdown(false); }}
                    className="flex items-center justify-center px-3 py-2 bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors"
                    title="Sort exercises"
                  >
                    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                  </button>

                  {/* Sort Dropdown */}
                  {showSortDropdown && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-10">
                      <button
                        onClick={() => { setExerciseSortOption('frequency'); setShowSortDropdown(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                          exerciseSortOption === 'frequency' ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>Most Frequent</span>
                        {exerciseSortOption === 'frequency' && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => { setExerciseSortOption('recent'); setShowSortDropdown(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                          exerciseSortOption === 'recent' ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>Recently Done</span>
                        {exerciseSortOption === 'recent' && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <button
                        onClick={() => { setExerciseSortOption('name'); setShowSortDropdown(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-surface-700 transition-colors flex items-center justify-between ${
                          exerciseSortOption === 'name' ? 'text-primary-400' : 'text-surface-200'
                        }`}
                      >
                        <span>Name (A-Z)</span>
                        {exerciseSortOption === 'name' && (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}
                </div>
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
            <div className="flex-1 overflow-y-auto">
              {(() => {
                let filteredExercises = availableExercises;
                
                // Filter by muscle
                if (selectedMuscleFilter) {
                  filteredExercises = filteredExercises.filter(ex => ex.primary_muscle === selectedMuscleFilter);
                }
                
                // Filter by search
                if (exerciseSearch) {
                  filteredExercises = filteredExercises.filter(ex => 
                    ex.name.toLowerCase().includes(exerciseSearch.toLowerCase())
                  );
                }
                
                // Sort based on selected option
                filteredExercises = [...filteredExercises].sort((a, b) => {
                  switch (exerciseSortOption) {
                    case 'frequency': {
                      // Sort by frequency (highest first), then by name for ties
                      const freqA = frequentExerciseIds.get(a.id) || 0;
                      const freqB = frequentExerciseIds.get(b.id) || 0;
                      if (freqB !== freqA) return freqB - freqA;
                      return a.name.localeCompare(b.name);
                    }
                    case 'recent': {
                      // Sort by most recently done first, then by name for ties
                      const dateA = lastDoneExercises.get(a.id);
                      const dateB = lastDoneExercises.get(b.id);
                      // Exercises without a date go to the bottom
                      if (!dateA && !dateB) return a.name.localeCompare(b.name);
                      if (!dateA) return 1;
                      if (!dateB) return -1;
                      return dateB.getTime() - dateA.getTime();
                    }
                    case 'name':
                    default:
                      return a.name.localeCompare(b.name);
                  }
                });

                if (availableExercises.length === 0) {
                  return <p className="text-center text-surface-500 py-8">Loading exercises...</p>;
                }
                
                if (filteredExercises.length === 0) {
                  return <p className="text-center text-surface-500 py-8">No exercises found</p>;
                }
                
                return filteredExercises.map((exercise) => {
                  const isSelected = selectedExercisesToAdd.some(e => e.id === exercise.id);
                  return (
                    <button
                      key={exercise.id}
                      onClick={() => toggleExerciseSelection(exercise)}
                      disabled={isAddingExercise}
                      className={`w-full flex items-center justify-between p-4 transition-colors text-left disabled:opacity-50 border-b border-surface-800/50 ${
                        isSelected ? 'bg-primary-500/10' : 'hover:bg-surface-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-surface-200">{exercise.name}</span>
                        {frequentExerciseIds.has(exercise.id) && (
                          <span className="text-amber-400 text-sm">★</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          exercise.mechanic === 'compound' 
                            ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30' 
                            : 'bg-surface-700 text-surface-400'
                        }`}>
                          {exercise.mechanic}
                        </span>
                        {isSelected && (
                          <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                });
              })()}
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

      {/* Injury Report Modal */}
      {showInjuryModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div 
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowInjuryModal(false)}
          />
          
          <div className="relative w-full max-w-md max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-surface-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🤕</span>
                <h2 className="text-lg font-semibold text-surface-100">Report Pain/Injury</h2>
              </div>
              <button
                onClick={() => setShowInjuryModal(false)}
                className="p-2 text-surface-400 hover:text-surface-200"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <p className="text-sm text-surface-400">
                Tell us about any pain or discomfort. We&apos;ll suggest exercise swaps to avoid aggravating it.
              </p>

              {/* Current injuries */}
              {temporaryInjuries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-surface-300">Currently reported:</p>
                  <div className="flex flex-wrap gap-2">
                    {temporaryInjuries.map(injury => {
                      const areaLabels: Record<string, string> = {
                        lower_back: '🔻 Lower Back', upper_back: '🔺 Upper Back', neck: '🦴 Neck',
                        shoulder_left: '💪 Left Shoulder', shoulder_right: '💪 Right Shoulder',
                        elbow_left: '🦾 Left Elbow', elbow_right: '🦾 Right Elbow',
                        wrist_left: '🤚 Left Wrist', wrist_right: '🤚 Right Wrist',
                        hip_left: '🦵 Left Hip', hip_right: '🦵 Right Hip',
                        knee_left: '🦿 Left Knee', knee_right: '🦿 Right Knee',
                        ankle_left: '🦶 Left Ankle', ankle_right: '🦶 Right Ankle',
                        chest: '❤️ Chest', other: '⚠️ Other'
                      };
                      const severityLabels = ['Mild', 'Moderate', 'Significant'];
                      return (
                        <div 
                          key={injury.area}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                            injury.severity === 3 
                              ? 'bg-danger-500/20 text-danger-400' 
                              : injury.severity === 2 
                                ? 'bg-warning-500/20 text-warning-400'
                                : 'bg-surface-700 text-surface-300'
                          }`}
                        >
                          <span>{areaLabels[injury.area] || injury.area}</span>
                          <span className="text-xs opacity-70">({severityLabels[injury.severity - 1]})</span>
                          <button
                            onClick={() => setTemporaryInjuries(temporaryInjuries.filter(i => i.area !== injury.area))}
                            className="ml-1 p-0.5 hover:bg-surface-600 rounded-full"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Add new injury */}
              <div className="space-y-3 p-4 bg-surface-800/50 rounded-lg">
                <p className="text-xs font-medium text-surface-300">Add an issue:</p>
                
                <div>
                  <label className="block text-xs text-surface-400 mb-1">Area affected</label>
                  <select
                    value={selectedInjuryArea}
                    onChange={(e) => setSelectedInjuryArea(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-700 border border-surface-600 rounded-lg text-surface-100 text-sm"
                  >
                    <option value="">Select area...</option>
                    <optgroup label="Back & Core">
                      <option value="lower_back">🔻 Lower Back</option>
                      <option value="upper_back">🔺 Upper Back</option>
                      <option value="neck">🦴 Neck</option>
                      <option value="chest">❤️ Chest</option>
                    </optgroup>
                    <optgroup label="Upper Body">
                      <option value="shoulder_left">💪 Left Shoulder</option>
                      <option value="shoulder_right">💪 Right Shoulder</option>
                      <option value="elbow_left">🦾 Left Elbow</option>
                      <option value="elbow_right">🦾 Right Elbow</option>
                      <option value="wrist_left">🤚 Left Wrist</option>
                      <option value="wrist_right">🤚 Right Wrist</option>
                    </optgroup>
                    <optgroup label="Lower Body">
                      <option value="hip_left">🦵 Left Hip</option>
                      <option value="hip_right">🦵 Right Hip</option>
                      <option value="knee_left">🦿 Left Knee</option>
                      <option value="knee_right">🦿 Right Knee</option>
                      <option value="ankle_left">🦶 Left Ankle</option>
                      <option value="ankle_right">🦶 Right Ankle</option>
                    </optgroup>
                    <option value="other">⚠️ Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-surface-400 mb-1">Severity</label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(level => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setSelectedInjurySeverity(level as 1 | 2 | 3)}
                        className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${
                          selectedInjurySeverity === level
                            ? level === 3 
                              ? 'bg-danger-500 text-white'
                              : level === 2
                                ? 'bg-warning-500 text-black'
                                : 'bg-primary-500 text-white'
                            : 'bg-surface-700 text-surface-400 hover:bg-surface-600'
                        }`}
                      >
                        {level === 1 ? 'Mild' : level === 2 ? 'Moderate' : 'Significant'}
                      </button>
                    ))}
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    if (selectedInjuryArea && !temporaryInjuries.some(i => i.area === selectedInjuryArea)) {
                      setTemporaryInjuries([...temporaryInjuries, { area: selectedInjuryArea, severity: selectedInjurySeverity }]);
                      setSelectedInjuryArea('');
                      setSelectedInjurySeverity(1);
                    }
                  }}
                  disabled={!selectedInjuryArea || temporaryInjuries.some(i => i.area === selectedInjuryArea)}
                  className="w-full"
                >
                  + Add to List
                </Button>
              </div>

              {/* What will happen info */}
              {temporaryInjuries.length > 0 && (
                <div className="p-3 bg-primary-500/10 border border-primary-500/20 rounded-lg">
                  <p className="text-xs text-primary-400 font-medium mb-1">What happens now?</p>
                  <p className="text-xs text-surface-400">
                    We&apos;ll flag exercises that could aggravate these areas. You can easily swap them for safer alternatives.
                  </p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-surface-800 space-y-2">
              {/* Show risky exercises count */}
              {temporaryInjuries.length > 0 && (
                <div className="text-center text-sm text-surface-400 mb-2">
                  {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).isRisky).length > 0 ? (
                    <span className="text-warning-400">
                      ⚠️ {blocks.filter(b => getExerciseInjuryRisk(b.exercise, temporaryInjuries).severity >= 2).length} exercise(s) may need swapping
                    </span>
                  ) : (
                    <span className="text-success-400">✓ All exercises look safe!</span>
                  )}
                </div>
              )}
              <Button onClick={handleApplyInjuries} className="w-full">
                {temporaryInjuries.length > 0 ? 'Apply & Continue Workout' : 'Close'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Page-level Swap Modal for injury-related swaps */}
      {showPageLevelSwapModal && swapTargetBlockId && (() => {
        const targetBlock = blocks.find(b => b.id === swapTargetBlockId);
        if (!targetBlock) return null;
        
        // Get safe alternatives using the intelligent injury swapper
        const safeAlternatives = availableExercises
          .filter(ex => {
            // Must target same muscle
            if (ex.primary_muscle !== targetBlock.exercise.primaryMuscle) return false;
            // Must not be the current exercise
            if (ex.id === targetBlock.exercise.id) return false;
            // Must not already be in workout
            if (blocks.some(b => b.exercise.id === ex.id)) return false;
            // Check search filter
            if (swapSearchQuery && !ex.name.toLowerCase().includes(swapSearchQuery.toLowerCase())) return false;
            // Check if safe for injuries
            const risk = getExerciseInjuryRisk(
              { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
              temporaryInjuries
            );
            return !risk.isRisky || risk.risk === 'caution';
          })
          .map(ex => {
            const risk = getExerciseInjuryRisk(
              { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
              temporaryInjuries
            );
            return { exercise: ex, risk };
          })
          .sort((a, b) => {
            // Safe first, then caution
            if (a.risk.risk === 'safe' && b.risk.risk !== 'safe') return -1;
            if (a.risk.risk !== 'safe' && b.risk.risk === 'safe') return 1;
            return a.exercise.name.localeCompare(b.exercise.name);
          });
        
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
            <div 
              className="absolute inset-0 bg-black/60"
              onClick={() => setShowPageLevelSwapModal(false)}
            />
            
            <div className="relative w-full max-w-lg max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
              <div className="p-4 border-b border-surface-800">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-surface-100">Swap Exercise</h3>
                    <p className="text-sm text-surface-400">
                      Replace <span className="text-warning-400 font-medium">{targetBlock.exercise.name}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => setShowPageLevelSwapModal(false)}
                    className="p-2 text-surface-400 hover:text-surface-200"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                
                {/* Search */}
                <div className="mt-3">
                  <Input
                    placeholder="Search exercises..."
                    value={swapSearchQuery}
                    onChange={(e) => setSwapSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3">
                {/* Info banner */}
                <div className={`mb-3 p-3 rounded-lg ${
                  safeAlternatives.length > 0 
                    ? 'bg-success-500/10 border border-success-500/20' 
                    : 'bg-warning-500/10 border border-warning-500/20'
                }`}>
                  {safeAlternatives.length > 0 ? (
                    <p className="text-xs text-success-400">
                      ✓ <span className="font-medium">{safeAlternatives.filter(a => a.risk.risk === 'safe').length} safe alternative(s)</span> found for {targetBlock.exercise.primaryMuscle}
                    </p>
                  ) : (
                    <p className="text-xs text-warning-400">
                      ⚠️ No safe alternatives found. Consider skipping this exercise.
                    </p>
                  )}
                </div>
                
                {/* Exercise list */}
                <div className="space-y-1">
                  {safeAlternatives.map(({ exercise: alt, risk }) => (
                    <button
                      key={alt.id}
                      onClick={async () => {
                        // Perform the swap
                        await handleExerciseSwap(swapTargetBlockId, {
                          id: alt.id,
                          name: alt.name,
                          primaryMuscle: alt.primary_muscle,
                          secondaryMuscles: alt.secondary_muscles || [],
                          mechanic: alt.mechanic,
                          defaultRepRange: [8, 12] as [number, number],
                          defaultRir: 2,
                          minWeightIncrementKg: 2.5,
                          formCues: [],
                          commonMistakes: [],
                          setupNote: '',
                          movementPattern: '',
                          equipmentRequired: [],
                        });
                        setShowPageLevelSwapModal(false);
                        setAutoAdjustMessage(`✓ Swapped ${targetBlock.exercise.name} → ${alt.name}`);
                        setTimeout(() => setAutoAdjustMessage(null), 5000);
                      }}
                      className="w-full p-3 text-left rounded-lg hover:bg-surface-800 transition-colors flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-surface-100 truncate">{alt.name}</p>
                          {risk.risk === 'safe' && temporaryInjuries.length > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-500/20 text-success-400">
                              ✓ Safe
                            </span>
                          )}
                          {risk.risk === 'caution' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-500/20 text-warning-400">
                              ⚠️ Caution
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-surface-500 capitalize">
                          {alt.primary_muscle} • {alt.mechanic}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                  
                  {safeAlternatives.length === 0 && (
                    <p className="py-8 text-center text-surface-500">
                      No safe alternatives found for {targetBlock.exercise.primaryMuscle}
                    </p>
                  )}
                </div>
              </div>
              
              {/* Skip option */}
              <div className="p-3 border-t border-surface-800 bg-surface-800/50">
                <button
                  onClick={async () => {
                    await handleExerciseDelete(swapTargetBlockId);
                    setShowPageLevelSwapModal(false);
                    setAutoAdjustMessage(`Removed ${targetBlock.exercise.name} from workout`);
                    setTimeout(() => setAutoAdjustMessage(null), 5000);
                  }}
                  className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Skip this exercise
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
