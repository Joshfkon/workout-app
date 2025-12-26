'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import type { WarmupSet, WeightUnit } from '@/types/schema';
import { roundToPlateIncrement, formatWeightValue } from '@/lib/utils';

interface WarmupProtocolProps {
  warmupSets: WarmupSet[];
  workingWeight: number;
  minIncrement: number;
  onComplete?: () => void;
  unit?: WeightUnit;
  /** Barbell weight in kg for bar-only warmups (defaults to 20kg for Olympic barbell) */
  barbellWeightKg?: number;
}

export function WarmupProtocol({
  warmupSets,
  workingWeight,
  minIncrement,
  onComplete,
  unit = 'kg',
  barbellWeightKg = 20,
}: WarmupProtocolProps) {
  const [completedSets, setCompletedSets] = useState<Set<number>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleSet = (setNumber: number) => {
    setCompletedSets((prev) => {
      const next = new Set(prev);
      if (next.has(setNumber)) {
        next.delete(setNumber);
      } else {
        next.add(setNumber);
        // Check if all sets completed
        if (next.size === warmupSets.length) {
          onComplete?.();
        }
      }
      return next;
    });
  };

  const allCompleted = completedSets.size === warmupSets.length;

  if (warmupSets.length === 0) {
    return null;
  }

  return (
    <Card variant="bordered" padding="none" className="overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-surface-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
              allCompleted
                ? 'bg-success-500/20 text-success-400'
                : 'bg-surface-700 text-surface-300'
            }`}
          >
            {allCompleted ? '✓' : completedSets.size}
          </div>
          <span className="text-sm font-medium text-surface-200">
            Warmup Protocol
          </span>
          <span className="text-xs text-surface-500">
            ({completedSets.size}/{warmupSets.length})
          </span>
        </div>
        <svg
          className={`w-4 h-4 text-surface-400 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-surface-800">
          <div className="divide-y divide-surface-800">
            {warmupSets.map((set) => {
              const warmupWeightKg = workingWeight * (set.percentOfWorking / 100);
              // Round to 2.5lb/2.5kg increments based on user unit preference
              const roundedWeight = roundToPlateIncrement(warmupWeightKg, unit);
              const displayWeight = formatWeightValue(roundedWeight, unit);
              const unitLabel = unit === 'lb' ? 'lb' : 'kg';

              // Determine warmup weight display
              let warmupWeight: string;
              if (set.percentOfWorking === 0) {
                // General warmup with no weight specified
                warmupWeight = 'Empty bar';
              } else if (set.isBarOnly) {
                // Bar-only warmup: show the barbell weight
                const barDisplay = formatWeightValue(barbellWeightKg, unit);
                warmupWeight = `Bar only (${barDisplay} ${unitLabel})`;
              } else if (roundedWeight === 0) {
                warmupWeight = 'Empty bar';
              } else {
                warmupWeight = `${displayWeight} ${unitLabel}`;
              }

              const isCompleted = completedSets.has(set.setNumber);

              return (
                <button
                  key={set.setNumber}
                  onClick={() => toggleSet(set.setNumber)}
                  className={`w-full flex items-center gap-3 p-3 text-left transition-colors ${
                    isCompleted
                      ? 'bg-success-500/5'
                      : 'hover:bg-surface-800/50'
                  }`}
                >
                  {/* Checkbox */}
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      isCompleted
                        ? 'bg-success-500 border-success-500'
                        : 'border-surface-600'
                    }`}
                  >
                    {isCompleted && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Set info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span
                        className={`font-mono text-sm ${
                          isCompleted ? 'text-surface-500' : 'text-surface-200'
                        }`}
                      >
                        {warmupWeight}
                      </span>
                      <span className="text-surface-500">×</span>
                      <span
                        className={`font-mono text-sm ${
                          isCompleted ? 'text-surface-500' : 'text-surface-200'
                        }`}
                      >
                        {set.targetReps} reps
                      </span>
                      {set.percentOfWorking > 0 && (
                        <span className="text-xs text-surface-600">
                          ({set.percentOfWorking}%)
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-xs mt-0.5 ${
                        isCompleted ? 'text-surface-600' : 'text-surface-500'
                      }`}
                    >
                      {set.purpose}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Skip all button */}
          {!allCompleted && (
            <div className="p-3 bg-surface-800/30">
              <button
                onClick={() => {
                  setCompletedSets(new Set(warmupSets.map((s) => s.setNumber)));
                  onComplete?.();
                }}
                className="w-full text-xs text-surface-500 hover:text-surface-400 transition-colors"
              >
                Skip warmup (already warm)
              </button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

