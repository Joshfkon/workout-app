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
          className="fixed inset-0 z-50 bg-surface-950/95 backdrop-blur-sm flex flex-col items-center justify-center"
          onClick={onResume}
        >
          {/* Pulsing ring animation behind button */}
          <div className="relative">
            <motion.div
              className="absolute inset-0 rounded-full bg-primary-500/20"
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
              className="relative w-32 h-32 rounded-full bg-primary-500 hover:bg-primary-400 transition-colors flex items-center justify-center shadow-lg shadow-primary-500/30"
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
            <p className="text-2xl font-bold text-warning-400 uppercase tracking-wider">
              Workout Paused
            </p>
            <p className="text-surface-400 mt-2">
              Elapsed time: <span className="font-mono text-surface-200">{elapsedTime}</span>
            </p>
          </motion.div>

          {/* Tap anywhere hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="absolute bottom-12 text-surface-500 text-sm"
          >
            Tap anywhere to resume
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
