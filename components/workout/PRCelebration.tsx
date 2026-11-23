'use client';

import { IconTrophy } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { successHaptic } from '@/lib/integrations/notifications';

export interface PRCelebrationData {
  /** Keyed per celebration so back-to-back PRs re-run the animation. */
  id: string;
  exerciseName: string;
  /** e.g. "New e1RM PR" / "New weight PR". */
  title: string;
  /** e.g. "230 lbs · +4%". */
  detail: string;
}

interface PRCelebrationProps {
  celebration: PRCelebrationData | null;
  onDone: () => void;
}

// Short dwell: the next set's suggestion (and its reason) is what the lifter
// needs next, and the popup used to sit over it for 3 s (UX panel round 19).
export const PR_CELEBRATION_DWELL_MS = 2000;
const AUTO_DISMISS_MS = PR_CELEBRATION_DWELL_MS;
const INTERACTION_DELAY_MS = 200; // Brief delay before interaction-based dismiss
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
    duration: 1.2 + Math.random() * 0.8,
    rotate: (Math.random() - 0.5) * 720,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
    left: 10 + Math.random() * 80,
  }));
}

/**
 * Celebratory burst shown the moment a logged set beats the exercise's
 * record. Non-blocking: the confetti layer ignores pointers so the workout
 * stays interactive; tapping the badge dismisses early, and it auto-dismisses
 * after two seconds either way.
 *
 * The badge is a compact banner at the TOP of the screen, not a card in the
 * middle: mid-screen it sat exactly over the exercise card's next-set
 * suggestion and its "Why:" line (UX panel: the Hevy switcher never saw why
 * set 2 was picked). The bottom band belongs to the toast, rest timer and
 * pinned Log set bar, so the top is the one place it covers nothing needed.
 */
export function PRCelebration({ celebration, onDone }: PRCelebrationProps) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!celebration) return;

    // A success tap the moment a PR lands (native only; no-op on web).
    void successHaptic();

    // Auto-dismiss after timeout
    const autoTimeout = setTimeout(onDone, AUTO_DISMISS_MS);

    // Dismiss on any browser interaction after a brief delay
    // (delay prevents dismissing from the same interaction that triggered the PR)
    let interactionTimeout: ReturnType<typeof setTimeout>;
    let listenersActive = false;

    const handleInteraction = () => {
      if (listenersActive) {
        onDone();
      }
    };

    interactionTimeout = setTimeout(() => {
      listenersActive = true;
      // Listen for any user interaction
      window.addEventListener('click', handleInteraction, { capture: true });
      window.addEventListener('keydown', handleInteraction, { capture: true });
      window.addEventListener('scroll', handleInteraction, { capture: true, passive: true });
      window.addEventListener('touchstart', handleInteraction, { capture: true, passive: true });
    }, INTERACTION_DELAY_MS);

    return () => {
      clearTimeout(autoTimeout);
      clearTimeout(interactionTimeout);
      // Clean up event listeners
      window.removeEventListener('click', handleInteraction, { capture: true });
      window.removeEventListener('keydown', handleInteraction, { capture: true });
      // @ts-expect-error - passive option exists but TS doesn't recognize it in removeEventListener
      window.removeEventListener('scroll', handleInteraction, { capture: true, passive: true });
      // @ts-expect-error - passive option exists but TS doesn't recognize it in removeEventListener
      window.removeEventListener('touchstart', handleInteraction, { capture: true, passive: true });
    };
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
          data-testid="pr-celebration"
          className="fixed inset-x-0 top-0 z-[90] pointer-events-none flex items-start justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]"
          aria-live="polite"
          role="status"
        >
          {/* Confetti burst (skipped under prefers-reduced-motion) */}
          {confetti.map((piece, i) => (
            <motion.span
              key={i}
              className="absolute top-12 rounded-sm"
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
            className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 rounded-2xl bg-card/95 border border-status-warn/40 shadow-xl shadow-status-warn/20 px-4 py-3 text-left backdrop-blur"
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.9, opacity: 0, y: -20 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={
              reduceMotion ? { duration: 0.2 } : { type: 'spring', stiffness: 400, damping: 22 }
            }
            aria-label={`${celebration.title}: ${celebration.exerciseName}, ${celebration.detail}. Dismiss.`}
          >
            <motion.span
              className="flex-shrink-0 text-status-warn"
              aria-hidden="true"
              animate={reduceMotion ? undefined : { rotate: [0, -12, 12, -8, 8, 0] }}
              transition={{ duration: 0.8, delay: 0.15 }}
            >
              <IconTrophy className="h-8 w-8" stroke={1.75} aria-hidden="true" />
            </motion.span>
            <span className="min-w-0 flex-1 leading-snug">
              <span className="block text-headline">
                <span className="font-bold text-status-warn">{celebration.title}</span>
                <span className="text-ink-3" aria-hidden="true">
                  {' · '}
                </span>
                <span className="font-medium text-ink">{celebration.exerciseName}</span>
              </span>
              <span className="block text-ink-2 text-subhead tabular-nums">{celebration.detail}</span>
            </span>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
