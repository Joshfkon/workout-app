'use client';

/**
 * ExerciseWhisper - Per-exercise contextual coaching cue
 *
 * Shows a short, glanceable line under/near the active exercise.
 * Auto-fades after being dismissed or shown for a while.
 */

import { useState, useEffect } from 'react';
import { IconX, IconSparkles } from '@tabler/icons-react';

export interface ExerciseWhisperProps {
  cue: string;
  exerciseName: string;
  onDismiss: () => void;
  autoFadeMs?: number;
  className?: string;
}

export function ExerciseWhisper({
  cue,
  exerciseName,
  onDismiss,
  autoFadeMs = 15000,
  className = '',
}: ExerciseWhisperProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (autoFadeMs > 0) {
      const fadeTimer = setTimeout(() => {
        setIsFading(true);
        setTimeout(onDismiss, 300);
      }, autoFadeMs);

      return () => clearTimeout(fadeTimer);
    }
  }, [autoFadeMs, onDismiss]);

  if (!isVisible) return null;

  const handleDismiss = () => {
    setIsFading(true);
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-lg bg-primary-900/40 border border-primary-500/30 backdrop-blur-sm transition-all duration-300 ${
        isFading ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      } ${className}`}
      data-testid="exercise-whisper"
      role="status"
      aria-live="polite"
    >
      <IconSparkles className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
      <p className="flex-1 text-sm text-primary-100 leading-snug">
        {cue}
      </p>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-0.5 rounded hover:bg-primary-800/50 transition-colors"
        aria-label="Dismiss coaching cue"
      >
        <IconX className="w-4 h-4 text-primary-300" />
      </button>
    </div>
  );
}
