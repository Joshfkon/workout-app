'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const DURATION_TIMER_STORAGE_KEY = 'workout_duration_timer';

/**
 * Camera-style "get in position" lead-in before a hold starts counting.
 * You tap Start, get five seconds (with a tick per second) to grip the bar or
 * set the plank, and the clock only starts when the countdown hits zero.
 */
export const DEFAULT_LEAD_IN_SECONDS = 5;

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
  /**
   * Seconds of "get in position" countdown before the hold clock starts.
   * 0 disables the lead-in and starts immediately.
   */
  leadInSeconds?: number;
}

/**
 * Hook for duration-based exercises (planks, holds, etc.)
 * Counts DOWN from target when running, shows elapsed when paused
 */
export function useDurationTimer({
  targetSeconds,
  onTargetReached,
  exerciseId,
  leadInSeconds = DEFAULT_LEAD_IN_SECONDS,
}: UseDurationTimerOptions = {}) {
  const [elapsed, setElapsed] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [hasReachedTarget, setHasReachedTarget] = useState(false);
  // Track if timer has ever been started (to differentiate target display vs elapsed)
  const [hasStarted, setHasStarted] = useState(false);
  // "Get in position" lead-in: counting down, not yet holding.
  const [isCountingDown, setIsCountingDown] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const accumulatedRef = useRef(0);
  const onTargetReachedRef = useRef(onTargetReached);
  const hasNotifiedTarget = useRef(false);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownDeadlineRef = useRef<number | null>(null);
  const lastCountdownTickRef = useRef<number | null>(null);

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

  // Short beep — the only audio primitive this hook needs (lead-in ticks, the
  // "go" tone, and the target chime all differ only in pitch/length/volume).
  const playTone = useCallback((frequency: number, durationMs: number, gain = 0.3) => {
    try {
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';
      gainNode.gain.value = gain;

      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, durationMs);
    } catch {
      // Audio not supported
    }
  }, []);

  // Play completion sound
  const playTargetSound = useCallback(() => {
    playTone(880, 200);

    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }
  }, [playTone]);

  // Lead-in: a quiet tick per second, then a higher "go" tone + buzz at zero,
  // so the countdown is usable with the phone face-down on the bench.
  const playCountdownTick = useCallback(() => {
    playTone(660, 90, 0.18);
  }, [playTone]);

  const playCountdownGo = useCallback(() => {
    playTone(990, 260, 0.3);
    if (navigator.vibrate) {
      navigator.vibrate(80);
    }
  }, [playTone]);

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
            setHasStarted(true);
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

  /** Start the hold clock right now, with no lead-in. */
  const startNow = useCallback(() => {
    countdownDeadlineRef.current = null;
    lastCountdownTickRef.current = null;
    setIsCountingDown(false);
    setCountdownRemaining(0);

    if (isRunning) return;

    const now = Date.now();
    startTimeRef.current = now;
    hasNotifiedTarget.current = false;
    setHasReachedTarget(false);
    setHasStarted(true);
    setIsRunning(true);
    saveTimerState(now, accumulatedRef.current);
  }, [isRunning, saveTimerState]);

  const cancelCountdown = useCallback(() => {
    countdownDeadlineRef.current = null;
    lastCountdownTickRef.current = null;
    setIsCountingDown(false);
    setCountdownRemaining(0);
  }, []);

  /**
   * Tap-to-start. With a lead-in configured this opens the "get in position"
   * countdown; the hold clock starts only when it reaches zero, so the
   * seconds you log are seconds you actually held.
   */
  const start = useCallback(() => {
    if (isRunning || isCountingDown) return;

    if (!leadInSeconds || leadInSeconds <= 0) {
      startNow();
      return;
    }

    countdownDeadlineRef.current = Date.now() + leadInSeconds * 1000;
    lastCountdownTickRef.current = null;
    setCountdownRemaining(leadInSeconds);
    setIsCountingDown(true);
  }, [isRunning, isCountingDown, leadInSeconds, startNow]);

  // Lead-in ticker. Wall-clock driven like the hold clock itself, so a
  // backgrounded tab resumes at the right count instead of freezing.
  useEffect(() => {
    if (!isCountingDown) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      return;
    }

    const tick = () => {
      const deadline = countdownDeadlineRef.current;
      if (deadline === null) return;

      const msLeft = deadline - Date.now();
      if (msLeft <= 0) {
        playCountdownGo();
        startNow();
        return;
      }

      const secondsLeft = Math.ceil(msLeft / 1000);
      setCountdownRemaining(secondsLeft);
      if (secondsLeft !== lastCountdownTickRef.current) {
        lastCountdownTickRef.current = secondsLeft;
        playCountdownTick();
      }
    };

    tick();
    countdownIntervalRef.current = setInterval(tick, 100);

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isCountingDown, playCountdownTick, playCountdownGo, startNow]);

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
    if (isCountingDown) {
      cancelCountdown();
    } else if (isRunning) {
      stop();
    } else {
      start();
    }
  }, [isCountingDown, cancelCountdown, isRunning, start, stop]);

  const reset = useCallback(() => {
    cancelCountdown();
    setIsRunning(false);
    setElapsed(0);
    setHasReachedTarget(false);
    setHasStarted(false);
    accumulatedRef.current = 0;
    startTimeRef.current = null;
    hasNotifiedTarget.current = false;
    clearTimerState();

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [cancelCountdown, clearTimerState]);

  const setTime = useCallback((seconds: number) => {
    const validSeconds = Math.max(0, Math.min(600, seconds));
    accumulatedRef.current = validSeconds;
    setElapsed(validSeconds);

    // If manually setting a non-zero time, count as "started"
    if (validSeconds > 0) {
      setHasStarted(true);
    }

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

  // Countdown value (can go negative if elapsed > target)
  const remaining = targetSeconds ? targetSeconds - elapsed : 0;

  return {
    // State
    elapsed,
    remaining,
    isRunning,
    hasReachedTarget,
    hasStarted,
    progressPercent,
    // Lead-in ("get in position") state
    isCountingDown,
    countdownRemaining,
    leadInSeconds,
    // Actions
    start,
    startNow,
    cancelCountdown,
    stop,
    toggle,
    reset,
    setTime,
  };
}
