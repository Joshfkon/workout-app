'use client';

import { useState, useEffect, useRef, memo } from 'react';
import { useDurationTimer } from '@/hooks/useDurationTimer';

interface DurationTimerInputProps {
  /** Current value in seconds */
  value: number;
  /** Called when value changes */
  onChange: (seconds: number) => void;
  /** Target duration for visual feedback */
  targetSeconds?: number;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Exercise ID for timer persistence */
  exerciseId?: string;
}

/**
 * Duration timer input for exercises like planks and holds.
 * Shows a stopwatch that can be started/stopped, with manual editing capability.
 */
export const DurationTimerInput = memo(function DurationTimerInput({
  value,
  onChange,
  targetSeconds,
  disabled = false,
  exerciseId,
}: DurationTimerInputProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    elapsed,
    isRunning,
    hasReachedTarget,
    progressPercent,
    toggle,
    reset,
    setTime,
  } = useDurationTimer({
    targetSeconds,
    exerciseId,
    onTargetReached: () => {
      // Optional: could add callback here
    },
  });

  // Sync elapsed time to parent value when timer is running
  useEffect(() => {
    if (isRunning) {
      onChange(elapsed);
    }
  }, [elapsed, isRunning, onChange]);

  // Sync initial value to timer
  useEffect(() => {
    if (!isRunning && value !== elapsed && value > 0) {
      setTime(value);
    }
  // Only sync on mount or when value changes externally while not running
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Format seconds to MM:SS display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle starting edit mode
  const handleStartEdit = () => {
    if (disabled) return;
    if (isRunning) {
      toggle(); // Stop timer first
    }
    setEditValue(String(value || elapsed));
    setIsEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // Handle finishing edit
  const handleFinishEdit = () => {
    const parsed = parseInt(editValue);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 600) {
      setTime(parsed);
      onChange(parsed);
    }
    setIsEditing(false);
  };

  // Handle key press in edit mode
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  };

  // Handle timer toggle
  const handleToggle = () => {
    if (disabled) return;
    toggle();
  };

  // Handle reset
  const handleReset = () => {
    if (disabled) return;
    reset();
    onChange(0);
  };

  // Display value - use timer elapsed when running, otherwise use prop value
  const displaySeconds = isRunning ? elapsed : (value || elapsed);

  // Determine colors based on state
  const getTimerColor = () => {
    if (hasReachedTarget) return 'text-success-400';
    if (isRunning) return 'text-primary-400';
    return 'text-surface-100';
  };

  const getProgressColor = () => {
    if (hasReachedTarget) return 'bg-success-500';
    return 'bg-primary-500';
  };

  if (isEditing) {
    return (
      <div className="relative w-full">
        <input
          ref={inputRef}
          type="number"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={handleKeyDown}
          min="0"
          max="600"
          autoFocus
          className="w-full px-2 py-2 bg-surface-900 border border-primary-500 rounded text-center font-mono text-base font-semibold text-surface-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-surface-500">sec</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 w-full">
      {/* Timer display - clickable to edit */}
      <button
        type="button"
        onClick={handleStartEdit}
        disabled={disabled}
        className={`
          flex-1 relative px-2 py-2 bg-surface-900 border rounded text-center font-mono text-base font-semibold
          transition-all overflow-hidden
          ${disabled ? 'opacity-50 cursor-not-allowed border-surface-700' : 'cursor-pointer hover:border-primary-500 border-surface-700'}
          ${getTimerColor()}
        `}
        title="Click to edit time"
      >
        {/* Progress bar background */}
        {targetSeconds && targetSeconds > 0 && (
          <div
            className={`absolute inset-y-0 left-0 ${getProgressColor()} opacity-20 transition-all duration-300`}
            style={{ width: `${progressPercent}%` }}
          />
        )}
        <span className="relative z-10">
          {formatTime(displaySeconds)}
        </span>
      </button>

      {/* Play/Pause button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={`
          w-8 h-8 flex items-center justify-center rounded transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-800' : 'hover:bg-surface-700 bg-surface-800'}
          ${isRunning ? 'text-primary-400' : 'text-surface-300'}
        `}
        title={isRunning ? 'Stop timer' : 'Start timer'}
      >
        {isRunning ? (
          // Pause icon
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          // Play icon
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Reset button - only show when there's time to reset */}
      {displaySeconds > 0 && (
        <button
          type="button"
          onClick={handleReset}
          disabled={disabled}
          className={`
            w-8 h-8 flex items-center justify-center rounded transition-colors
            ${disabled ? 'opacity-50 cursor-not-allowed bg-surface-800' : 'hover:bg-surface-700 bg-surface-800'}
            text-surface-400
          `}
          title="Reset timer"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      )}
    </div>
  );
});
