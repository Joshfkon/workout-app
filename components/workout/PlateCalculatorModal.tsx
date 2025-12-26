'use client';

import { memo } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PlateCalculator } from './PlateCalculator';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import type { WeightUnit } from '@/types/schema';

interface PlateCalculatorModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Initial target weight in kg */
  initialWeightKg?: number;
  /** Override unit preference (uses user preference if not provided) */
  unit?: WeightUnit;
}

/**
 * Modal wrapper for the PlateCalculator component
 * Automatically uses user's unit preference
 */
export const PlateCalculatorModal = memo(function PlateCalculatorModal({
  isOpen,
  onClose,
  initialWeightKg,
  unit: unitOverride,
}: PlateCalculatorModalProps) {
  const { preferences } = useUserPreferences();
  const unit = unitOverride ?? preferences.units;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Plate Calculator"
      description="Calculate which plates to load on each side of the barbell"
      size="md"
    >
      <PlateCalculator
        initialWeightKg={initialWeightKg}
        unit={unit}
      />
    </Modal>
  );
});

export default PlateCalculatorModal;
