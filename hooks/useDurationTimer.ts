'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const DURATION_TIMER_STORAGE_KEY = 'workout_duration_timer';

interface TimerState {
  startTime: number;
  elapsed: number;
  isRunning: boolean;
  exerciseId?: string;
}

interface UseDurationTimerOptions {
  /** Target duration in seconds (for visual feedback) */
  targetSeconds?: number;
  /** Called when timer reaches target */
  onTargetReached?: () => void;
  /** Exercise ID to associate timer with (for persistence) */
  exerciseId?: string;
}

/**
 * Hook for duration-based exercises (planks, holds, etc.)
 * Counts UP from 0 (stopwatch mode) with optional target duration
 */
export function useDurationTimer({
  targetSeconds,
  onTargetReached,
  exerciseId,
}: UseDurationTimerOptions = {}) {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasReachedTarget, setHasReachedTarget] = useState(false);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const onTargetReachedRef = useRef(onTargetReached);
  const hasNotifiedTarget = useRef(false);

  // Keep callback ref updated
  useEffect(() => {
    onTargetReachedRef.current = onTargetReached;
  }, [onTargetReached]);

  // Save timer state to localStorage
  const saveTimerState = useCallback((startTime: number, accumulatedElapsed: number) => {
    const state: TimerState = {
      startTime,
      elapsed: accumulatedElapsed,
      isRunning: true,
      exerciseId,
    };
    localStorage.setItem(DURATION_TIMER_STORAGE_KEY, JSON.stringify(state));
  }, [exerciseId]);

  const clearTimerState = useCallback(() => {
    localStorage.removeItem(DURATION_TIMER_STORAGE_KEY);
  }, []);

  // Play completion sound
  const playTargetSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;

      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 200);
    } catch {
      // Audio not supported
    }

    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  }, []);

  // Main timer effect
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (intervalRef.current) {
      return;
    }

    intervalRef.current = setInterval(() => {
      if (startTimeRef.current === null) {
        return;
      }

      const now = Date.now();
      const currentElapsed = accumulatedRef.current + Math.floor((now - startTimeRef.current) / 1000);
      setElapsed(currentElapsed);

      // Check if target reached
      if (targetSeconds && currentElapsed >= targetSeconds && !hasNotifiedTarget.current) {
        hasNotifiedTarget.current = true;
        setHasReachedTarget(true);
        playTargetSound();
        onTargetReachedRef.current?.();
      }
    }, 100); // Update more frequently for smoother display

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, targetSeconds, playTargetSound]);

  // Restore timer state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(DURATION_TIMER_STORAGE_KEY);
      if (stored) {
        const state: TimerState = JSON.parse(stored);

        // Only restore if it's for the same exercise (or no exercise specified)
        if (!exerciseId || state.exerciseId === exerciseId) {
          if (state.isRunning) {
            const now = Date.now();
            const runningTime = Math.floor((now - state.startTime) / 1000);
            const totalElapsed = state.elapsed + runningTime;

            startTimeRef.current = now;
            accumulatedRef.current = totalElapsed;
            setElapsed(totalElapsed);
            setIsRunning(true);
            hasNotifiedTarget.current = targetSeconds ? totalElapsed >= targetSeconds : false;
            setHasReachedTarget(hasNotifiedTarget.current);
          }
        }
      }
    } catch {
      // Could not restore timer state
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(() => {
    if (isRunning) return;

    const now = Date.now();
    startTimeRef.current = now;
    hasNotifiedTarget.current = false;
    setHasReachedTarget(false);
    setIsRunning(true);
    saveTimerState(now, accumulatedRef.current);
  }, [isRunning, saveTimerState]);

  const stop = useCallback(() => {
    if (!isRunning || startTimeRef.current === null) return;

    const now = Date.now();
    const sessionElapsed = Math.floor((now - startTimeRef.current) / 1000);
    const totalElapsed = accumulatedRef.current + sessionElapsed;

    accumulatedRef.current = totalElapsed;
    setElapsed(totalElapsed);
    setIsRunning(false);
    startTimeRef.current = null;
    clearTimerState();
  }, [isRunning, clearTimerState]);

  const toggle = useCallback(() => {
    if (isRunning) {
      stop();
    } else {
      start();
    }
  }, [isRunning, start, stop]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setElapsed(0);
    setHasReachedTarget(false);
    accumulatedRef.current = 0;
    startTimeRef.current = null;
    hasNotifiedTarget.current = false;
    clearTimerState();

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [clearTimerState]);

  const setTime = useCallback((seconds: number) => {
    const validSeconds = Math.max(0, Math.min(600, seconds));
    accumulatedRef.current = validSeconds;
    setElapsed(validSeconds);

    if (targetSeconds) {
      setHasReachedTarget(validSeconds >= targetSeconds);
    }

    // If timer is running, reset the start time
    if (isRunning && startTimeRef.current !== null) {
      startTimeRef.current = Date.now();
      saveTimerState(startTimeRef.current, validSeconds);
    }
  }, [isRunning, targetSeconds, saveTimerState]);

  // Progress towards target (0-100)
  const progressPercent = targetSeconds && targetSeconds > 0
    ? Math.min(100, (elapsed / targetSeconds) * 100)
    : 0;

  return {
    // State
    elapsed,
    isRunning,
    hasReachedTarget,
    progressPercent,
    // Actions
    start,
    stop,
    toggle,
    reset,
    setTime,
  };
}
