'use client';

import { useState, useEffect } from 'react';

type AnimationType = 'barbell' | 'dumbbell' | 'pulse' | 'reps' | 'heartbeat' | 'weights';

interface LoadingAnimationProps {
  type?: AnimationType;
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  showTip?: boolean;
}

const LOADING_TIPS = [
  "Progressive overload is key to muscle growth",
  "Rest 2-3 minutes between heavy compound sets",
  "Track your workouts to see progress over time",
  "Protein timing matters less than total daily intake",
  "Sleep is when muscles actually grow",
  "Deload weeks prevent overtraining",
  "S-tier exercises give the best results",
  "Form over ego - always",
  "Consistency beats intensity",
  "Warmup sets prevent injury",
];

export function LoadingAnimation({ 
  type = 'barbell', 
  size = 'md',
  text,
  showTip = false 
}: LoadingAnimationProps) {
  const [tip, setTip] = useState('');
  
  useEffect(() => {
    if (showTip) {
      setTip(LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]);
    }
  }, [showTip]);

  const sizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-16 h-16',
    lg: 'w-24 h-24',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {type === 'barbell' && (
        <div className={`relative ${sizeClasses[size]}`}>
          {/* Barbell bar */}
          <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-surface-600 via-surface-400 to-surface-600 rounded-full transform -translate-y-1/2" />
          
          {/* Left weight plate - bouncing */}
          <div 
            className="absolute left-0 top-1/2 w-3 h-8 bg-gradient-to-b from-primary-400 to-primary-600 rounded-sm transform -translate-y-1/2 animate-bounce"
            style={{ animationDelay: '0ms', animationDuration: '600ms' }}
          />
          <div 
            className="absolute left-3 top-1/2 w-2 h-6 bg-gradient-to-b from-accent-400 to-accent-600 rounded-sm transform -translate-y-1/2 animate-bounce"
            style={{ animationDelay: '100ms', animationDuration: '600ms' }}
          />
          
          {/* Right weight plate - bouncing */}
          <div 
            className="absolute right-0 top-1/2 w-3 h-8 bg-gradient-to-b from-primary-400 to-primary-600 rounded-sm transform -translate-y-1/2 animate-bounce"
            style={{ animationDelay: '0ms', animationDuration: '600ms' }}
          />
          <div 
            className="absolute right-3 top-1/2 w-2 h-6 bg-gradient-to-b from-accent-400 to-accent-600 rounded-sm transform -translate-y-1/2 animate-bounce"
            style={{ animationDelay: '100ms', animationDuration: '600ms' }}
          />
        </div>
      )}

      {type === 'dumbbell' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div className="flex items-center gap-1 animate-pulse">
            {/* Left weight */}
            <div className="w-4 h-10 bg-gradient-to-b from-primary-400 to-primary-600 rounded-md" />
            <div className="w-3 h-8 bg-gradient-to-b from-primary-500 to-primary-700 rounded-md" />
            {/* Handle */}
            <div className="w-8 h-3 bg-gradient-to-r from-surface-400 via-surface-300 to-surface-400 rounded-full" />
            {/* Right weight */}
            <div className="w-3 h-8 bg-gradient-to-b from-primary-500 to-primary-700 rounded-md" />
            <div className="w-4 h-10 bg-gradient-to-b from-primary-400 to-primary-600 rounded-md" />
          </div>
        </div>
      )}

      {type === 'reps' && (
        <div className={`flex items-end gap-1 ${sizeClasses[size]}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-2 bg-gradient-to-t from-primary-500 to-accent-400 rounded-t-full"
              style={{
                height: '100%',
                animation: 'repPulse 1s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
          <style jsx>{`
            @keyframes repPulse {
              0%, 100% { transform: scaleY(0.3); opacity: 0.5; }
              50% { transform: scaleY(1); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {type === 'heartbeat' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <svg 
            viewBox="0 0 24 24" 
            className="w-full h-full text-primary-500"
            style={{ animation: 'heartbeat 1s ease-in-out infinite' }}
          >
            <path 
              fill="currentColor" 
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            />
          </svg>
          <style jsx>{`
            @keyframes heartbeat {
              0%, 100% { transform: scale(1); }
              25% { transform: scale(1.1); }
              35% { transform: scale(1); }
              45% { transform: scale(1.15); }
              55% { transform: scale(1); }
            }
          `}</style>
        </div>
      )}

      {type === 'weights' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div className="relative">
            {/* Stacked weight plates animation */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="absolute rounded-full border-4 border-primary-500"
                style={{
                  width: `${(3 - i) * 20 + 20}px`,
                  height: `${(3 - i) * 20 + 20}px`,
                  top: `${i * 5}px`,
                  left: `${i * 10}px`,
                  animation: 'weightPulse 1.5s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                  background: `linear-gradient(135deg, rgba(var(--primary-500), 0.3), rgba(var(--accent-500), 0.3))`,
                }}
              />
            ))}
          </div>
          <style jsx>{`
            @keyframes weightPulse {
              0%, 100% { transform: scale(1) rotate(0deg); opacity: 0.7; }
              50% { transform: scale(1.1) rotate(5deg); opacity: 1; }
            }
          `}</style>
        </div>
      )}

      {type === 'pulse' && (
        <div className={`relative ${sizeClasses[size]}`}>
          <div className="absolute inset-0 rounded-full bg-primary-500/30 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-primary-500/50 animate-ping" style={{ animationDelay: '0.2s' }} />
          <div className="absolute inset-4 rounded-full bg-primary-500 animate-pulse" />
        </div>
      )}

      {text && (
        <p className={`text-surface-400 font-medium ${textSizes[size]} animate-pulse`}>
          {text}
        </p>
      )}

      {showTip && tip && (
        <p className="text-xs text-surface-500 max-w-xs text-center italic">
          💡 {tip}
        </p>
      )}
    </div>
  );
}

// Simple skeleton loader for cards/content
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="bg-surface-800 rounded-lg p-4 space-y-3">
        <div className="h-4 bg-surface-700 rounded w-3/4" />
        <div className="h-3 bg-surface-700 rounded w-1/2" />
        <div className="h-8 bg-surface-700 rounded w-full" />
      </div>
    </div>
  );
}

// Skeleton for exercise cards
export function SkeletonExercise() {
  return (
    <div className="animate-pulse bg-surface-800/50 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-surface-700 rounded-lg" />
          <div className="space-y-2">
            <div className="h-4 bg-surface-700 rounded w-32" />
            <div className="h-3 bg-surface-700 rounded w-20" />
          </div>
        </div>
        <div className="w-16 h-8 bg-surface-700 rounded" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 bg-surface-700 rounded" />
        ))}
      </div>
    </div>
  );
}

// Full page loading state
export function FullPageLoading({ text = 'Loading...', type = 'barbell' as AnimationType }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingAnimation type={type} size="lg" text={text} showTip />
    </div>
  );
}

export default LoadingAnimation;

