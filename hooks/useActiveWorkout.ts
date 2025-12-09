'use client';

import { useCallback, useEffect } from 'react';
import { useWorkoutStore } from '@/stores';
import { createClient, createUntypedClient } from '@/lib/supabase/client';
import type { WorkoutSession, ExerciseBlock, SetLog, PreWorkoutCheckIn } from '@/types/schema';
import { calculateSetQuality } from '@/services/progressionEngine';
import { generateId } from '@/lib/utils';

export function useActiveWorkout() {
  const {
    activeSession,
    exerciseBlocks,
    currentBlockIndex,
    setLogs,
    startSession,
    endSession,
    setCheckIn,
    setCurrentBlock,
    nextBlock,
    previousBlock,
    logSet,
    getSetsForBlock,
    getSessionStats,
  } = useWorkoutStore();

  const currentBlock = exerciseBlocks[currentBlockIndex] || null;
  const currentBlockSets = currentBlock ? getSetsForBlock(currentBlock.id) : [];

  // Load workout session from database
  const loadWorkout = useCallback(async (sessionId: string) => {
    const supabase = createUntypedClient();
    
    // Fetch session
    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      console.error('Failed to load workout session:', sessionError);
      return null;
    }

    // Fetch exercise blocks
    const { data: blocks, error: blocksError } = await supabase
      .from('exercise_blocks')
      .select('*, exercises(*)')
      .eq('workout_session_id', sessionId)
      .order('order');

    if (blocksError) {
      console.error('Failed to load exercise blocks:', blocksError);
      return null;
    }

    // Extract exercises from blocks
    const exercises = blocks?.map((b: any) => b.exercises).filter(Boolean) || [];
    const cleanBlocks = blocks?.map(({ exercises, ...block }: any) => block) || [];

    startSession(session as WorkoutSession, cleanBlocks as ExerciseBlock[], exercises);
    return session;
  }, [startSession]);

  // Save set to database
  const saveSet = useCallback(async (
    blockId: string,
    data: {
      weightKg: number;
      reps: number;
      rpe: number;
      note?: string;
    }
  ) => {
    const block = exerciseBlocks.find((b) => b.id === blockId);
    if (!block) return null;

    const existingSets = getSetsForBlock(blockId);
    const setNumber = existingSets.filter((s) => !s.isWarmup).length + 1;
    const isLastSet = setNumber === block.targetSets;

    // Calculate quality
    const quality = calculateSetQuality({
      rpe: data.rpe,
      targetRir: block.targetRir,
      reps: data.reps,
      targetRepRange: block.targetRepRange,
      isLastSet,
    });

    const newSet: SetLog = {
      id: generateId(),
      exerciseBlockId: blockId,
      setNumber,
      weightKg: data.weightKg,
      reps: data.reps,
      rpe: data.rpe,
      restSeconds: null,
      isWarmup: false,
      quality: quality.quality,
      qualityReason: quality.reason,
      note: data.note || null,
      loggedAt: new Date().toISOString(),
    };

    // Optimistic update
    logSet(blockId, newSet);

    // Save to database
    const supabase = createUntypedClient();
    const { error } = await supabase.from('set_logs').insert({
      id: newSet.id,
      exercise_block_id: newSet.exerciseBlockId,
      set_number: newSet.setNumber,
      weight_kg: newSet.weightKg,
      reps: newSet.reps,
      rpe: newSet.rpe,
      rest_seconds: newSet.restSeconds,
      is_warmup: newSet.isWarmup,
      quality: newSet.quality,
      quality_reason: newSet.qualityReason,
      note: newSet.note,
      logged_at: newSet.loggedAt,
    });

    if (error) {
      console.error('Failed to save set:', error);
      // Could rollback optimistic update here
    }

    return newSet;
  }, [exerciseBlocks, getSetsForBlock, logSet]);

  // Complete workout
  const completeWorkout = useCallback(async (data: {
    sessionRpe: number;
    pumpRating: number;
    notes: string;
  }) => {
    if (!activeSession) return;

    const supabase = createUntypedClient();
    const { error } = await supabase
      .from('workout_sessions')
      .update({
        state: 'completed',
        completed_at: new Date().toISOString(),
        session_rpe: data.sessionRpe,
        pump_rating: data.pumpRating,
        session_notes: data.notes,
        completion_percent: 100,
      })
      .eq('id', activeSession.id);

    if (error) {
      console.error('Failed to complete workout:', error);
      return false;
    }

    endSession();
    return true;
  }, [activeSession, endSession]);

  // Submit check-in
  const submitCheckIn = useCallback(async (checkIn: PreWorkoutCheckIn) => {
    if (!activeSession) return;

    setCheckIn(checkIn);

    const supabase = createUntypedClient();
    await supabase
      .from('workout_sessions')
      .update({
        pre_workout_check_in: checkIn,
        state: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', activeSession.id);
  }, [activeSession, setCheckIn]);

  return {
    // State
    activeSession,
    exerciseBlocks,
    currentBlock,
    currentBlockIndex,
    currentBlockSets,
    isActive: !!activeSession,
    stats: getSessionStats(),
    
    // Actions
    loadWorkout,
    saveSet,
    completeWorkout,
    submitCheckIn,
    setCurrentBlock,
    nextBlock,
    previousBlock,
    endSession,
  };
}

