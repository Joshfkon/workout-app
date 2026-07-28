'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  scheduleRestCompleteNotification,
  cancelRestCompleteNotification,
  restCompleteHaptic,
} from '@/lib/integrations/notifications';

const TIMER_STORAGE_KEY = 'workout_rest_timer';

// Single shared AudioContext, created/resumed on a user gesture (timer start).
// On iOS WKWebView an AudioContext created without a recent user gesture stays
// suspended, so creating it lazily at alarm time never plays. We create it once
// here and reuse it for every beep.
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!sharedAudioContext) {
      sharedAudioContext = new Ctor();
    }
    if (sharedAudioContext.state === 'suspended') {
      // Resume must be triggered from a user gesture to succeed on iOS.
      void sharedAudioContext.resume();
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

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
  // Use a ref to store the initial defaultSeconds so it doesn't change on re-renders
  const initialDefaultSecondsRef = useRef(defaultSeconds);
  
  const [seconds, setSeconds] = useState(initialDefaultSecondsRef.current);
  const [isRunning, setIsRunning] = useState(false);
  const [initialSeconds, setInitialSeconds] = useState(initialDefaultSecondsRef.current);
  const [isFinished, setIsFinished] = useState(false);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [timeSinceFinished, setTimeSinceFinished] = useState(0);
  const [isSkipped, setIsSkipped] = useState(false);
  const [restedSeconds, setRestedSeconds] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const endTimeRef = useRef<number | null>(null);
  const hasPlayedAlarm = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const secondsRef = useRef(defaultSeconds);

  useEffect(() => {
    secondsRef.current = seconds;
  }, [seconds]);

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
          // Reuse the shared AudioContext created on the start() user gesture.
          const audioContext = getAudioContext();
          if (!audioContext) return;

          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();

          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);

          oscillator.frequency.value = frequency;
          oscillator.type = 'sine';
          gainNode.gain.value = 0.5;

          oscillator.start();
          setTimeout(() => {
            // Don't close the shared context - we reuse it for later alarms.
            oscillator.stop();
          }, 250);
        } catch {
          // Audio not supported
        }
      }, delay);
    };

    playBeep(600, 0);
    playBeep(800, 350);
    playBeep(1000, 700);

    // Native haptics (with web navigator.vibrate fallback inside).
    void restCompleteHaptic();
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
    if (!isRunning) {
      // Clear interval when not running
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // If interval already exists (created by start()), don't create another
    if (intervalRef.current) {
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
          // Foreground completion: in-app alarm fires, so cancel the redundant
          // native notification we scheduled at start().
          void cancelRestCompleteNotification();
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
    } catch {
      // Could not restore timer state
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback((duration?: number, opts?: { totalSeconds?: number }) => {
    // Reset skipped state when starting a new timer
    setIsSkipped(false);
    setRestedSeconds(0);
    const durationToUse = duration ?? defaultSeconds;
    // `totalSeconds` (>= duration) keeps the ORIGINAL allotment as the
    // progress denominator when this start is really a RESUME of a paused
    // countdown: resuming 27s of a 180s rest must not re-anchor the bar (and
    // the skip()'s rested math) to a fresh-looking 27s prescription.
    const totalForProgress = Math.max(opts?.totalSeconds ?? durationToUse, durationToUse);
    const endTime = Date.now() + durationToUse * 1000;

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    endTimeRef.current = endTime;
    setSeconds(durationToUse);
    setInitialSeconds(totalForProgress);
    setIsFinished(false);
    hasPlayedAlarm.current = false;
    saveTimerState(endTime, totalForProgress);

    // Create/resume the shared AudioContext now, while we're inside a user
    // gesture, so the foreground beep can actually play later (esp. on iOS).
    getAudioContext();

    // Schedule a native local notification to fire at endTime. This is the
    // ONLY reliable alert when the app is backgrounded / screen locked, since
    // the JS interval and Web Audio are suspended then. No-op on web.
    void scheduleRestCompleteNotification(endTime);

    // Create the countdown interval immediately
    intervalRef.current = setInterval(() => {
      const currentEndTime = endTimeRef.current;
      const now = Date.now();

      if (currentEndTime === null) {
        setIsRunning(false);
        return;
      }

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
          // Foreground completion: in-app alarm fires, so cancel the redundant
          // native notification we scheduled at start().
          void cancelRestCompleteNotification();
          playAlarm();
          onCompleteRef.current?.();
        }
      } else {
        // Update seconds display
        setSeconds(remaining);
      }
    }, 1000);

    // Set isRunning after creating the interval
    setIsRunning(true);
  }, [defaultSeconds, saveTimerState, clearTimerState, playAlarm]);

  const toggle = useCallback(() => {
    if (isRunning) {
      // Pause
      setIsRunning(false);
      endTimeRef.current = null;
      clearTimerState();
      void cancelRestCompleteNotification();
    } else {
      // Resume/Start. A resume keeps the original allotment as the progress
      // denominator (totalSeconds) — re-anchoring initialSeconds to the
      // remaining count made a resumed 0:27 read like a fresh 27s
      // prescription and corrupted skip()'s rested-seconds math.
      const restartSeconds = secondsRef.current > 0
        ? secondsRef.current
        : (initialSeconds > 0 ? initialSeconds : defaultSeconds);
      start(restartSeconds, { totalSeconds: initialSeconds > 0 ? initialSeconds : undefined });
    }
    setIsFinished(false);
  }, [isRunning, start, clearTimerState, initialSeconds, defaultSeconds]);

  const reset = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setIsSkipped(false);
    setRestedSeconds(0);
    const resetSeconds = initialSeconds > 0 ? initialSeconds : defaultSeconds;
    setSeconds(resetSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    clearTimerState();
    void cancelRestCompleteNotification();
  }, [initialSeconds, clearTimerState, defaultSeconds]);

  const addTime = useCallback((amount: number) => {
    setIsFinished(false);

    // `initialSeconds` is the TOTAL rest allotment (prescription +
    // adjustments): it grows/shrinks with the adjustment in BOTH the running
    // and paused cases, so progressPercent and skip()'s rested-seconds math
    // stay truthful. The old paused branch instead re-anchored it to the
    // remaining count — "+15s" on an idle timer produced a 15s "prescription"
    // (the 0:14 live sighting) and skip() then under-reported the rest taken.
    const newInitial = Math.max(1, initialSeconds + amount);

    if (isRunning && endTimeRef.current !== null) {
      // When running, adjust the endTime
      const newEndTime = endTimeRef.current + (amount * 1000);
      endTimeRef.current = newEndTime;

      // Immediately update the display
      const now = Date.now();
      const newRemaining = Math.max(0, Math.ceil((newEndTime - now) / 1000));
      setSeconds(newRemaining);
      setInitialSeconds(newInitial);

      // Update localStorage
      saveTimerState(newEndTime, newInitial);

      // Reschedule the native notification at the new endTime (same id replaces
      // the prior one). If we ran the clock down to <= 0, just cancel it.
      if (newRemaining > 0) {
        void scheduleRestCompleteNotification(newEndTime);
      } else {
        void cancelRestCompleteNotification();
      }
    } else {
      // When not running, just update the seconds state
      const newSeconds = Math.max(0, seconds + amount);
      setSeconds(newSeconds);
      setInitialSeconds(newInitial);
    }
  }, [seconds, isRunning, initialSeconds, saveTimerState]);

  const skip = useCallback(() => {
    // Calculate how long they rested before skipping
    const rested = initialSeconds - seconds;
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(0);
    setIsSkipped(true);
    setRestedSeconds(rested > 0 ? rested : 0);
    endTimeRef.current = null;
    clearTimerState();
    void cancelRestCompleteNotification();
    onCompleteRef.current?.();
  }, [seconds, initialSeconds, clearTimerState]);

  const dismiss = useCallback(() => {
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(defaultSeconds);
    setInitialSeconds(defaultSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    clearTimerState();
    void cancelRestCompleteNotification();
  }, [defaultSeconds, clearTimerState]);

  // Mark timer as complete without playing alarm (used when starting dropsets)
  const markComplete = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsRunning(false);
    setIsFinished(true);
    setFinishedAt(Date.now());
    setSeconds(0);
    setIsSkipped(false);
    setRestedSeconds(0);
    endTimeRef.current = null;
    clearTimerState();
    void cancelRestCompleteNotification();
  }, [clearTimerState]);

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
    isSkipped,
    restedSeconds,
    // Actions
    start,
    toggle,
    reset,
    addTime,
    skip,
    dismiss,
    markComplete,
  };
}
