'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';
import { formatDuration } from '@/lib/utils';

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
  const [isRunning, setIsRunning] = useState(autoStart);
  const [initialSeconds, setInitialSeconds] = useState(defaultSeconds);
  const [isFinished, setIsFinished] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const playAlarm = useCallback(() => {
    // Play 3 beeps with increasing frequency
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
          gainNode.gain.value = 0.5; // Louder

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

    // Play 3 ascending beeps
    playBeep(600, 0);
    playBeep(800, 350);
    playBeep(1000, 700);

    // Vibrate on mobile (if supported)
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 400]); // Pattern: vibrate, pause, vibrate, pause, long vibrate
    }
  }, []);

  // Timer logic
  useEffect(() => {
    if (isRunning && seconds > 0) {
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
            setIsFinished(true);
            playAlarm();
            onComplete?.();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, seconds, onComplete, playAlarm]);

  const toggleTimer = () => {
    setIsRunning(!isRunning);
    setIsFinished(false);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setIsFinished(false);
    setSeconds(initialSeconds);
  };

  const addTime = (amount: number) => {
    setSeconds((prev) => Math.max(0, prev + amount));
    setIsFinished(false);
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
        <div className="text-center mb-2">
          <span className="inline-flex items-center gap-2 px-3 py-1 bg-success-500/20 text-success-400 rounded-full text-sm font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Rest Complete - Start Next Set!
          </span>
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
