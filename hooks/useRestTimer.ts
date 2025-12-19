'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const TIMER_STORAGE_KEY = 'workout_rest_timer';

interface TimerState {
  endTime: number;
  duration: number;
  isRunning: boolean;
}

interface UseRestTimerOptions {
  defaultSeconds?: number;
  autoStart?: boolean;
  onComplete?: () => void;
}

export function useRestTimer({
  defaultSeconds = 180,
  autoStart = false,
  onComplete,
}: UseRestTimerOptions = {}) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [initialSeconds, setInitialSeconds] = useState(defaultSeconds);
  const [isFinished, setIsFinished] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [timeSinceFinished, setTimeSinceFinished] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasPlayedAlarm = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const endTimeRef = useRef<number | null>(null);
  // Use ref to track seconds for the interval callback to avoid stale closures
  const secondsRef = useRef(seconds);

  // Keep secondsRef in sync
  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Track time since finished
  useEffect(() => {
    if (isFinished && finishedAt) {
      const updateTimeSince = () => {
        setTimeSinceFinished(Math.floor((Date.now() - finishedAt) / 1000));
      };
      updateTimeSince();
      const interval = setInterval(updateTimeSince, 1000);
      return () => clearInterval(interval);
    } else {
      setTimeSinceFinished(0);
    }
  }, [isFinished, finishedAt]);

  const playAlarm = useCallback(() => {
    const playBeep = (frequency: number, delay: number) => {
      setTimeout(() => {
        try {
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();

          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);

          oscillator.frequency.value = frequency;
          oscillator.type = 'sine';
          gainNode.gain.value = 0.5;

          oscillator.start();
          setTimeout(() => {
            oscillator.stop();
            audioContext.close();
          }, 250);
        } catch (e) {
          console.log('Audio not supported');
        }
      }, delay);
    };

    playBeep(600, 0);
    playBeep(800, 350);
    playBeep(1000, 700);

    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]);
    }
  }, []);

  const saveTimerState = useCallback((running: boolean, endTime: number, duration: number) => {
    if (running) {
      const state: TimerState = { endTime, duration, isRunning: true };
      localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
    } else {
      localStorage.removeItem(TIMER_STORAGE_KEY);
    }
  }, []);

  // Clear interval helper
  const clearTimerInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Handle timer completion
  const handleTimerComplete = useCallback(() => {
    const now = Date.now();
    setSeconds(0);
    setIsRunning(false);
    setIsFinished(true);
    setFinishedAt(now);
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
    clearTimerInterval();

    if (!hasPlayedAlarm.current) {
      hasPlayedAlarm.current = true;
      playAlarm();
      onCompleteRef.current?.();
    }
  }, [clearTimerInterval, playAlarm]);

  // Core timer tick function - reads from ref to avoid stale closures
  const tick = useCallback(() => {
    const currentEndTime = endTimeRef.current;
    if (currentEndTime === null) {
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, Math.ceil((currentEndTime - now) / 1000));

    if (remaining <= 0) {
      handleTimerComplete();
    } else {
      setSeconds(remaining);
    }
  }, [handleTimerComplete]);

  // Start timer with a specific duration
  const startTimer = useCallback((duration: number) => {
    // Clear any existing interval first
    clearTimerInterval();

    const endTime = Date.now() + duration * 1000;
    endTimeRef.current = endTime;
    setSeconds(duration);
    setInitialSeconds(duration);
    setIsFinished(false);
    setIsRunning(true);
    hasPlayedAlarm.current = false;
    saveTimerState(true, endTime, duration);

    // Create the interval
    intervalRef.current = setInterval(tick, 1000);
  }, [clearTimerInterval, saveTimerState, tick]);

  // Load timer state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TIMER_STORAGE_KEY);
      if (stored) {
        const state: TimerState = JSON.parse(stored);
        const now = Date.now();
        const remaining = Math.ceil((state.endTime - now) / 1000);

        if (state.isRunning && remaining > 0) {
          // Restore running timer
          endTimeRef.current = state.endTime;
          setSeconds(remaining);
          setInitialSeconds(state.duration);
          setIsRunning(true);
          hasPlayedAlarm.current = false;
          // Start the interval for restored timer
          intervalRef.current = setInterval(tick, 1000);
        } else if (state.isRunning && remaining <= 0) {
          // Timer finished while away
          setSeconds(0);
          setInitialSeconds(state.duration);
          setIsRunning(false);
          setIsFinished(true);
          setFinishedAt(state.endTime);
          endTimeRef.current = null;
          localStorage.removeItem(TIMER_STORAGE_KEY);
          if (!hasPlayedAlarm.current) {
            hasPlayedAlarm.current = true;
            playAlarm();
            onCompleteRef.current?.();
          }
        }
      } else if (autoStart) {
        startTimer(defaultSeconds);
      }
    } catch (e) {
      console.log('Could not restore timer state');
    }

    // Cleanup on unmount
    return () => {
      clearTimerInterval();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup interval when isRunning becomes false
  useEffect(() => {
    if (!isRunning) {
      clearTimerInterval();
    }
  }, [isRunning, clearTimerInterval]);

  const toggle = useCallback(() => {
    if (isRunning) {
      // Pause
      setIsRunning(false);
      clearTimerInterval();
      endTimeRef.current = null;
      localStorage.removeItem(TIMER_STORAGE_KEY);
    } else {
      // Start/Resume - use current seconds value from ref
      startTimer(secondsRef.current);
    }
    setIsFinished(false);
  }, [isRunning, startTimer, clearTimerInterval]);

  const reset = useCallback(() => {
    clearTimerInterval();
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(initialSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }, [initialSeconds, clearTimerInterval]);

  const addTime = useCallback((amount: number) => {
    setIsFinished(false);

    if (endTimeRef.current !== null) {
      // Timer is running or was running - update the end time
      const newEndTime = endTimeRef.current + (amount * 1000);
      const now = Date.now();
      const newRemaining = Math.max(0, Math.ceil((newEndTime - now) / 1000));

      if (newRemaining <= 0) {
        // Would go negative, just set to minimum
        endTimeRef.current = now + 1000; // 1 second minimum
        setSeconds(1);
        saveTimerState(true, now + 1000, initialSeconds);
      } else {
        endTimeRef.current = newEndTime;
        setSeconds(newRemaining);
        saveTimerState(true, newEndTime, initialSeconds);
      }
    } else {
      // Timer not started yet - just update the display seconds
      const currentSeconds = secondsRef.current;
      const newSeconds = Math.max(1, currentSeconds + amount);
      setSeconds(newSeconds);
      setInitialSeconds(newSeconds);
    }
  }, [initialSeconds, saveTimerState]);

  const skip = useCallback(() => {
    clearTimerInterval();
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(0);
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
    onCompleteRef.current?.();
  }, [clearTimerInterval]);

  const start = useCallback((duration?: number) => {
    startTimer(duration ?? defaultSeconds);
  }, [defaultSeconds, startTimer]);

  const dismiss = useCallback(() => {
    clearTimerInterval();
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(defaultSeconds);
    setInitialSeconds(defaultSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }, [defaultSeconds, clearTimerInterval]);

  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;
  const isUrgent = seconds <= 10 && seconds > 0 && isRunning;

  return {
    // State
    seconds,
    initialSeconds,
    isRunning,
    isFinished,
    isUrgent,
    progressPercent,
    timeSinceFinished,
    // Actions
    start,
    toggle,
    reset,
    addTime,
    skip,
    dismiss,
  };
}
