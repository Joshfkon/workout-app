'use client';

import { useMemo, useState } from 'react';
import { Button, Modal, ModalFooter, Toggle } from '@/components/ui';
import {
  formatWorkoutShareText,
  type WorkoutShareTextInput,
} from '@/services/workoutShareText';

interface ShareWorkoutTextProps {
  input: Omit<WorkoutShareTextInput, 'cryptic'>;
}

/**
 * Share the finished workout as a Wordle-style plain-text grid.
 * Native builds get the OS share sheet (Capacitor Share plugin), web gets
 * navigator.share where available, otherwise clipboard + "Copied!".
 */
export function ShareWorkoutText({ input }: ShareWorkoutTextProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [cryptic, setCryptic] = useState(false);
  const [copied, setCopied] = useState(false);

  const shareText = useMemo(
    () => formatWorkoutShareText({ ...input, cryptic }),
    [input, cryptic]
  );

  const handleShare = async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ text: shareText });
        return;
      }
    } catch {
      // Plugin unavailable — fall through to the web paths.
    }

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch (err) {
        // User cancelled the sheet — not an error, and don't copy instead.
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions) — the preview is selectable as a last resort.
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setIsOpen(true)}>
        Share 📋
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Share Workout" size="sm">
        <div className="space-y-4">
          <pre className="whitespace-pre-wrap break-words rounded-lg bg-surface-900 border border-surface-700 p-4 font-mono text-sm text-surface-100 select-all">
            {shareText}
          </pre>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-200">Cryptic mode</p>
              <p className="text-xs text-surface-500">Hide exercise names — just flex the grid</p>
            </div>
            <Toggle checked={cryptic} onChange={setCryptic} />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Close
          </Button>
          <Button onClick={handleShare}>{copied ? '✓ Copied!' : 'Share 📋'}</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
