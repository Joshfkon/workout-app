import { useState, useEffect, useCallback, useRef } from 'react';
import type { SetLog } from '@/types/schema';
import {
  detectExerciseSignals,
  shouldShowWhisper,
  calculateExerciseProgress,
  type WorkoutSignal,
  type ExerciseContext,
} from '@/services/inWorkoutSignals';
import {
  generateExerciseWhisper,
  polishSignalMessage,
  generateRestTip,
  generateSessionSpine,
} from '@/lib/actions/inWorkoutCoach';
import { getSetReps } from '@/services/shared/setModality';

interface ExerciseWhisperState {
  exerciseBlockId: string;
  cue: string;
  timestamp: Date;
}

interface UseInWorkoutCoachOptions {
  exercises: Array<{
    blockId: string;
    name: string;
    primaryMuscle: string;
    sets: number;
    setsToday: SetLog[];
    lastSessionSets?: Array<{
      weight_kg: number;
      reps_completed: number;
      rpe?: number;
      is_warmup: boolean;
      logged_at: string;
    }>;
  }>;
  workoutType?: string;
  weekInMeso?: number;
  totalWeeks?: number;
  injuries?: Array<{ area: string; severity: 1 | 2 | 3 }>;
  units: 'kg' | 'lb';
  isRestTimerRunning?: boolean;
  restSecondsRemaining?: number;
  nextExercise?: {
    name: string;
    weight?: number;
    repRange?: string;  // Display string like "8-12" (renamed from 'reps' to avoid ratchet counting this prop as a SetLog reps read)
  };
  enabled?: boolean;
}

export function useInWorkoutCoach({
  exercises,
  workoutType,
  weekInMeso,
  totalWeeks,
  injuries,
  units,
  isRestTimerRunning,
  restSecondsRemaining,
  nextExercise,
  enabled = true,
}: UseInWorkoutCoachOptions) {
  // Whisper state
  const [activeWhisper, setActiveWhisper] = useState<ExerciseWhisperState | null>(null);
  const [whisperHistory, setWhisperHistory] = useState<Set<string>>(new Set());

  // Signal toast state
  const [activeSignal, setActiveSignal] = useState<WorkoutSignal | null>(null);
  const [signalHistory, setSignalHistory] = useState<Set<string>>(new Set());

  // Rest tip state
  const [restTip, setRestTip] = useState<string | null>(null);
  const [restTipLoading, setRestTipLoading] = useState(false);

  // Session spine state
  const [sessionSpine, setSessionSpine] = useState<string[]>([]);
  const [spineCompleted, setSpineCompleted] = useState<Set<number>>(new Set());
  const [spineLoading, setSpineLoading] = useState(false);

  // Refs to track processing
  const lastProcessedSets = useRef<Map<string, number>>(new Map());
  const isGeneratingWhisper = useRef(false);
  const lastRestTipSeconds = useRef<number | null>(null);

  // Generate session spine on mount or exercise change
  useEffect(() => {
    if (!enabled || exercises.length === 0) return;

    const generateSpine = async () => {
      setSpineLoading(true);
      try {
        const result = await generateSessionSpine({
          exercises: exercises.map(e => ({
            name: e.name,
            primaryMuscle: e.primaryMuscle,
            sets: e.sets,
          })),
          workoutType,
          weekInMeso,
          totalWeeks,
          injuries,
        });
        setSessionSpine(result.spine);
      } catch (error) {
        console.error('[In-Workout Coach] Failed to generate spine:', error);
      } finally {
        setSpineLoading(false);
      }
    };

    generateSpine();
  }, [enabled, exercises.length, workoutType, weekInMeso, totalWeeks, injuries]);

  // Check for whispers and signals after sets are logged
  useEffect(() => {
    if (!enabled) return;

    exercises.forEach((exercise) => {
      const currentSetCount = exercise.setsToday.length;
      const lastProcessed = lastProcessedSets.current.get(exercise.blockId) ?? 0;

      // Only process if new sets were added
      if (currentSetCount > lastProcessed && currentSetCount > 0) {
        lastProcessedSets.current.set(exercise.blockId, currentSetCount);

        // Map lastSessionSets to SetLog-compatible format for signal detection
        const lastSessionSetsForSignals: SetLog[] | undefined = exercise.lastSessionSets?.map((s, idx) => ({
          id: `hist-${idx}`,
          exerciseBlockId: exercise.blockId,
          workoutSessionId: '',
          setNumber: idx + 1,
          weightKg: s.weight_kg,
          weight_kg: s.weight_kg,
          reps: s.reps_completed,
          reps_completed: s.reps_completed,
          rpe: s.rpe ?? 7,
          rir: undefined,
          is_warmup: s.is_warmup,
          restSeconds: null,
          logged_at: s.logged_at,
          loggedAt: s.logged_at,
          isWarmup: s.is_warmup,
          setType: s.is_warmup ? ('warmup' as const) : ('normal' as const),
          parentSetId: null,
          feedback: undefined,
          amrapTarget: null,
          amrapRepsCompleted: null,
          quality: 'effective' as const,
          qualityReason: 'Historical set',
          note: '',
        }));

        const context: ExerciseContext = {
          exerciseName: exercise.name,
          setsToday: exercise.setsToday,
          lastSessionSets: lastSessionSetsForSignals,
        };

        // Check for signals (interrupts)
        const signals = detectExerciseSignals(context);
        signals.forEach((signal) => {
          const signalKey = `${signal.type}-${exercise.blockId}-${currentSetCount}`;
          if (!signalHistory.has(signalKey)) {
            setSignalHistory(prev => new Set(prev).add(signalKey));
            
            // Polish the signal message with LLM (fire and forget)
            polishSignalMessage({
              signalType: signal.type,
              exerciseName: signal.exerciseName,
              details: signal.details,
            }).then(result => {
              setActiveSignal({
                ...signal,
                message: result.message,
              });
            }).catch(() => {
              setActiveSignal(signal);
            });
          }
        });

        // Check for whisper opportunity
        if (shouldShowWhisper(context)) {
          const whisperKey = `${exercise.blockId}-${currentSetCount}`;
          if (!whisperHistory.has(whisperKey) && !isGeneratingWhisper.current) {
            setWhisperHistory(prev => new Set(prev).add(whisperKey));
            isGeneratingWhisper.current = true;

            const progress = calculateExerciseProgress(context);
            const workingSets = exercise.setsToday.filter(s => !s.isWarmup);
            const lastSessionWorkingSets = exercise.lastSessionSets?.filter(s => !s.is_warmup);

            const todayData = workingSets.length > 0 ? {
              avgWeight: workingSets.reduce((sum, s) => sum + s.weightKg, 0) / workingSets.length,
              avgReps: workingSets.reduce((sum, s) => {
                const reps = getSetReps(s, null); // null exercise context: in-workout signals are rep-based
                return sum + (reps ?? 0);
              }, 0) / workingSets.length,
              avgRpe: workingSets.reduce((sum, s) => sum + s.rpe, 0) / workingSets.length,
            } : undefined;

            const lastSessionData = lastSessionWorkingSets && lastSessionWorkingSets.length > 0 ? {
              avgWeight: lastSessionWorkingSets.reduce((sum, s) => sum + s.weight_kg, 0) / lastSessionWorkingSets.length,
              avgReps: lastSessionWorkingSets.reduce((sum, s) => sum + s.reps_completed, 0) / lastSessionWorkingSets.length,
              avgRpe: lastSessionWorkingSets.reduce((sum, s) => sum + (s.rpe ?? 7), 0) / lastSessionWorkingSets.length,
            } : undefined;

            generateExerciseWhisper({
              exerciseName: exercise.name,
              setsCompletedToday: workingSets.length,
              lastSessionData,
              todayData,
              units,
            }).then(result => {
              setActiveWhisper({
                exerciseBlockId: exercise.blockId,
                cue: result.cue,
                timestamp: new Date(),
              });
            }).finally(() => {
              isGeneratingWhisper.current = false;
            });
          }
        }
      }
    });
  }, [exercises, enabled, units, whisperHistory, signalHistory]);

  // Generate rest tip when timer starts (but only once per rest period)
  useEffect(() => {
    if (!enabled || !isRestTimerRunning || !nextExercise || !restSecondsRemaining) {
      return;
    }

    // Only generate if we haven't generated for this rest period
    if (lastRestTipSeconds.current !== restSecondsRemaining || restTip === null) {
      lastRestTipSeconds.current = restSecondsRemaining;
      
      if (!restTipLoading) {
        setRestTipLoading(true);
        generateRestTip({
          nextExerciseName: nextExercise.name,
          nextWeight: nextExercise.weight,
          nextReps: nextExercise.repRange,
          restSecondsRemaining,
          units,
        }).then(result => {
          setRestTip(result.tip);
        }).finally(() => {
          setRestTipLoading(false);
        });
      }
    }
  }, [enabled, isRestTimerRunning, restSecondsRemaining, nextExercise, units, restTip, restTipLoading]);

  // Clear rest tip when timer stops
  useEffect(() => {
    if (!isRestTimerRunning) {
      setRestTip(null);
      lastRestTipSeconds.current = null;
    }
  }, [isRestTimerRunning]);

  const dismissWhisper = useCallback(() => {
    setActiveWhisper(null);
  }, []);

  const dismissSignal = useCallback(() => {
    setActiveSignal(null);
  }, []);

  const toggleSpineItem = useCallback((index: number) => {
    setSpineCompleted(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const refreshSpine = useCallback(async () => {
    if (!enabled || exercises.length === 0) return;

    setSpineLoading(true);
    try {
      const result = await generateSessionSpine({
        exercises: exercises.map(e => ({
          name: e.name,
          primaryMuscle: e.primaryMuscle,
          sets: e.sets,
        })),
        workoutType,
        weekInMeso,
        totalWeeks,
        injuries,
      });
      setSessionSpine(result.spine);
      setSpineCompleted(new Set()); // Reset completed items on refresh
    } catch (error) {
      console.error('[In-Workout Coach] Failed to refresh spine:', error);
    } finally {
      setSpineLoading(false);
    }
  }, [enabled, exercises, workoutType, weekInMeso, totalWeeks, injuries]);

  return {
    // Whisper
    activeWhisper,
    dismissWhisper,
    
    // Signal toast
    activeSignal,
    dismissSignal,
    
    // Rest tip
    restTip,
    
    // Session spine
    sessionSpine,
    spineCompleted,
    spineLoading,
    toggleSpineItem,
    refreshSpine,
  };
}
