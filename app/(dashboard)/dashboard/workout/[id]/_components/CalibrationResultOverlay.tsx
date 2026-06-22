'use client';

import { CalibrationResultCard } from '@/components/workout/CalibrationResultCard';
import type { CalibrationResult } from '@/services/rpeCalibration';

interface CalibrationResultOverlayProps {
  result: CalibrationResult | null;
  onDismiss: () => void;
}

export function CalibrationResultOverlay({ result, onDismiss }: CalibrationResultOverlayProps) {
  if (!result) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="max-w-md w-full">
        <CalibrationResultCard
          result={result}
          onDismiss={onDismiss}
        />
      </div>
    </div>
  );
}
