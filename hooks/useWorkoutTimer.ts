'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const WORKOUT_TIMER_STORAGE_KEY = 'workout_timer_state';

interface WorkoutTimerState {
  startTime: number;       // When the workout started (or resumed from)
  pausedAt: number | null; // When paused, the elapsed time at that point
  isPaused: boolean;
}

interface UseWorkoutTimerOptions {
  sessionId: string;
  startedAt: string | null; // ISO date string from session
}

export function useWorkoutTimer({ sessionId, startedAt }: UseWorkoutTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef<WorkoutTimerState | null>(null);

  // Generate storage key per session
  const storageKey = `${WORKOUT_TIMER_STORAGE_KEY}_${sessionId}`;

  // Load saved state or initialize from startedAt
  useEffect(() => {
    if (!sessionId || !startedAt) return;

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const state: WorkoutTimerState = JSON.parse(stored);
        stateRef.current = state;

        if (state.isPaused && state.pausedAt !== null) {
          // Was paused - restore paused state
          setElapsedSeconds(state.pausedAt);
          setIsPaused(true);
        } else {
          // Was running - calculate current elapsed
          const now = Date.now();
          const elapsed = Math.floor((now - state.startTime) / 1000);
          setElapsedSeconds(elapsed);
          setIsPaused(false);
        }
      } else {
        // No saved state - initialize from session startedAt
        const startTime = new Date(startedAt).getTime();
        const now = Date.now();
        const elapsed = Math.floor((now - startTime) / 1000);

        stateRef.current = {
          startTime,
          pausedAt: null,
          isPaused: false,
        };
        setElapsedSeconds(elapsed);
        setIsPaused(false);

        // Save initial state
        localStorage.setItem(storageKey, JSON.stringify(stateRef.current));
      }
    } catch (e) {
      console.error('Failed to restore workout timer state:', e);
      // Fallback to startedAt
      if (startedAt) {
        const startTime = new Date(startedAt).getTime();
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setElapsedSeconds(elapsed);
      }
    }
  }, [sessionId, startedAt, storageKey]);

  // Countdown/up interval
  useEffect(() => {
    if (isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!stateRef.current) return;

    intervalRef.current = setInterval(() => {
      const state = stateRef.current;
      if (!state || state.isPaused) return;

      const now = Date.now();
      const elapsed = Math.floor((now - state.startTime) / 1000);
      setElapsedSeconds(elapsed);
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused]);

  const pause = useCallback(() => {
    if (!stateRef.current || isPaused) return;

    const newState: WorkoutTimerState = {
      ...stateRef.current,
      pausedAt: elapsedSeconds,
      isPaused: true,
    };
    stateRef.current = newState;
    setIsPaused(true);

    localStorage.setItem(storageKey, JSON.stringify(newState));
  }, [isPaused, elapsedSeconds, storageKey]);

  const resume = useCallback(() => {
    if (!stateRef.current || !isPaused) return;

    // Calculate new startTime to maintain elapsed time
    const pausedElapsed = stateRef.current.pausedAt ?? 0;
    const newStartTime = Date.now() - (pausedElapsed * 1000);

    const newState: WorkoutTimerState = {
      startTime: newStartTime,
      pausedAt: null,
      isPaused: false,
    };
    stateRef.current = newState;
    setIsPaused(false);

    localStorage.setItem(storageKey, JSON.stringify(newState));
  }, [isPaused, storageKey]);

  const toggle = useCallback(() => {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isPaused, pause, resume]);

  const reset = useCallback(() => {
    if (!startedAt) return;

    const startTime = new Date(startedAt).getTime();
    const now = Date.now();
    const elapsed = Math.floor((now - startTime) / 1000);

    const newState: WorkoutTimerState = {
      startTime,
      pausedAt: null,
      isPaused: false,
    };
    stateRef.current = newState;
    setElapsedSeconds(elapsed);
    setIsPaused(false);

    localStorage.setItem(storageKey, JSON.stringify(newState));
  }, [startedAt, storageKey]);

  const clearStorage = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Format elapsed time as HH:MM:SS or MM:SS
  const formatTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    elapsedSeconds,
    formattedTime: formatTime(elapsedSeconds),
    isPaused,
    pause,
    resume,
    toggle,
    reset,
    clearStorage,
  };
}
