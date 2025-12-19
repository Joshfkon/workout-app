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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasPlayedAlarm = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const endTimeRef = useRef<number | null>(null);

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

  const startTimer = useCallback((duration: number) => {
    const endTime = Date.now() + duration * 1000;
    endTimeRef.current = endTime;
    setSeconds(duration);
    setInitialSeconds(duration);
    setIsRunning(true);
    setIsFinished(false);
    hasPlayedAlarm.current = false;
    saveTimerState(true, endTime, duration);
  }, [saveTimerState]);

  // Load timer state from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TIMER_STORAGE_KEY);
      if (stored) {
        const state: TimerState = JSON.parse(stored);
        const now = Date.now();
        const remaining = Math.ceil((state.endTime - now) / 1000);

        if (state.isRunning && remaining > 0) {
          endTimeRef.current = state.endTime;
          setSeconds(remaining);
          setInitialSeconds(state.duration);
          setIsRunning(true);
          hasPlayedAlarm.current = false;
        } else if (state.isRunning && remaining <= 0) {
          setSeconds(0);
          setInitialSeconds(state.duration);
          setIsRunning(false);
          setIsFinished(true);
          setFinishedAt(state.endTime);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer logic - only create interval when isRunning changes
  // Uses endTimeRef for accurate countdown, with localStorage as backup for page refreshes
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        // Use endTimeRef directly - it's set when timer starts
        const endTime = endTimeRef.current;

        if (endTime) {
          const remaining = Math.ceil((endTime - Date.now()) / 1000);

          if (remaining <= 0) {
            setSeconds(0);
            setIsRunning(false);
            setIsFinished(true);
            setFinishedAt(Date.now());
            endTimeRef.current = null;
            localStorage.removeItem(TIMER_STORAGE_KEY);
            if (!hasPlayedAlarm.current) {
              hasPlayedAlarm.current = true;
              playAlarm();
              onCompleteRef.current?.();
            }
          } else {
            setSeconds(remaining);
          }
        } else {
          // Fallback: try localStorage (for page refresh recovery)
          try {
            const stored = localStorage.getItem(TIMER_STORAGE_KEY);
            if (stored) {
              const state: TimerState = JSON.parse(stored);
              endTimeRef.current = state.endTime;
            }
          } catch {
            // Last resort: simple decrement
            setSeconds((prev) => {
              if (prev <= 1) {
                setTimeout(() => {
                  setIsRunning(false);
                  setIsFinished(true);
                  setFinishedAt(Date.now());
                  if (!hasPlayedAlarm.current) {
                    hasPlayedAlarm.current = true;
                    playAlarm();
                    onCompleteRef.current?.();
                  }
                }, 0);
                return 0;
              }
              return prev - 1;
            });
          }
        }
      }, 250);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning, playAlarm]);

  const toggle = useCallback(() => {
    if (isRunning) {
      setIsRunning(false);
      endTimeRef.current = null;
      localStorage.removeItem(TIMER_STORAGE_KEY);
    } else {
      startTimer(seconds);
    }
    setIsFinished(false);
  }, [isRunning, seconds, startTimer]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(initialSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }, [initialSeconds]);

  const addTime = useCallback((amount: number) => {
    const newSeconds = Math.max(0, seconds + amount);
    setSeconds(newSeconds);
    setIsFinished(false);

    if (isRunning) {
      const endTime = Date.now() + newSeconds * 1000;
      endTimeRef.current = endTime;
      saveTimerState(true, endTime, initialSeconds);
    }
  }, [seconds, isRunning, initialSeconds, saveTimerState]);

  const skip = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(0);
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
    onCompleteRef.current?.();
  }, []);

  const start = useCallback((duration?: number) => {
    startTimer(duration ?? defaultSeconds);
  }, [defaultSeconds, startTimer]);

  const dismiss = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(defaultSeconds);
    setInitialSeconds(defaultSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }, [defaultSeconds]);

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
