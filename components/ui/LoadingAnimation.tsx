'use client';

import { useState, useEffect } from 'react';

type AnimationType = 'barbell' | 'dumbbell' | 'pulse' | 'reps' | 'heartbeat' | 'weights' | 'kettlebell' | 'muscle' | 'spinner' | 'dots' | 'pullup' | 'squat' | 'pushup' | 'jumprope' | 'deadlift' | 'random';

// Export AnimationType for use in other components
export type { AnimationType };

// All fitness animations (excluding utility ones like spinner/dots)
const FITNESS_ANIMATIONS: AnimationType[] = [
  'barbell', 'dumbbell', 'reps', 'heartbeat', 'weights', 
  'kettlebell', 'muscle', 'pullup', 'squat', 'pushup', 
  'jumprope', 'deadlift'
];

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
  "Mind-muscle connection improves gains",
  "Compound movements build the most muscle",
  "Hydration affects performance significantly",
  "Training to failure isn't always necessary",
  "Recovery is just as important as training",
];

export function LoadingAnimation({ 
  type = 'random', 
  size = 'md',
  text,
  showTip = false 
}: LoadingAnimationProps) {
  const [tip, setTip] = useState('');

  // Random pick happens AFTER mount (P1-1): choosing with Math.random()
  // during render made server and client markup disagree and forced a
  // hydration failure (full client re-render + console errors) on every page
  // that server-rendered a loading state. First paint is a deterministic
  // 'barbell'; the variety kicks in client-only, one frame later.
  const [randomType, setRandomType] = useState<AnimationType>('barbell');
  useEffect(() => {
    if (type === 'random') {
      setRandomType(FITNESS_ANIMATIONS[Math.floor(Math.random() * FITNESS_ANIMATIONS.length)]);
    }
  }, [type]);
  const actualType = type === 'random' ? randomType : type;

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
    sm: 'text-caption',
    md: 'text-subhead',
    lg: 'text-body',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      {actualType === 'barbell' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          {/* Entire barbell moves up and down like a bench press */}
          <div 
            className="flex items-center"
            style={{ animation: 'barbellLift 0.8s ease-in-out infinite' }}
          >
            {/* Left plates */}
            <div className="flex items-center">
              <div className="w-2 h-10 bg-action rounded-sm" />
              <div className="w-1.5 h-8 bg-action rounded-sm" />
            </div>
            
            {/* Bar */}
            <div className="w-12 h-1.5 bg-ink-3 rounded-full" />
            
            {/* Right plates */}
            <div className="flex items-center">
              <div className="w-1.5 h-8 bg-action rounded-sm" />
              <div className="w-2 h-10 bg-action rounded-sm" />
            </div>
          </div>
        </div>
      )}

      {actualType === 'dumbbell' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div className="flex items-center gap-1 animate-pulse">
            {/* Left weight */}
            <div className="w-4 h-10 bg-action rounded-md" />
            <div className="w-3 h-8 bg-action rounded-md" />
            {/* Handle */}
            <div className="w-8 h-3 bg-ink-3 rounded-full" />
            {/* Right weight */}
            <div className="w-3 h-8 bg-action rounded-md" />
            <div className="w-4 h-10 bg-action rounded-md" />
          </div>
        </div>
      )}

      {actualType === 'reps' && (
        <div className={`flex items-end gap-1 ${sizeClasses[size]}`}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-2 bg-action rounded-t-full"
              style={{
                height: '100%',
                animation: 'repPulse 1s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      )}

      {actualType === 'heartbeat' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <svg 
            viewBox="0 0 24 24" 
            className="w-full h-full text-action"
            style={{ animation: 'heartbeat 1s ease-in-out infinite' }}
          >
            <path 
              fill="currentColor" 
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            />
          </svg>
        </div>
      )}

      {actualType === 'weights' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div className="relative">
            {/* Stacked weight plates animation */}
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="absolute rounded-full border-4 border-action"
                style={{
                  width: `${(3 - i) * 20 + 20}px`,
                  height: `${(3 - i) * 20 + 20}px`,
                  top: `${i * 5}px`,
                  left: `${i * 10}px`,
                  animation: 'weightPulse 1.5s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                  background: `rgb(var(--ht-action) / 0.3)`,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {actualType === 'pulse' && (
        <div className={`relative ${sizeClasses[size]}`}>
          <div className="absolute inset-0 rounded-full bg-action/30 animate-ping" />
          <div className="absolute inset-2 rounded-full bg-action/50 animate-ping" style={{ animationDelay: '0.2s' }} />
          <div className="absolute inset-4 rounded-full bg-action animate-pulse" />
        </div>
      )}

      {actualType === 'kettlebell' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div style={{ animation: 'kettlebellSwing 1s ease-in-out infinite', transformOrigin: 'top center' }}>
            {/* Handle */}
            <div className="w-6 h-3 border-4 border-ink-3 rounded-t-full mx-auto" />
            {/* Body */}
            <div className="w-10 h-10 bg-ink-3 rounded-full -mt-1 flex items-center justify-center">
              <div className="w-4 h-4 bg-fill rounded-full" />
            </div>
          </div>
        </div>
      )}

      {actualType === 'muscle' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <svg 
            viewBox="0 0 64 64" 
            className="w-full h-full"
            style={{ animation: 'muscleFlex 0.8s ease-in-out infinite' }}
          >
            {/* Flexing arm/bicep */}
            <path 
              fill="url(#muscleGradient)" 
              d="M20 45 Q15 40, 18 30 Q20 20, 28 18 Q35 16, 40 22 Q48 30, 44 38 Q42 42, 38 44 Q32 48, 20 45"
            />
            {/* Muscle definition line */}
            <path 
              fill="none" 
              stroke="rgba(255,255,255,0.3)" 
              strokeWidth="1.5"
              d="M28 24 Q34 28, 36 35"
            />
            <defs>
              <linearGradient id="muscleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgb(var(--ht-action))" />
                <stop offset="100%" stopColor="rgb(var(--ht-action))" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      )}

      {actualType === 'spinner' && (
        <div className={`relative ${sizeClasses[size]}`}>
          <svg className="w-full h-full animate-spin" viewBox="0 0 50 50">
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-ink-3"
            />
            <circle
              cx="25"
              cy="25"
              r="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="80, 200"
              strokeDashoffset="0"
              className="text-action"
            />
          </svg>
        </div>
      )}

      {actualType === 'dots' && (
        <div className={`flex items-center justify-center gap-2 ${sizeClasses[size]}`}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-3 h-3 bg-action rounded-full"
              style={{
                animation: 'dotBounce 0.6s ease-in-out infinite',
                animationDelay: `${i * 0.15}s`,
              }}
            />
          ))}
        </div>
      )}

      {/* Pull-up animation */}
      {actualType === 'pullup' && (
        <div className={`relative ${sizeClasses[size]} flex flex-col items-center justify-center`}>
          {/* Pull-up bar */}
          <div className="w-20 h-2 bg-ink-3 rounded-full" />
          {/* Person doing pull-up */}
          <div 
            className="flex flex-col items-center"
            style={{ animation: 'pullupMove 1s ease-in-out infinite' }}
          >
            {/* Head */}
            <div className="w-4 h-4 bg-action rounded-full mt-1" />
            {/* Body */}
            <div className="w-2 h-8 bg-action rounded-sm" />
            {/* Arms holding bar - positioned at top */}
            <div 
              className="absolute top-2 flex gap-8"
              style={{ animation: 'pullupArms 1s ease-in-out infinite' }}
            >
              <div className="w-1 h-6 bg-action rounded-full origin-top" style={{ transform: 'rotate(-30deg)' }} />
              <div className="w-1 h-6 bg-action rounded-full origin-top" style={{ transform: 'rotate(30deg)' }} />
            </div>
          </div>
        </div>
      )}

      {/* Squat animation */}
      {actualType === 'squat' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          <div style={{ animation: 'squatMove 0.9s ease-in-out infinite' }}>
            {/* Head */}
            <div className="w-5 h-5 bg-action rounded-full mx-auto" />
            {/* Barbell across shoulders */}
            <div className="flex items-center -mt-1">
              <div className="w-2 h-4 bg-action rounded-sm" />
              <div className="w-14 h-1.5 bg-ink-3 rounded-full" />
              <div className="w-2 h-4 bg-action rounded-sm" />
            </div>
            {/* Torso */}
            <div className="w-6 h-6 bg-action rounded-sm mx-auto" />
            {/* Legs */}
            <div 
              className="flex justify-center gap-2"
              style={{ animation: 'squatLegs 0.9s ease-in-out infinite' }}
            >
              <div className="w-2 h-8 bg-action rounded-sm origin-top" />
              <div className="w-2 h-8 bg-action rounded-sm origin-top" />
            </div>
          </div>
        </div>
      )}

      {/* Push-up animation */}
      {actualType === 'pushup' && (
        <div className={`relative ${sizeClasses[size]} flex items-end justify-center`}>
          <div style={{ animation: 'pushupMove 0.8s ease-in-out infinite', transformOrigin: 'right bottom' }}>
            {/* Person in push-up position */}
            <div className="flex items-end">
              {/* Arms */}
              <div 
                className="flex flex-col items-center mr-1"
                style={{ animation: 'pushupArms 0.8s ease-in-out infinite' }}
              >
                <div className="w-1.5 h-6 bg-action rounded-full" />
              </div>
              {/* Body */}
              <div className="w-16 h-3 bg-action rounded-full -rotate-12 origin-right" style={{ animation: 'pushupBody 0.8s ease-in-out infinite' }} />
              {/* Head at front */}
              <div className="w-4 h-4 bg-action rounded-full -ml-2 mb-1" />
            </div>
            {/* Ground line */}
            <div className="w-20 h-0.5 bg-sep mt-1 rounded-full" />
          </div>
        </div>
      )}

      {/* Jump rope animation */}
      {actualType === 'jumprope' && (
        <div className={`relative ${sizeClasses[size]} flex items-center justify-center`}>
          {/* Rope */}
          <div 
            className="absolute w-16 h-16 border-2 border-action rounded-full"
            style={{ 
              animation: 'ropeSpinFast 0.4s linear infinite',
              borderStyle: 'dashed',
              borderWidth: '3px',
            }}
          />
          {/* Person jumping */}
          <div style={{ animation: 'jumpMove 0.4s ease-in-out infinite' }}>
            {/* Head */}
            <div className="w-4 h-4 bg-action rounded-full mx-auto" />
            {/* Body */}
            <div className="w-2 h-6 bg-action rounded-sm mx-auto" />
            {/* Legs */}
            <div className="flex justify-center gap-0.5">
              <div className="w-1.5 h-4 bg-action rounded-sm" />
              <div className="w-1.5 h-4 bg-action rounded-sm" />
            </div>
          </div>
        </div>
      )}

      {/* Deadlift animation */}
      {actualType === 'deadlift' && (
        <div className={`relative ${sizeClasses[size]} flex items-end justify-center pb-2`}>
          <div style={{ animation: 'deadliftMove 1.2s ease-in-out infinite' }}>
            {/* Head */}
            <div className="w-4 h-4 bg-action rounded-full mx-auto mb-0.5" />
            {/* Upper body - bends forward */}
            <div 
              className="w-3 h-6 bg-action rounded-sm mx-auto origin-bottom"
              style={{ animation: 'deadliftBend 1.2s ease-in-out infinite' }}
            />
            {/* Legs - slight bend */}
            <div className="flex justify-center gap-1">
              <div className="w-2 h-6 bg-action rounded-sm" />
              <div className="w-2 h-6 bg-action rounded-sm" />
            </div>
            {/* Barbell at ground level */}
            <div 
              className="flex items-center -mt-2"
              style={{ animation: 'barbellUp 1.2s ease-in-out infinite' }}
            >
              <div className="w-3 h-4 bg-action rounded-sm" />
              <div className="w-1 h-3 bg-action rounded-sm" />
              <div className="w-10 h-1 bg-ink-3 rounded-full" />
              <div className="w-1 h-3 bg-action rounded-sm" />
              <div className="w-3 h-4 bg-action rounded-sm" />
            </div>
          </div>
        </div>
      )}

      {text && (
        <p className={`text-ink-2 font-medium ${textSizes[size]} animate-pulse`}>
          {text}
        </p>
      )}

      {showTip && tip && (
        <p className="text-caption text-ink-3 max-w-xs text-center italic">
          {tip}
        </p>
      )}
    </div>
  );
}

// Simple skeleton loader for cards/content
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="bg-card shadow-card rounded-card p-4 space-y-3">
        <div className="h-4 bg-fill rounded w-3/4" />
        <div className="h-3 bg-fill rounded w-1/2" />
        <div className="h-8 bg-fill rounded w-full" />
      </div>
    </div>
  );
}

// Skeleton for exercise cards
export function SkeletonExercise() {
  return (
    <div className="animate-pulse bg-card shadow-card rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-4 bg-fill rounded w-40" />
          <div className="h-3 bg-fill rounded w-24" />
        </div>
        <div className="w-8 h-8 bg-fill rounded-full" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-10 bg-fill rounded-input" />
      ))}
    </div>
  );
}

/**
 * Quiet, layout-shaped placeholder for a whole screen (design system):
 * the real title, a hero block and a few list cards, pulsing gently.
 * Replaces the animated full-page spinners so loading looks like an app
 * filling in, not a website waiting.
 */
export function PageSkeleton({ title, text = 'Loading' }: { title?: string; text?: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={text} role="status">
      <span className="sr-only">{text}</span>
      {title ? (
        <h1 className="text-large-title text-ink">{title}</h1>
      ) : (
        <div className="animate-pulse h-9 w-48 rounded-input bg-fill" />
      )}
      <div className="animate-pulse space-y-3">
        <div className="h-36 rounded-card bg-card shadow-card" />
        <div className="rounded-card bg-card shadow-card p-4 space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-[9px] bg-fill" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/5 rounded bg-fill" />
                <div className="h-3 w-3/5 rounded bg-fill" />
              </div>
            </div>
          ))}
        </div>
        <div className="h-20 rounded-card bg-card shadow-card" />
      </div>
    </div>
  );
}

// Full page loading state
// Full page loading state — now a layout-shaped skeleton (see PageSkeleton).
// `type` is kept for existing callers; the animated icons are no longer used
// for whole-page loads.
export function FullPageLoading({
  text = 'Loading...',
  title,
}: {
  text?: string;
  type?: AnimationType;
  title?: string;
}) {
  return <PageSkeleton text={text} title={title} />;
}

export default LoadingAnimation;

