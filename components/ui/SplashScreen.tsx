'use client';

import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number; // milliseconds
}

/**
 * Lightweight CSS-only splash screen for fast initial load.
 * Uses pure CSS animations instead of Framer Motion to reduce bundle size.
 */
export function SplashScreen({ onComplete, duration = 1800 }: SplashScreenProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // Start fade out slightly before duration completes
    const fadeTimer = setTimeout(() => setIsFading(true), duration - 300);

    // Complete and unmount
    const completeTimer = setTimeout(() => {
      setIsVisible(false);
      onComplete();
    }, duration);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden transition-opacity duration-300 ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950" />

      {/* Pulsing circles - CSS only */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="splash-ring splash-ring-1" />
        <div className="splash-ring splash-ring-2" />
        <div className="splash-ring splash-ring-3" />
      </div>

      {/* Main logo container */}
      <div className="relative z-10 flex flex-col items-center splash-logo-enter">
        {/* Icon with glow */}
        <div className="relative mb-4">
          {/* Glow effect */}
          <div className="absolute inset-0 blur-2xl bg-primary-500/50 rounded-full splash-glow" />

          {/* Dumbbell Icon */}
          <svg
            className="w-20 h-20 text-primary-500 relative z-10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              d="M6.5 6.5V17.5M17.5 6.5V17.5M6.5 12H17.5M4 8V16M20 8V16M2 9.5V14.5M22 9.5V14.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="splash-path"
            />
          </svg>
        </div>

        {/* App name */}
        <h1 className="text-3xl md:text-4xl font-black text-surface-100 tracking-wider splash-text">
          HYPERTRACK
        </h1>

        {/* Tagline */}
        <p className="mt-2 text-sm text-primary-400 font-medium tracking-widest uppercase splash-tagline">
          Train Smarter
        </p>

        {/* Loading bar */}
        <div className="mt-6 w-40 h-1 bg-surface-800 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 rounded-full splash-progress" />
        </div>
      </div>

      {/* CSS Animations */}
      <style jsx>{`
        .splash-logo-enter {
          animation: logoEnter 0.5s ease-out forwards;
        }

        .splash-text {
          animation: textEnter 0.4s ease-out 0.2s both;
        }

        .splash-tagline {
          animation: textEnter 0.4s ease-out 0.4s both;
        }

        .splash-glow {
          animation: glowPulse 2s ease-in-out infinite;
        }

        .splash-progress {
          animation: progressFill 1.5s ease-out 0.3s forwards;
          transform: translateX(-100%);
        }

        .splash-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgb(var(--primary-500) / 0.2);
          animation: ringExpand 2s ease-out infinite;
        }

        .splash-ring-1 { animation-delay: 0s; }
        .splash-ring-2 { animation-delay: 0.4s; }
        .splash-ring-3 { animation-delay: 0.8s; }

        .splash-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          animation: pathDraw 1s ease-out 0.1s forwards;
        }

        @keyframes logoEnter {
          from { transform: scale(0.8); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        @keyframes textEnter {
          from { transform: translateY(10px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes glowPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.1); opacity: 0.7; }
        }

        @keyframes progressFill {
          to { transform: translateX(0); }
        }

        @keyframes ringExpand {
          0% { width: 60px; height: 60px; opacity: 0.6; }
          100% { width: 300px; height: 300px; opacity: 0; }
        }

        @keyframes pathDraw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

