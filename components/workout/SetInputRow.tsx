'use client';

import { useState, useEffect } from 'react';
import { Input, Button, Badge } from '@/components/ui';
import type { SetLog, SetQuality, WeightUnit } from '@/types/schema';
import { calculateSetQuality } from '@/services/progressionEngine';
import { formatWeightValue, inputWeightToKg, convertWeight } from '@/lib/utils';

interface SetInputRowProps {
  setNumber: number;
  targetWeight: number; // Always in kg
  targetRepRange: [number, number];
  targetRir: number;
  previousSet?: SetLog;
  isLastSet: boolean;
  onSubmit: (data: {
    weightKg: number;
    reps: number;
    rpe: number;
    note?: string;
  }) => void;
  disabled?: boolean;
  unit?: WeightUnit;
}

export function SetInputRow({
  setNumber,
  targetWeight,
  targetRepRange,
  targetRir,
  previousSet,
  isLastSet,
  onSubmit,
  disabled = false,
  unit = 'kg',
}: SetInputRowProps) {
  // Convert from kg to display unit
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
  const initialWeight = previousSet?.weightKg ?? targetWeight;
  
  const [weight, setWeight] = useState(String(displayWeight(initialWeight)));
  const [reps, setReps] = useState(String(previousSet?.reps ?? targetRepRange[1]));
  const [rpe, setRpe] = useState(String(previousSet?.rpe ?? (10 - targetRir)));
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [quality, setQuality] = useState<{ quality: SetQuality; reason: string } | null>(null);

  // Calculate quality preview as user types
  useEffect(() => {
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps);
    const rpeNum = parseFloat(rpe);

    if (!isNaN(weightNum) && !isNaN(repsNum) && !isNaN(rpeNum)) {
      const result = calculateSetQuality({
        rpe: rpeNum,
        targetRir,
        reps: repsNum,
        targetRepRange,
        isLastSet,
      });
      setQuality(result);
    } else {
      setQuality(null);
    }
  }, [weight, reps, rpe, targetRir, targetRepRange, isLastSet]);

  const handleSubmit = () => {
    const weightNum = parseFloat(weight);
    const repsNum = parseInt(reps);
    const rpeNum = parseFloat(rpe);

    if (isNaN(weightNum) || isNaN(repsNum) || isNaN(rpeNum)) {
      return;
    }

    // Convert from display unit to kg for storage
    const weightKg = inputWeightToKg(weightNum, unit);

    onSubmit({
      weightKg,
      reps: repsNum,
      rpe: rpeNum,
      note: note || undefined,
    });

    // Reset note
    setNote('');
    setShowNote(false);
  };

  const getQualityColor = (q: SetQuality) => {
    switch (q) {
      case 'junk': return 'text-surface-500';
      case 'effective': return 'text-primary-400';
      case 'stimulative': return 'text-success-400';
      case 'excessive': return 'text-danger-400';
    }
  };

  return (
    <div className="bg-surface-800/50 rounded-lg p-3 space-y-3">
      {/* Set header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-surface-300">
          Set {setNumber}
        </span>
        {quality && (
          <span className={`text-xs ${getQualityColor(quality.quality)}`}>
            {quality.quality}
          </span>
        )}
      </div>

      {/* Input row */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-surface-500 mb-1">Weight ({unit})</label>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            disabled={disabled}
            step="0.5"
            min="0"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-surface-500 mb-1">Reps</label>
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            disabled={disabled}
            min="0"
            max="100"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-surface-500 mb-1">RPE</label>
          <input
            type="number"
            value={rpe}
            onChange={(e) => setRpe(e.target.value)}
            disabled={disabled}
            step="0.5"
            min="1"
            max="10"
            className="w-full px-3 py-2 bg-surface-900 border border-surface-700 rounded-lg text-surface-100 text-center font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={disabled}
          size="md"
          className="shrink-0"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </Button>
      </div>

      {/* Note toggle and input */}
      {!showNote ? (
        <button
          onClick={() => setShowNote(true)}
          className="text-xs text-surface-500 hover:text-surface-400 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add note
        </button>
      ) : (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Set note (optional)"
          className="w-full px-3 py-1.5 bg-surface-900 border border-surface-700 rounded-lg text-sm text-surface-300 placeholder:text-surface-600 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />
      )}

      {/* Quality feedback */}
      {quality && (
        <p className="text-xs text-surface-500 italic">
          {quality.reason}
        </p>
      )}
    </div>
  );
}

