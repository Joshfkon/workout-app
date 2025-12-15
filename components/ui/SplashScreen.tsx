'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface SplashScreenProps {
  onComplete: () => void;
  duration?: number; // milliseconds
}

export function SplashScreen({ onComplete, duration = 2500 }: SplashScreenProps) {
  const [phase, setPhase] = useState<'logo' | 'expand' | 'fade'>('logo');

  useEffect(() => {
    // Phase 1: Logo animation (0-1500ms)
    const expandTimer = setTimeout(() => setPhase('expand'), 1500);
    
    // Phase 2: Expand and fade (1500-2500ms)
    const fadeTimer = setTimeout(() => setPhase('fade'), 2000);
    
    // Complete
    const completeTimer = setTimeout(() => onComplete(), duration);

    return () => {
      clearTimeout(expandTimer);
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [duration, onComplete]);

  return (
    <AnimatePresence>
      {phase !== 'fade' && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          {/* Animated background */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950"
            initial={{ scale: 1 }}
            animate={phase === 'expand' ? { scale: 1.2 } : { scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />

          {/* Dynamic lines animation */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(8)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute h-[2px] bg-gradient-to-r from-transparent via-primary-500/30 to-transparent"
                style={{
                  top: `${15 + i * 12}%`,
                  left: '-100%',
                  right: '-100%',
                  transform: `rotate(${-15 + i * 4}deg)`,
                }}
                initial={{ x: '-100%', opacity: 0 }}
                animate={{ 
                  x: ['100%', '-100%'],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 1.5,
                  delay: i * 0.1,
                  ease: 'easeInOut',
                }}
              />
            ))}
          </div>

          {/* Pulsing circles */}
          <div className="absolute inset-0 flex items-center justify-center">
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-primary-500/20"
                initial={{ width: 100, height: 100, opacity: 0 }}
                animate={{
                  width: [100, 400 + i * 100],
                  height: [100, 400 + i * 100],
                  opacity: [0.8, 0],
                }}
                transition={{
                  duration: 2,
                  delay: i * 0.3,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
              />
            ))}
          </div>

          {/* Main logo container */}
          <motion.div
            className="relative z-10 flex flex-col items-center"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ 
              duration: 0.6, 
              ease: [0.34, 1.56, 0.64, 1], // Spring-like bounce
            }}
          >
            {/* Icon */}
            <motion.div
              className="relative mb-4"
              initial={{ y: 20, rotateY: -90 }}
              animate={{ y: 0, rotateY: 0 }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            >
              {/* Glow effect */}
              <motion.div
                className="absolute inset-0 blur-2xl bg-primary-500/50 rounded-full"
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 0.8, 0.5],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
              
              {/* Dumbbell Icon */}
              <motion.svg
                className="w-24 h-24 text-primary-500 relative z-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.5, ease: 'easeInOut' }}
              >
                <motion.path
                  d="M6.5 6.5V17.5M17.5 6.5V17.5M6.5 12H17.5M4 8V16M20 8V16M2 9.5V14.5M22 9.5V14.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.2, ease: 'easeInOut' }}
                />
              </motion.svg>
            </motion.div>

            {/* App name with staggered letters */}
            <div className="flex items-center gap-1">
              {'HYPERTROPHY'.split('').map((letter, i) => (
                <motion.span
                  key={i}
                  className="text-3xl md:text-4xl font-black text-surface-100 tracking-wider"
                  initial={{ y: 50, opacity: 0, rotateX: -90 }}
                  animate={{ y: 0, opacity: 1, rotateX: 0 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.3 + i * 0.05,
                    ease: [0.34, 1.56, 0.64, 1],
                  }}
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* Tagline */}
            <motion.p
              className="mt-3 text-sm text-primary-400 font-medium tracking-widest uppercase"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1, duration: 0.5 }}
            >
              Train Smarter
            </motion.p>

            {/* Loading bar */}
            <motion.div
              className="mt-8 w-48 h-1 bg-surface-800 rounded-full overflow-hidden"
              initial={{ opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ delay: 0.5, duration: 0.3 }}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-primary-500 via-accent-500 to-primary-500 rounded-full"
                initial={{ x: '-100%' }}
                animate={{ x: '0%' }}
                transition={{ 
                  duration: 1.8,
                  delay: 0.6,
                  ease: 'easeInOut',
                }}
              />
            </motion.div>
          </motion.div>

          {/* Corner accents */}
          <motion.div
            className="absolute top-0 left-0 w-32 h-32"
            initial={{ x: -100, y: -100 }}
            animate={{ x: 0, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-full h-full border-l-2 border-t-2 border-primary-500/30" />
          </motion.div>
          
          <motion.div
            className="absolute bottom-0 right-0 w-32 h-32"
            initial={{ x: 100, y: 100 }}
            animate={{ x: 0, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
          >
            <div className="w-full h-full border-r-2 border-b-2 border-primary-500/30" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

