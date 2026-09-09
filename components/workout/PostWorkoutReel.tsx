'use client';

/**
 * PostWorkoutReel - Session summary with Ask Coach CTA
 *
 * Shows ~3 short bullets summarizing the session (volume/PRs/vs last time/fatigue signals)
 * with a clear CTA to deep-link into AI Coach with this session's context.
 * Appears on finish/summary screen, not mid-workout.
 */

import { useState } from 'react';
import Link from 'next/link';
import { Button, Card } from '@/components/ui';
import { IconSparkles, IconMessageCircle, IconX } from '@tabler/icons-react';

export interface PostWorkoutReelProps {
  bullets: string[];
  isLoading?: boolean;
  sessionId: string;
  onDismiss?: () => void;
  className?: string;
}

export function PostWorkoutReel({
  bullets,
  isLoading = false,
  sessionId,
  onDismiss,
  className = '',
}: PostWorkoutReelProps) {
  const [isDismissed, setIsDismissed] = useState(false);

  const handleDismiss = () => {
    setIsDismissed(true);
    onDismiss?.();
  };

  if (isDismissed) return null;

  return (
    <Card className={`bg-gradient-to-br from-primary-900/40 to-primary-800/20 border-primary-500/30 ${className}`}>
      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <IconSparkles className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-surface-100">
              Session Highlights
            </h3>
          </div>
          {onDismiss && (
            <button
              onClick={handleDismiss}
              className="p-1 rounded-lg hover:bg-surface-800/50 transition-colors"
              aria-label="Dismiss session highlights"
            >
              <IconX className="w-4 h-4 text-surface-400" />
            </button>
          )}
        </div>

        {/* Bullets */}
        {isLoading ? (
          <div className="space-y-2 mb-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-5 bg-surface-700/50 rounded animate-pulse"
                style={{ width: `${80 + Math.random() * 20}%` }}
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-2 mb-4">
            {bullets.map((bullet, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-surface-100"
              >
                <span className="text-primary-400 mt-0.5">•</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Ask Coach CTA */}
        <Link
          href={`/dashboard/ai-coach?session=${sessionId}`}
          className={`block ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
        >
          <Button
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            <IconMessageCircle className="w-5 h-5" />
            Ask Coach About This Session
          </Button>
        </Link>

        <p className="mt-2 text-xs text-surface-400 text-center">
          Get personalized analysis and recommendations
        </p>
      </div>
    </Card>
  );
}
