'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';
import { formatDuration } from '@/lib/utils';

const TIMER_STORAGE_KEY = 'workout_rest_timer';

interface TimerState {
  endTime: number; // Unix timestamp when timer should complete
  duration: number; // Original duration in seconds
  isRunning: boolean;
}

interface RestTimerProps {
  defaultSeconds?: number;
  autoStart?: boolean;
  onComplete?: () => void;
  onDismiss?: () => void;
}

export function RestTimer({
  defaultSeconds = 180,
  autoStart = false,
  onComplete,
  onDismiss,
}: RestTimerProps) {
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
  const secondsRef = useRef(seconds);

  // Keep refs in sync
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

  const clearTimerInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

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

  const startTimer = useCallback((duration: number) => {
    clearTimerInterval();

    const endTime = Date.now() + duration * 1000;
    endTimeRef.current = endTime;
    setSeconds(duration);
    setInitialSeconds(duration);
    setIsFinished(false);
    setIsRunning(true);
    hasPlayedAlarm.current = false;
    saveTimerState(true, endTime, duration);

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
          endTimeRef.current = state.endTime;
          setSeconds(remaining);
          setInitialSeconds(state.duration);
          setIsRunning(true);
          hasPlayedAlarm.current = false;
          intervalRef.current = setInterval(tick, 1000);
        } else if (state.isRunning && remaining <= 0) {
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

  const toggleTimer = () => {
    if (isRunning) {
      setIsRunning(false);
      clearTimerInterval();
      endTimeRef.current = null;
      localStorage.removeItem(TIMER_STORAGE_KEY);
    } else {
      startTimer(secondsRef.current);
    }
    setIsFinished(false);
  };

  const resetTimer = () => {
    clearTimerInterval();
    setIsRunning(false);
    setIsFinished(false);
    setFinishedAt(null);
    setSeconds(initialSeconds);
    hasPlayedAlarm.current = false;
    endTimeRef.current = null;
    localStorage.removeItem(TIMER_STORAGE_KEY);
  };

  const addTime = (amount: number) => {
    setIsFinished(false);

    if (endTimeRef.current !== null) {
      const newEndTime = endTimeRef.current + (amount * 1000);
      const now = Date.now();
      const newRemaining = Math.max(0, Math.ceil((newEndTime - now) / 1000));

      if (newRemaining <= 0) {
        endTimeRef.current = now + 1000;
        setSeconds(1);
        saveTimerState(true, now + 1000, initialSeconds);
      } else {
        endTimeRef.current = newEndTime;
        setSeconds(newRemaining);
        saveTimerState(true, newEndTime, initialSeconds);
      }
    } else {
      const currentSeconds = secondsRef.current;
      const newSeconds = Math.max(1, currentSeconds + amount);
      setSeconds(newSeconds);
      setInitialSeconds(newSeconds);
    }
  };

  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;

  const getTimerColor = () => {
    if (isFinished) return 'text-success-400';
    if (seconds <= 10) return 'text-danger-400';
    if (seconds <= 30) return 'text-warning-400';
    return 'text-surface-100';
  };

  const isUrgent = seconds <= 10 && seconds > 0 && isRunning;

  return (
    <div 
      className={`fixed bottom-0 left-0 right-0 z-50 shadow-2xl lg:relative lg:rounded-xl lg:shadow-none transition-all ${
        isFinished 
          ? 'bg-success-500/20 border-t-4 border-success-500' 
          : isUrgent 
            ? 'bg-danger-500/10 border-t-4 border-danger-500 animate-pulse' 
            : 'bg-surface-900 border-t border-surface-800'
      } p-3 lg:p-4 lg:border`}
    >
      {/* Dismiss button - mobile only */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-2 right-2 p-1.5 text-surface-500 hover:text-surface-300 lg:hidden"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Finished message */}
      {isFinished && (
        <div className="text-center mb-2 space-y-1">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-success-500/30 text-success-300 rounded-full text-base font-bold animate-pulse">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            REST COMPLETE!
          </div>
          {timeSinceFinished > 0 && (
            <p className="text-sm text-success-400/80">
              Finished {timeSinceFinished < 60 
                ? `${timeSinceFinished}s ago` 
                : `${Math.floor(timeSinceFinished / 60)}m ${timeSinceFinished % 60}s ago`}
            </p>
          )}
        </div>
      )}

      {/* Timer display - larger and more prominent */}
      <div className="text-center mb-3 lg:mb-4">
        <div 
          className={`text-5xl lg:text-6xl font-mono font-bold ${getTimerColor()} transition-colors ${
            isUrgent ? 'scale-110' : ''
          }`}
          style={{ 
            textShadow: isUrgent ? '0 0 20px rgba(239, 68, 68, 0.5)' : 
                        isFinished ? '0 0 20px rgba(34, 197, 94, 0.5)' : 'none'
          }}
        >
          {formatDuration(seconds)}
        </div>
        <p className={`text-xs lg:text-sm mt-0.5 lg:mt-1 ${isUrgent ? 'text-danger-400' : 'text-surface-500'}`}>
          {isFinished ? 'Timer Complete!' : isUrgent ? 'Almost Ready!' : 'Rest Timer'}
        </p>
      </div>

      {/* Progress bar - more visible */}
      <div className={`h-2 lg:h-3 rounded-full overflow-hidden mb-4 ${
        isUrgent ? 'bg-danger-900' : isFinished ? 'bg-success-900' : 'bg-surface-800'
      }`}>
        <div
          className={`h-full transition-all duration-1000 ease-linear ${
            isFinished ? 'bg-success-500' : isUrgent ? 'bg-danger-500' : 'bg-primary-500'
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addTime(-15)}
          disabled={seconds <= 15 && !isFinished}
        >
          -15s
        </Button>
        <Button
          variant={isRunning ? 'secondary' : isFinished ? 'primary' : 'primary'}
          size="lg"
          onClick={isFinished ? resetTimer : toggleTimer}
          className={`px-10 py-3 text-lg ${isFinished ? 'animate-pulse' : ''}`}
        >
          {isFinished ? (
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reset
            </span>
          ) : isRunning ? (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addTime(15)}
        >
          +15s
        </Button>
      </div>

      {/* Reset button */}
      {!isFinished && (
        <div className="text-center mt-3">
          <button
            onClick={resetTimer}
            className="text-xs text-surface-500 hover:text-surface-400 transition-colors"
          >
            Reset to {formatDuration(initialSeconds)}
          </button>
        </div>
      )}

      {/* Quick presets - visible on mobile too when not running */}
      <div className={`flex justify-center gap-2 mt-4 pt-4 border-t ${
        isFinished ? 'border-success-800' : 'border-surface-800'
      } ${isRunning ? 'hidden lg:flex' : 'flex'}`}>
        {[60, 90, 120, 180, 240].map((preset) => (
          <button
            key={preset}
            onClick={() => {
              setSeconds(preset);
              setInitialSeconds(preset);
              setIsRunning(false);
              setIsFinished(false);
              hasPlayedAlarm.current = false;
              localStorage.removeItem(TIMER_STORAGE_KEY);
            }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              initialSeconds === preset
                ? 'bg-primary-500/20 text-primary-400'
                : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
            }`}
          >
            {formatDuration(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}
