'use client';

import { useState, useEffect, useRef } from 'react';
import { formatWeight, inputWeightToKg } from '@/lib/utils';
import type { WeightUnit } from '@/types/schema';

// Standard plate weights in lbs and kg
const PLATES_LB = [45, 35, 25, 10, 5, 2.5];
const PLATES_KG = [25, 20, 15, 10, 5, 2.5, 1.25];

interface DropsetPromptProps {
  parentWeight: number; // in kg
  dropNumber: number; // 1 = first drop, 2 = second drop, etc.
  totalDrops: number;
  dropPercentage: number; // 0.25 = 25% reduction
  unit: WeightUnit;
  exerciseEquipment?: string[];
  onComplete: (data: { weightKg: number; reps: number; rpe: number }) => void;
  onCancel: () => void;
}

// Calculate plates to remove for a weight change (barbell exercises)
function calculatePlateChange(
  fromWeightKg: number,
  toWeightKg: number,
  unit: WeightUnit
): { action: 'remove' | 'add'; plates: string } | null {
  const barbellWeight = unit === 'lb' ? 20.4 : 20; // 45 lb or 20 kg barbell

  const fromPlateWeight = (fromWeightKg - barbellWeight) / 2;
  const toPlateWeight = (toWeightKg - barbellWeight) / 2;

  if (fromPlateWeight <= 0 || toPlateWeight <= 0) return null;

  const weightDiffPerSide = fromPlateWeight - toPlateWeight;
  if (weightDiffPerSide <= 0) return null;

  const plates = unit === 'lb' ? PLATES_LB : PLATES_KG;
  const result: number[] = [];
  let remaining = unit === 'lb' ? weightDiffPerSide * 2.205 : weightDiffPerSide;

  for (const plate of plates) {
    while (remaining >= plate - 0.01) {
      result.push(plate);
      remaining -= plate;
    }
  }

  if (result.length === 0) return null;

  // Group same plates together
  const grouped = result.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  const description = Object.entries(grouped)
    .map(([weight, count]) => count > 1 ? `${count}x${weight}` : `${weight}`)
    .join(' + ');

  return {
    action: 'remove',
    plates: `${description} ${unit} each side`
  };
}

export function DropsetPrompt({
  parentWeight,
  dropNumber,
  totalDrops,
  dropPercentage,
  unit,
  exerciseEquipment = [],
  onComplete,
  onCancel,
}: DropsetPromptProps) {
  // Calculate target drop weight (reduce by dropPercentage)
  const targetWeight = parentWeight * (1 - dropPercentage);
  const displayTargetWeight = unit === 'lb'
    ? Math.round(targetWeight * 2.205 / 5) * 5 // Round to nearest 5 lbs
    : Math.round(targetWeight / 2.5) * 2.5; // Round to nearest 2.5 kg

  const [weight, setWeight] = useState(displayTargetWeight.toString());
  const [reps, setReps] = useState('');
  const [rpe, setRpe] = useState('10'); // Dropsets typically go to failure

  const repsInputRef = useRef<HTMLInputElement>(null);

  // Check if this is a barbell exercise
  const isBarbell = exerciseEquipment.some(e =>
    e.toLowerCase().includes('barbell') || e.toLowerCase().includes('bar')
  );

  // Calculate plate change helper
  const plateChange = isBarbell
    ? calculatePlateChange(
        parentWeight,
        inputWeightToKg(parseFloat(weight) || displayTargetWeight, unit),
        unit
      )
    : null;

  // Trigger haptic feedback on mount
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([50, 30, 50]); // Short double pulse
    }
  }, []);

  // Auto-focus reps input after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      repsInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = () => {
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps);
    const rpeNum = parseFloat(rpe);

    if (isNaN(weightNum) || isNaN(repsNum) || weightNum <= 0 || repsNum <= 0) {
      return;
    }

    onComplete({
      weightKg: inputWeightToKg(weightNum, unit),
      reps: repsNum,
      rpe: isNaN(rpeNum) ? 10 : rpeNum,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <tr>
      <td colSpan={6} className="p-0">
        <div className="relative border-l-4 border-purple-500 bg-gradient-to-r from-purple-500/20 to-purple-500/5">
          {/* Pulsing glow effect for urgency */}
          <div className="absolute inset-0 animate-pulse bg-purple-500/10 pointer-events-none" />

          <div className="relative px-4 py-3">
            {/* Header with drop indicator */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 text-purple-400">
                  <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="font-bold text-lg">DROP NOW</span>
                </div>
                {totalDrops > 1 && (
                  <span className="text-xs text-purple-300 bg-purple-500/20 px-2 py-0.5 rounded-full">
                    Drop {dropNumber}/{totalDrops}
                  </span>
                )}
              </div>
              <button
                onClick={onCancel}
                className="text-surface-400 hover:text-surface-300 p-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Target weight display */}
            <div className="text-center mb-3">
              <span className="text-3xl font-bold text-white">
                {displayTargetWeight} {unit}
              </span>
            </div>

            {/* Plate math helper for barbell exercises */}
            {plateChange && (
              <div className="text-center mb-3 text-sm text-purple-300 bg-purple-500/10 rounded-lg py-2 px-3">
                <span className="font-medium">Remove:</span> {plateChange.plates}
              </div>
            )}

            {/* Input row */}
            <div className="flex gap-2 items-center">
              <div className="flex-1">
                <label className="text-xs text-surface-400 block mb-1">Weight</label>
                <input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  onKeyDown={handleKeyDown}
                  step="0.5"
                  className="w-full px-3 py-2 bg-surface-900 border border-purple-500/50 rounded-lg text-center font-mono text-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-surface-400 block mb-1">Reps</label>
                <input
                  ref={repsInputRef}
                  type="number"
                  value={reps}
                  onChange={(e) => setReps(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="?"
                  className="w-full px-3 py-2 bg-surface-900 border border-purple-500/50 rounded-lg text-center font-mono text-lg text-white placeholder-surface-500 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-surface-400 block mb-1">RPE</label>
                <input
                  type="number"
                  value={rpe}
                  onChange={(e) => setRpe(e.target.value)}
                  onKeyDown={handleKeyDown}
                  step="0.5"
                  min="1"
                  max="10"
                  className="w-full px-3 py-2 bg-surface-900 border border-purple-500/50 rounded-lg text-center font-mono text-lg text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
              <div className="pt-5">
                <button
                  onClick={handleSubmit}
                  disabled={!reps || parseFloat(reps) <= 0}
                  className="p-3 rounded-lg bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* No rest indicator */}
            <div className="mt-2 text-center text-xs text-surface-500">
              No rest between drops - go immediately!
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
