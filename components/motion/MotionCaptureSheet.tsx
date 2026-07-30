'use client';

/**
 * In-workout wrapper for the motion-capture flow: a modal launched from an
 * exercise card on the active workout page. The flow inside is the same
 * ARM → dark screen → auto-stop → review machine as the standalone page,
 * locked to the launching exercise and defaulting the attach picker to that
 * block's most recent set. Closing the sheet mid-review does NOT lose the
 * capture — it's held in memory (lib/motion/pendingCapture) and restored
 * when the sheet reopens.
 */

import { Modal } from '@/components/ui';
import { MotionCaptureFlow } from './MotionCaptureFlow';
import type { MachineCalibration } from '@/types/motion';

interface MotionCaptureSheetProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  rawRetentionEnabled: boolean;
  calibrations: MachineCalibration[];
  exerciseNames: Record<string, string>;
  /** The exercise of the card that launched the sheet. */
  exerciseId: string;
  /** The block whose sets the attach picker should prefer. */
  blockId: string;
}

export function MotionCaptureSheet({
  isOpen,
  onClose,
  userId,
  rawRetentionEnabled,
  calibrations,
  exerciseNames,
  exerciseId,
  blockId,
}: MotionCaptureSheetProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Motion capture" size="md">
      <MotionCaptureFlow
        userId={userId}
        rawRetentionEnabled={rawRetentionEnabled}
        calibrations={calibrations}
        exerciseNames={exerciseNames}
        lockedExerciseId={exerciseId}
        defaultAttachBlockId={blockId}
      />
    </Modal>
  );
}
