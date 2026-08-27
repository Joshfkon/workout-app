'use client';

import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

export interface PRCelebrationData {
  /** Keyed per celebration so back-to-back PRs re-run the animation. */
  id: string;
  exerciseName: string;
  /** e.g. "New e1RM PR" / "New Weight PR". */
  title: string;
  /** e.g. "230 lbs · +4%". */
  detail: string;
}

interface PRCelebrationProps {
  celebration: PRCelebrationData | null;
  onDone: () => void;
}

const AUTO_DISMISS_MS = 2800;
const CONFETTI_COLORS = ['#facc15', '#38bdf8', '#4ade80', '#f472b6', '#fb923c', '#a78bfa'];
const CONFETTI_COUNT = 28;

interface ConfettiPiece {
  x: number; // horizontal drift in vw
  delay: number;
  duration: number;
  rotate: number;
  color: string;
  size: number;
  left: number; // launch position in %
}

function makeConfetti(): ConfettiPiece[] {
  // Purely visual randomness — regenerated per celebration.
  return Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
    x: (Math.random() - 0.5) * 30,
    delay: Math.random() * 0.4,
    duration: 1.6 + Math.random() * 1.2,
    rotate: (Math.random() - 0.5) * 720,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
    left: 10 + Math.random() * 80,
  }));
}

/**
 * Full-screen celebratory burst shown the moment a logged set beats the
 * exercise's record. Non-blocking: the confetti layer ignores pointers so
 * the workout stays interactive; tapping the badge dismisses early, and it
 * auto-dismisses after a couple of seconds either way.
 */
export function PRCelebration({ celebration, onDone }: PRCelebrationProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!celebration) return;
    const t = setTimeout(onDone, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [celebration, onDone]);

  // Regenerate the burst per celebration id (not per render).
  const confetti = useMemo(
    () => (celebration && !reduceMotion ? makeConfetti() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [celebration?.id, reduceMotion]
  );

  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key={celebration.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
          className="fixed inset-0 z-[90] pointer-events-none flex items-center justify-center p-6"
          aria-live="polite"
          role="status"
        >
          {/* Confetti burst (skipped under prefers-reduced-motion) */}
          {confetti.map((piece, i) => (
            <motion.span
              key={i}
              className="absolute top-[38%] rounded-sm"
              style={{
                left: `${piece.left}%`,
                width: piece.size,
                height: piece.size * 0.6,
                backgroundColor: piece.color,
              }}
              initial={{ y: 0, x: 0, opacity: 1, rotate: 0, scale: 1 }}
              animate={{
                y: [0, -120 - Math.abs(piece.x) * 3, 320],
                x: [0, piece.x * 6, piece.x * 10],
                rotate: piece.rotate,
                opacity: [1, 1, 0],
                scale: [1, 1, 0.8],
              }}
              transition={{ duration: piece.duration, delay: piece.delay, ease: 'easeOut' }}
            />
          ))}

          {/* Badge — tappable to dismiss early */}
          <motion.button
            type="button"
            onClick={onDone}
            className="pointer-events-auto relative flex flex-col items-center gap-1 rounded-2xl bg-surface-900/95 border border-yellow-500/40 shadow-xl shadow-yellow-500/20 px-8 py-6 text-center backdrop-blur"
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.5, opacity: 0, y: 20 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 400, damping: 22 }
            }
            aria-label={`${celebration.title}: ${celebration.exerciseName}, ${celebration.detail}. Dismiss.`}
          >
            <motion.span
              className="text-5xl"
              aria-hidden="true"
              animate={reduceMotion ? undefined : { rotate: [0, -12, 12, -8, 8, 0] }}
              transition={{ duration: 0.8, delay: 0.15 }}
            >
              🏆
            </motion.span>
            <span className="text-xl font-bold text-yellow-400 uppercase tracking-wide">
              {celebration.title}
            </span>
            <span className="text-surface-200 font-medium">{celebration.exerciseName}</span>
            <span className="text-surface-400 text-sm tabular-nums">{celebration.detail}</span>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
