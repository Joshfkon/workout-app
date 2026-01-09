'use client';

import { useState, useEffect } from 'react';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number; // milliseconds
}

const APP_NAME = 'HYPERTROPHY';

/**
 * Lightweight CSS-only splash screen for fast initial load.
 * Uses pure CSS animations instead of Framer Motion to reduce bundle size.
 * Optimized for fast load times with reduced animation duration.
 */
export function SplashScreen({ onComplete, duration = 1500 }: SplashScreenProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    // Start fade out earlier for faster perceived load (at 1000ms)
    const fadeTimer = setTimeout(() => setIsFading(true), Math.max(800, duration - 500));

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
      className={`fixed inset-0 z-[100] flex items-center justify-center overflow-hidden transition-opacity duration-500 ${
        isFading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* Animated background */}
      <div className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950 splash-bg" />

      {/* Dynamic lines animation */}
      <div className="absolute inset-0 overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="splash-line"
            style={{
              top: `${15 + i * 12}%`,
              transform: `rotate(${-15 + i * 4}deg)`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>

      {/* Pulsing circles */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="splash-ring splash-ring-1" />
        <div className="splash-ring splash-ring-2" />
        <div className="splash-ring splash-ring-3" />
      </div>

      {/* Main logo container */}
      <div className="relative z-10 flex flex-col items-center splash-logo-enter">
        {/* Icon */}
        <div className="relative mb-4 splash-icon-enter">
          {/* Glow effect */}
          <div className="absolute inset-0 blur-2xl bg-primary-500/50 rounded-full splash-glow" />

          {/* Dumbbell Icon */}
          <svg
            className="w-24 h-24 text-primary-500 relative z-10"
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

        {/* App name with staggered letters - faster animation */}
        <div className="flex items-center gap-1">
          {APP_NAME.split('').map((letter, i) => (
            <span
              key={i}
              className="text-3xl md:text-4xl font-black text-surface-100 tracking-wider splash-letter"
              style={{ animationDelay: `${0.15 + i * 0.025}s` }}
            >
              {letter}
            </span>
          ))}
        </div>

        {/* Tagline */}
        <p className="mt-3 text-sm text-primary-400 font-medium tracking-widest uppercase splash-tagline">
          Train Smarter
        </p>

        {/* Loading bar */}
        <div className="mt-8 w-48 h-1 bg-surface-800 rounded-full overflow-hidden splash-bar-container">
          <div className="h-full bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 rounded-full splash-progress" />
        </div>
      </div>

      {/* Corner accents */}
      <div className="absolute top-0 left-0 w-32 h-32 splash-corner-tl">
        <div className="w-full h-full border-l-2 border-t-2 border-primary-500/30" />
      </div>
      <div className="absolute bottom-0 right-0 w-32 h-32 splash-corner-br">
        <div className="w-full h-full border-r-2 border-b-2 border-primary-500/30" />
      </div>

      {/* CSS Animations - optimized for faster load times */}
      <style jsx>{`
        .splash-bg {
          animation: bgScale 0.3s ease-out forwards;
        }

        .splash-line {
          position: absolute;
          height: 2px;
          left: -100%;
          right: -100%;
          background: linear-gradient(to right, transparent, rgb(var(--primary-500) / 0.3), transparent);
          animation: lineMove 0.8s ease-in-out forwards;
          opacity: 0;
        }

        .splash-ring {
          position: absolute;
          border-radius: 50%;
          border: 1px solid rgb(var(--primary-500) / 0.2);
          width: 100px;
          height: 100px;
          animation: ringExpand 1.2s ease-out infinite;
        }

        .splash-ring-1 { animation-delay: 0s; }
        .splash-ring-2 { animation-delay: 0.15s; }
        .splash-ring-3 { animation-delay: 0.3s; }

        .splash-logo-enter {
          animation: logoEnter 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .splash-icon-enter {
          animation: iconEnter 0.4s ease-out forwards;
        }

        .splash-glow {
          animation: glowPulse 1.2s ease-in-out infinite;
        }

        .splash-path {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          animation: pathDraw 0.6s ease-in-out forwards;
        }

        .splash-letter {
          opacity: 0;
          animation: letterEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .splash-tagline {
          opacity: 0;
          animation: taglineEnter 0.3s ease-out 0.4s forwards;
        }

        .splash-bar-container {
          opacity: 0;
          animation: barContainerEnter 0.2s ease-out 0.25s forwards;
        }

        .splash-progress {
          transform: translateX(-100%);
          animation: progressFill 0.9s ease-in-out 0.3s forwards;
        }

        .splash-corner-tl {
          animation: cornerTL 0.4s ease-out 0.1s both;
        }

        .splash-corner-br {
          animation: cornerBR 0.4s ease-out 0.1s both;
        }

        @keyframes bgScale {
          from { transform: scale(1); }
          to { transform: scale(1); }
        }

        @keyframes lineMove {
          0% { transform: translateX(-100%) rotate(inherit); opacity: 0; }
          25% { opacity: 1; }
          75% { opacity: 1; }
          100% { transform: translateX(100%) rotate(inherit); opacity: 0; }
        }

        @keyframes ringExpand {
          0% { width: 100px; height: 100px; opacity: 0.8; }
          100% { width: 400px; height: 400px; opacity: 0; }
        }

        @keyframes logoEnter {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        @keyframes iconEnter {
          from { transform: translateY(15px) rotateY(-90deg); opacity: 0; }
          to { transform: translateY(0) rotateY(0deg); opacity: 1; }
        }

        @keyframes glowPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }

        @keyframes pathDraw {
          to { stroke-dashoffset: 0; }
        }

        @keyframes letterEnter {
          from { transform: translateY(30px) rotateX(-90deg); opacity: 0; }
          to { transform: translateY(0) rotateX(0deg); opacity: 1; }
        }

        @keyframes taglineEnter {
          from { transform: translateY(15px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        @keyframes barContainerEnter {
          from { transform: scaleX(0); opacity: 0; }
          to { transform: scaleX(1); opacity: 1; }
        }

        @keyframes progressFill {
          to { transform: translateX(0); }
        }

        @keyframes cornerTL {
          from { transform: translate(-60px, -60px); }
          to { transform: translate(0, 0); }
        }

        @keyframes cornerBR {
          from { transform: translate(60px, 60px); }
          to { transform: translate(0, 0); }
        }
      `}</style>
    </div>
  );
}

