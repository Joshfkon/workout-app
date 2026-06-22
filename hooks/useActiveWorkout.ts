'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useWorkoutStore } from '@/stores';
import { createClient, createUntypedClient } from '@/lib/supabase/client';
import type { WorkoutSession, ExerciseBlock, SetLog, PreWorkoutCheckIn, SetFeedback } from '@/types/schema';
import { calculateSetQuality } from '@/services/progressionEngine';
import { generateId } from '@/lib/utils';

/**
 * The DB row payload for a `set_logs` insert. We keep the exact payload for any
 * set whose insert failed so it can be retried/flushed later, ensuring failed
 * sets remain recoverable rather than being silently lost.
 */
type SetLogInsertPayload = {
  id: string;
  exercise_block_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  rpe: number;
  rest_seconds: number | null;
  is_warmup: boolean;
  quality: SetLog['quality'];
  quality_reason: string | null;
  note: string | null;
  logged_at: string;
  feedback: string | null;
};

export type SaveSetResult = {
  set: SetLog;
  /** true if the DB insert succeeded; false if it failed (set queued for retry). */
  saved: boolean;
  /** Present when saved === false. */
  error?: string;
};

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

  // Queue of set inserts that failed to persist. Keyed by set id so retries are
  // idempotent and we never enqueue the same set twice. These remain in memory
  // (and the optimistic copy stays in the persisted workout store) so a failed
  // save is recoverable via flushUnsavedSets() or before endSession.
  const pendingSetsRef = useRef<Map<string, SetLogInsertPayload>>(new Map());

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
      feedback?: SetFeedback;
    }
  ) => {
    const block = exerciseBlocks.find((b) => b.id === blockId);
    if (!block) return null;

    const existingSets = getSetsForBlock(blockId);
    const setNumber = existingSets.filter((s) => !s.isWarmup).length + 1;
    const isLastSet = setNumber === block.targetSets;

    // Calculate quality - factor in form if available
    const quality = calculateSetQuality({
      rpe: data.rpe,
      targetRir: block.targetRir,
      reps: data.reps,
      targetRepRange: block.targetRepRange,
      isLastSet,
    });

    // Enhance quality reason with form feedback
    let qualityReason = quality.reason;
    if (data.feedback) {
      const formLabel =
        data.feedback.form === 'clean'
          ? 'Clean form'
          : data.feedback.form === 'some_breakdown'
            ? 'Some form breakdown'
            : 'Form breakdown';
      qualityReason = `${formLabel}. ${quality.reason}`;
    }

    const newSet: SetLog = {
      id: generateId(),
      exerciseBlockId: blockId,
      setNumber,
      weightKg: data.weightKg,
      reps: data.reps,
      rpe: data.rpe,
      restSeconds: null,
      isWarmup: false,
      setType: 'normal',
      parentSetId: null,
      quality: quality.quality,
      qualityReason,
      note: data.note || null,
      loggedAt: new Date().toISOString(),
      feedback: data.feedback,
    };

    // Optimistic update - keep the set in the (persisted) store regardless of
    // whether the DB insert succeeds, so a failed save is never wiped.
    logSet(blockId, newSet);

    const payload: SetLogInsertPayload = {
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
      feedback: data.feedback ? JSON.stringify(data.feedback) : null,
    };

    // Save to database
    const supabase = createUntypedClient();
    const { error } = await supabase.from('set_logs').insert(payload);

    if (error) {
      // Don't silently swallow: queue for retry and surface to the caller so
      // the UI can show a "not saved / retry" affordance.
      console.error('Failed to save set:', error);
      pendingSetsRef.current.set(newSet.id, payload);
      return { set: newSet, saved: false, error: error.message };
    }

    // Success - make sure it isn't lingering in the retry queue.
    pendingSetsRef.current.delete(newSet.id);
    return { set: newSet, saved: true };
  }, [exerciseBlocks, getSetsForBlock, logSet]);

  /**
   * Retry persisting any sets whose insert previously failed. Returns the
   * number still unsaved after the attempt (0 means everything is flushed).
   * Uses upsert so re-inserting an already-saved row is a no-op.
   */
  const flushUnsavedSets = useCallback(async (): Promise<number> => {
    const pending = pendingSetsRef.current;
    if (pending.size === 0) return 0;

    const supabase = createUntypedClient();
    const entries = Array.from(pending.values());

    const { error } = await supabase
      .from('set_logs')
      .upsert(entries, { onConflict: 'id' });

    if (error) {
      console.error('Failed to flush unsaved sets:', error);
      return pending.size;
    }

    entries.forEach((e) => pending.delete(e.id));
    return pending.size;
  }, []);

  const hasUnsavedSets = useCallback(() => pendingSetsRef.current.size > 0, []);

  // Complete workout
  const completeWorkout = useCallback(async (data: {
    sessionRpe: number;
    pumpRating: number;
    notes: string;
  }) => {
    if (!activeSession) return;

    // Flush any sets that failed to persist earlier BEFORE we tear down the
    // session, so we don't lose them. If some still can't be saved, abort the
    // completion so the user can retry rather than silently dropping data.
    const stillUnsaved = await flushUnsavedSets();
    if (stillUnsaved > 0) {
      console.error(`Cannot complete workout: ${stillUnsaved} set(s) failed to save.`);
      return false;
    }

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

    pendingSetsRef.current.clear();
    endSession();
    return true;
  }, [activeSession, endSession, flushUnsavedSets]);

  // Submit check-in
  const submitCheckIn = useCallback(async (
    checkIn: PreWorkoutCheckIn
  ): Promise<{ success: boolean; error?: string }> => {
    if (!activeSession) return { success: false, error: 'No active session' };

    setCheckIn(checkIn);

    const supabase = createUntypedClient();
    const { error } = await supabase
      .from('workout_sessions')
      .update({
        pre_workout_check_in: checkIn,
        state: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', activeSession.id);

    if (error) {
      console.error('Failed to submit check-in:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }, [activeSession, setCheckIn]);

  // Cancel workout - reset session and delete logged sets.
  // These two writes aren't transactional, so order matters. We reset the
  // durable anchor (the workout_sessions row) FIRST. If that succeeds the
  // workout is authoritatively back to "planned"; deleting the now-orphaned
  // set logs afterward is best-effort cleanup and can be safely retried later.
  // The reverse order would risk deleting sets while leaving the session stuck
  // mid-flight if the second write failed.
  const cancelWorkout = useCallback(async () => {
    if (!activeSession) return false;

    const supabase = createUntypedClient();

    // 1. Reset session state back to planned (the safe anchor).
    const { error: sessionError } = await supabase
      .from('workout_sessions')
      .update({
        state: 'planned',
        started_at: null,
        pre_workout_check_in: null,
      })
      .eq('id', activeSession.id);

    if (sessionError) {
      // Anchor not updated - abort without deleting any sets so nothing is lost.
      console.error('Failed to cancel workout (session reset):', sessionError);
      return false;
    }

    // 2. Delete the now-orphaned set logs. Best-effort cleanup: if this fails
    // the session is already correctly reset, so we still treat the cancel as
    // succeeded but log the leftover rows for later cleanup.
    const blockIds = exerciseBlocks.map((b) => b.id);
    if (blockIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('set_logs')
        .delete()
        .in('exercise_block_id', blockIds);

      if (deleteError) {
        console.error('Workout cancelled but failed to delete set logs (orphaned rows left for cleanup):', deleteError);
      }
    }

    pendingSetsRef.current.clear();
    endSession();
    return true;
  }, [activeSession, exerciseBlocks, endSession]);

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
    flushUnsavedSets,
    hasUnsavedSets,
    completeWorkout,
    cancelWorkout,
    submitCheckIn,
    setCurrentBlock,
    nextBlock,
    previousBlock,
    endSession,
  };
}

