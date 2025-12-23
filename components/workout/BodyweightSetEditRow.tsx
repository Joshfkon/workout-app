'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { BodyweightInput } from './BodyweightInput';
import type {
  SetLog,
  WeightUnit,
  BodyweightData,
} from '@/types/schema';
import { formatWeightValue, inputWeightToKg } from '@/lib/utils';

interface BodyweightSetEditRowProps {
  set: SetLog;
  /** User's current body weight in kg */
  userBodyweightKg: number;
  /** Whether weight can be added */
  canAddWeight?: boolean;
  /** Whether assistance can be used */
  canUseAssistance?: boolean;
  /** Whether this is a pure bodyweight exercise */
  isPureBodyweight?: boolean;
  /** Weight unit for display */
  unit?: WeightUnit;
  /** Callback when edit is saved */
  onSave: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    bodyweightData: BodyweightData;
  }) => void;
  /** Callback when edit is cancelled */
  onCancel: () => void;
}

/**
 * Edit row for bodyweight sets
 * Allows editing bodyweight modifications (added weight, assistance) along with reps and RPE
 */
export function BodyweightSetEditRow({
  set,
  userBodyweightKg,
  canAddWeight = true,
  canUseAssistance = true,
  isPureBodyweight = false,
  unit = 'kg',
  onSave,
  onCancel,
}: BodyweightSetEditRowProps) {
  // Initialize from existing set data
  const [bodyweightData, setBodyweightData] = useState<BodyweightData>(() => {
    if (set.bodyweightData) {
      // Use existing bodyweight data but update userBodyweightKg to current
      return {
        ...set.bodyweightData,
        userBodyweightKg,
      };
    }
    // Default to pure bodyweight if no data exists
    return {
      userBodyweightKg,
      modification: 'none',
      effectiveLoadKg: userBodyweightKg,
    };
  });

  const [reps, setReps] = useState(String(set.reps));
  const [rpe, setRpe] = useState(String(set.rpe));

  // Update effective load when bodyweight data changes
  const handleBodyweightDataChange = (newData: BodyweightData) => {
    const { calculateEffectiveLoad } = require('@/types/schema');
    const effectiveLoad = calculateEffectiveLoad(
      newData.userBodyweightKg,
      newData.modification,
      newData.addedWeightKg,
      newData.assistanceWeightKg
    );
    setBodyweightData({
      ...newData,
      effectiveLoadKg: effectiveLoad,
    });
  };

  const handleSave = () => {
    const repsNum = parseInt(reps);
    const rpeNum = parseFloat(rpe);

    if (isNaN(repsNum) || repsNum < 1) {
      return;
    }

    if (isNaN(rpeNum) || rpeNum < 1 || rpeNum > 10) {
      return;
    }

    onSave({
      weightKg: bodyweightData.effectiveLoadKg,
      reps: repsNum,
      rpe: rpeNum,
      bodyweightData,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <tr className="bg-primary-500/10">
      <td className="px-3 py-2 text-surface-300 font-medium" colSpan={6}>
        <div className="space-y-3 p-3 bg-surface-800/50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-surface-200">Edit Set {set.setNumber}</span>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                size="sm"
                variant="primary"
              >
                Save
              </Button>
              <Button
                onClick={onCancel}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </div>

          {/* Bodyweight input */}
          <BodyweightInput
            userBodyweightKg={userBodyweightKg}
            canAddWeight={canAddWeight}
            canUseAssistance={canUseAssistance}
            isPureBodyweight={isPureBodyweight}
            value={bodyweightData}
            onChange={handleBodyweightDataChange}
            unit={unit}
          />

          {/* Reps and RPE inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-surface-500 mb-1">Reps</label>
              <input
                type="number"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                onKeyDown={handleKeyDown}
                min="1"
                max="100"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-surface-500 mb-1">RPE</label>
              <input
                type="number"
                value={rpe}
                onChange={(e) => setRpe(e.target.value)}
                onKeyDown={handleKeyDown}
                step="0.5"
                min="1"
                max="10"
                className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Effective load display */}
          <div className="text-xs text-surface-400 text-center">
            Effective Load: {formatWeightValue(bodyweightData.effectiveLoadKg, unit)} {unit}
          </div>
        </div>
      </td>
    </tr>
  );
}

