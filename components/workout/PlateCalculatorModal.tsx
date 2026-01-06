'use client';

import { memo, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { PlateCalculator } from './PlateCalculator';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { loadMachineStartingWeight, saveMachineStartingWeight } from '@/lib/actions/exercise-settings';
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
  /** Exercise ID to save/load starting weight for */
  exerciseId?: string;
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
  exerciseId,
}: PlateCalculatorModalProps) {
  const { preferences } = useUserPreferences();
  const unit = unitOverride ?? preferences.units;
  const [startingWeightKg, setStartingWeightKg] = useState<number | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  // Load starting weight when modal opens and exerciseId is provided
  useEffect(() => {
    if (isOpen && exerciseId) {
      setIsLoading(true);
      loadMachineStartingWeight(exerciseId)
        .then(({ startingWeightKg: loaded }) => {
          setStartingWeightKg(loaded ?? undefined);
        })
        .catch((error) => {
          console.error('Error loading starting weight:', error);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else if (!isOpen) {
      // Reset when modal closes
      setStartingWeightKg(undefined);
    }
  }, [isOpen, exerciseId]);

  // Save starting weight when it changes
  const handleStartingWeightChange = async (weightKg: number | undefined) => {
    setStartingWeightKg(weightKg);
    if (exerciseId) {
      await saveMachineStartingWeight(exerciseId, weightKg ?? null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Plate Calculator"
      description="Calculate which plates to load on each side of the barbell"
      size="lg"
    >
      {isLoading ? (
        <div className="p-4 text-center text-gray-400">Loading...</div>
      ) : (
        <PlateCalculator
          initialWeightKg={initialWeightKg}
          unit={unit}
          startingWeightKg={startingWeightKg}
          onStartingWeightChange={exerciseId ? handleStartingWeightChange : undefined}
        />
      )}
    </Modal>
  );
});

export default PlateCalculatorModal;
