'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface PauseOverlayProps {
  isPaused: boolean;
  elapsedTime: string;
  onResume: () => void;
}

export function PauseOverlay({ isPaused, elapsedTime, onResume }: PauseOverlayProps) {
  return (
    <AnimatePresence>
      {isPaused && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 bg-canvas/95 backdrop-blur-sm flex flex-col items-center justify-center"
          onClick={onResume}
        >
          {/* Pulsing ring animation behind button */}
          <div className="relative">
            <motion.div
              className="absolute inset-0 rounded-full bg-action/20"
              animate={{
                scale: [1, 1.5, 1],
                opacity: [0.5, 0, 0.5],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              style={{ width: 160, height: 160, marginLeft: -16, marginTop: -16 }}
            />

            {/* Large play button */}
            <motion.button
              onClick={onResume}
              className="relative w-32 h-32 rounded-full bg-action hover:bg-action transition-colors flex items-center justify-center shadow-lg shadow-action/30"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              aria-label="Resume workout"
            >
              {/* Play icon - slightly offset to the right for visual centering */}
              <svg
                className="w-16 h-16 text-white ml-2"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </motion.button>
          </div>

          {/* Status text */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-8 text-center"
          >
            <p className="text-title font-bold text-status-warn">
              Workout paused
            </p>
            <p className="text-ink-2 mt-2">
              Elapsed time: <span className="font-mono text-ink">{elapsedTime}</span>
            </p>
          </motion.div>

          {/* Tap anywhere hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="absolute bottom-12 text-ink-3 text-subhead"
          >
            Tap anywhere to resume
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
