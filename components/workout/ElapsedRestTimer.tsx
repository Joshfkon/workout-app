'use client';

import { useState, useEffect, useCallback } from 'react';

interface ElapsedRestTimerProps {
  sinceTimestamp: Date | string | null;
  label?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Format elapsed time according to specifications:
 * - Under 1 min: "0:45"
 * - Under 10 min: "2:05"
 * - Under 1 hour: "12:30"
 * - Over 1 hour: "1h 5m"
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 0) return '0:00';

  if (seconds < 60) {
    return `0:${seconds.toString().padStart(2, '0')}`;
  }

  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Over an hour - user probably took a break
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

/**
 * Elapsed rest timer component that displays time since a given timestamp.
 * Timer counts up continuously and persists correctly when app is backgrounded.
 */
export function ElapsedRestTimer({
  sinceTimestamp,
  label = 'Time since last set',
  showLabel = true,
  size = 'md',
  className = '',
}: ElapsedRestTimerProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Calculate elapsed time from timestamp
  const calculateElapsed = useCallback(() => {
    if (!sinceTimestamp) return 0;

    const timestamp = typeof sinceTimestamp === 'string'
      ? new Date(sinceTimestamp)
      : sinceTimestamp;

    const now = Date.now();
    const then = timestamp.getTime();
    return Math.max(0, Math.floor((now - then) / 1000));
  }, [sinceTimestamp]);

  // Initialize and update elapsed time
  useEffect(() => {
    if (!sinceTimestamp) {
      setElapsedSeconds(0);
      return;
    }

    // Set initial elapsed time immediately
    setElapsedSeconds(calculateElapsed());

    // Update every second
    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [sinceTimestamp, calculateElapsed]);

  // Don't render if no timestamp
  if (!sinceTimestamp) return null;

  const sizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl font-semibold',
  };

  const formattedTime = formatElapsedTime(elapsedSeconds);

  return (
    <div className={`text-surface-400 ${className}`}>
      {showLabel && (
        <p className="text-xs text-surface-500 mb-0.5">{label}</p>
      )}
      <p className={`font-mono ${sizeClasses[size]}`}>
        {formattedTime}
      </p>
    </div>
  );
}

// Export the formatting function for use elsewhere
export { formatElapsedTime };
