'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui';
import { formatDuration } from '@/lib/utils';

interface RestTimerProps {
  defaultSeconds?: number;
  autoStart?: boolean;
  onComplete?: () => void;
}

export function RestTimer({
  defaultSeconds = 180,
  autoStart = false,
  onComplete,
}: RestTimerProps) {
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [isRunning, setIsRunning] = useState(autoStart);
  const [initialSeconds, setInitialSeconds] = useState(defaultSeconds);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Create audio context for alarm
  useEffect(() => {
    // Create a simple beep sound using Web Audio API
    audioRef.current = new Audio();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const playAlarm = useCallback(() => {
    // Create oscillator for beep sound
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.value = 0.3;

      oscillator.start();
      setTimeout(() => {
        oscillator.stop();
        audioContext.close();
      }, 200);
    } catch (e) {
      console.log('Audio not supported');
    }
  }, []);

  // Timer logic
  useEffect(() => {
    if (isRunning && seconds > 0) {
      intervalRef.current = setInterval(() => {
        setSeconds((prev) => {
          if (prev <= 1) {
            setIsRunning(false);
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
  };

  const resetTimer = () => {
    setIsRunning(false);
    setSeconds(initialSeconds);
  };

  const addTime = (amount: number) => {
    setSeconds((prev) => Math.max(0, prev + amount));
  };

  const progressPercent = ((initialSeconds - seconds) / initialSeconds) * 100;

  const getTimerColor = () => {
    if (seconds <= 10) return 'text-danger-400';
    if (seconds <= 30) return 'text-warning-400';
    return 'text-surface-100';
  };

  return (
    <div className="bg-surface-900 border border-surface-800 rounded-xl p-4">
      {/* Timer display */}
      <div className="text-center mb-4">
        <div className={`text-4xl font-mono font-bold ${getTimerColor()}`}>
          {formatDuration(seconds)}
        </div>
        <p className="text-sm text-surface-500 mt-1">Rest Timer</p>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-surface-800 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-primary-500 transition-all duration-1000 ease-linear"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addTime(-15)}
          disabled={seconds <= 15}
        >
          -15s
        </Button>
        <Button
          variant={isRunning ? 'secondary' : 'primary'}
          size="md"
          onClick={toggleTimer}
          className="px-8"
        >
          {isRunning ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      <div className="text-center mt-3">
        <button
          onClick={resetTimer}
          className="text-xs text-surface-500 hover:text-surface-400 transition-colors"
        >
          Reset to {formatDuration(initialSeconds)}
        </button>
      </div>

      {/* Quick presets */}
      <div className="flex justify-center gap-2 mt-4 pt-4 border-t border-surface-800">
        {[60, 90, 120, 180, 240].map((preset) => (
          <button
            key={preset}
            onClick={() => {
              setSeconds(preset);
              setInitialSeconds(preset);
              setIsRunning(false);
            }}
            className={`px-2 py-1 text-xs rounded-md transition-colors ${
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

