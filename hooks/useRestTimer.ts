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
  console.log('[TIMER] useRestTimer hook initialized', { defaultSeconds, autoStart });
  
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [initialSeconds, setInitialSeconds] = useState(defaultSeconds);
  const [isFinished, setIsFinished] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [timeSinceFinished, setTimeSinceFinished] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const hasPlayedAlarm = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const secondsRef = useRef(defaultSeconds);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);
  
  // Log state changes
  useEffect(() => {
    console.log('[TIMER] state changed', { seconds, isRunning, isFinished, endTimeRef: endTimeRef.current, intervalExists: intervalRef.current !== null });
  }, [seconds, isRunning, isFinished]);

  // Keep onComplete ref updated
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

  const saveTimerState = useCallback((endTime: number, duration: number) => {
    const state: TimerState = { endTime, duration, isRunning: true };
    localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
  }, []);

  const clearTimerState = useCallback(() => {
    localStorage.removeItem(TIMER_STORAGE_KEY);
  }, []);

  // Main countdown effect - only creates interval when restoring from localStorage
  // The start() function creates the interval directly
  useEffect(() => {
    console.log('[TIMER] useEffect (isRunning)', { isRunning, intervalExists: intervalRef.current !== null, endTimeRef: endTimeRef.current });
    
    if (!isRunning) {
      // Clear interval when not running
      if (intervalRef.current) {
        console.log('[TIMER] useEffect - clearing interval (not running)');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // If interval already exists (created by start()), don't create another
    if (intervalRef.current) {
      console.log('[TIMER] useEffect - interval already exists, skipping');
      return;
    }

    // Only create interval here if we're restoring from localStorage
    // Ensure we have an endTime
    if (endTimeRef.current === null) {
      // Try to restore from localStorage
      try {
        const stored = localStorage.getItem(TIMER_STORAGE_KEY);
        if (stored) {
          const state: TimerState = JSON.parse(stored);
          endTimeRef.current = state.endTime;
        } else {
          // No endTime available, stop
          setIsRunning(false);
          return;
        }
      } catch (e) {
        setIsRunning(false);
        return;
      }
    }

    // Create the countdown interval (only for restored timers)
    intervalRef.current = setInterval(() => {
      const currentEndTime = endTimeRef.current;
      if (currentEndTime === null) {
        setIsRunning(false);
        return;
      }

      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((currentEndTime - now) / 1000));

      if (remaining <= 0) {
        // Timer finished
        setSeconds(0);
        setIsRunning(false);
        setIsFinished(true);
        setFinishedAt(now);
        endTimeRef.current = null;
        clearTimerState();
        
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        
        if (!hasPlayedAlarm.current) {
          hasPlayedAlarm.current = true;
          playAlarm();
          onCompleteRef.current?.();
        }
      } else {
        // Update seconds display
        setSeconds(remaining);
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, playAlarm, clearTimerState]);

  // Restore timer state on mount
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
          endTimeRef.current = null;
          clearTimerState();
          if (!hasPlayedAlarm.current) {
            hasPlayedAlarm.current = true;
            playAlarm();
            onCompleteRef.current?.();
          }
        }
      } else if (autoStart) {
        start(defaultSeconds);
      }
    } catch (e) {
      console.log('Could not restore timer state');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback((duration?: number) => {
    console.log('[TIMER] start() called', { duration, defaultSeconds });
    const durationToUse = duration ?? defaultSeconds;
    const endTime = Date.now() + durationToUse * 1000;
    
    console.log('[TIMER] start() - setting up timer', { durationToUse, endTime, currentTime: Date.now() });
    
    // Clear any existing interval
    if (intervalRef.current) {
      console.log('[TIMER] start() - clearing existing interval');
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    
    endTimeRef.current = endTime;
    setSeconds(durationToUse);
    setInitialSeconds(durationToUse);
    setIsFinished(false);
    hasPlayedAlarm.current = false;
    saveTimerState(endTime, durationToUse);
    
    console.log('[TIMER] start() - creating interval, endTimeRef:', endTimeRef.current);
    
    // Create the countdown interval immediately
    intervalRef.current = setInterval(() => {
      const currentEndTime = endTimeRef.current;
      const now = Date.now();
      
      console.log('[TIMER] interval tick', { 
        currentEndTime, 
        now, 
        intervalExists: intervalRef.current !== null
      });
      
      if (currentEndTime === null) {
        console.log('[TIMER] interval tick - endTime is null, stopping');
        setIsRunning(false);
        return;
      }

      const remaining = Math.max(0, Math.ceil((currentEndTime - now) / 1000));
      console.log('[TIMER] interval tick - calculated remaining', { remaining });

      if (remaining <= 0) {
        console.log('[TIMER] interval tick - timer finished');
        // Timer finished
        setSeconds(0);
        setIsRunning(false);
        setIsFinished(true);
        setFinishedAt(now);
        endTimeRef.current = null;
        clearTimerState();
        
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        
        if (!hasPlayedAlarm.current) {
          hasPlayedAlarm.current = true;
          playAlarm();
          onCompleteRef.current?.();
        }
      } else {
        // Update seconds display
        console.log('[TIMER] interval tick - updating seconds to', remaining);
        setSeconds(remaining);
      }
    }, 1000);
    
    console.log('[TIMER] start() - interval created', { intervalRef: intervalRef.current });
    
    // Set isRunning after creating the interval
    setIsRunning(true);
    console.log('[TIMER] start() - set isRunning to true');
  }, [defaultSeconds, saveTimerState, clearTimerState, playAlarm]);

  const toggle = useCallback(() => {
    console.log('[TIMER] toggle() called', { isRunning, seconds, endTimeRef: endTimeRef.current });
    if (isRunning) {
      // Pause
      console.log('[TIMER] toggle() - pausing');
      setIsRunning(false);
      endTimeRef.current = null;
      clearTimerState();
    } else {
      // Resume/Start
      console.log('[TIMER] toggle() - starting/resuming');
      const restartSeconds = secondsRef.current > 0
        ? secondsRef.current
        : (initialSeconds > 0 ? initialSeconds : defaultSeconds);
      start(restartSeconds);
    }
    setIsFinished(false);
  }, [isRunning, start, clearTimerState, initialSeconds, defaultSeconds]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    const resetSeconds = initialSeconds > 0 ? initialSeconds : defaultSeconds;
    setSeconds(resetSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    clearTimerState();
  }, [initialSeconds, clearTimerState, defaultSeconds]);

  const addTime = useCallback((amount: number) => {
    console.log('[TIMER] addTime() called', { amount, isRunning, endTimeRef: endTimeRef.current, seconds });
    setIsFinished(false);

    if (isRunning && endTimeRef.current !== null) {
      // When running, adjust the endTime
      const oldEndTime = endTimeRef.current;
      const newEndTime = oldEndTime + (amount * 1000);
      endTimeRef.current = newEndTime;
      
      console.log('[TIMER] addTime() - adjusting endTime', { oldEndTime, newEndTime, amount });
      
      // Immediately update the display
      const now = Date.now();
      const newRemaining = Math.max(0, Math.ceil((newEndTime - now) / 1000));
      console.log('[TIMER] addTime() - updating display', { newRemaining, now });
      setSeconds(newRemaining);
      
      // Update localStorage
      saveTimerState(newEndTime, initialSeconds);
    } else {
      // When not running, just update the seconds state
      const newSeconds = Math.max(0, seconds + amount);
      console.log('[TIMER] addTime() - timer not running, updating seconds', { oldSeconds: seconds, newSeconds });
      setSeconds(newSeconds);
      setInitialSeconds(newSeconds || defaultSeconds);
    }
  }, [seconds, isRunning, initialSeconds, saveTimerState, defaultSeconds]);

  const skip = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(0);
    endTimeRef.current = null;
    clearTimerState();
    onCompleteRef.current?.();
  }, [clearTimerState]);

  const dismiss = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(defaultSeconds);
    setInitialSeconds(defaultSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    clearTimerState();
  }, [defaultSeconds, clearTimerState]);

  const progressPercent = initialSeconds > 0
    ? ((initialSeconds - seconds) / initialSeconds) * 100
    : 0;
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
