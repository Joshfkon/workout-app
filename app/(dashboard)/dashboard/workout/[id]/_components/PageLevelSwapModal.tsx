'use client';

import { Input } from '@/components/ui';
import type { Exercise } from '@/types/schema';
import { getExerciseInjuryRisk } from '../_lib/injuryRisk';
import type { AvailableExercise, ExerciseBlockWithExercise } from '../_lib/types';

interface PageLevelSwapModalProps {
  isOpen: boolean;
  swapTargetBlockId: string | null;
  blocks: ExerciseBlockWithExercise[];
  availableExercises: AvailableExercise[];
  temporaryInjuries: { area: string; severity: 1 | 2 | 3 }[];
  swapSearchQuery: string;
  onSwapSearchQueryChange: (query: string) => void;
  onClose: () => void;
  onExerciseSwap: (blockId: string, newExercise: Exercise) => Promise<void>;
  onExerciseDelete: (blockId: string) => Promise<void>;
  onAutoAdjustMessage: (message: string) => void;
}

export function PageLevelSwapModal({
  isOpen,
  swapTargetBlockId,
  blocks,
  availableExercises,
  temporaryInjuries,
  swapSearchQuery,
  onSwapSearchQueryChange,
  onClose,
  onExerciseSwap,
  onExerciseDelete,
  onAutoAdjustMessage,
}: PageLevelSwapModalProps) {
  if (!isOpen || !swapTargetBlockId) return null;

  const targetBlock = blocks.find(b => b.id === swapTargetBlockId);
  if (!targetBlock) return null;

  // Get safe alternatives using the intelligent injury swapper
  const safeAlternatives = availableExercises
    .filter(ex => {
      // Must target same muscle
      if (ex.primary_muscle !== targetBlock.exercise.primaryMuscle) return false;
      // Must not be the current exercise
      if (ex.id === targetBlock.exercise.id) return false;
      // Must not already be in workout
      if (blocks.some(b => b.exercise.id === ex.id)) return false;
      // Check search filter
      if (swapSearchQuery && !ex.name.toLowerCase().includes(swapSearchQuery.toLowerCase())) return false;
      // Check if safe for injuries
      const risk = getExerciseInjuryRisk(
        { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
        temporaryInjuries
      );
      return !risk.isRisky || risk.risk === 'caution';
    })
    .map(ex => {
      const risk = getExerciseInjuryRisk(
        { ...targetBlock.exercise, id: ex.id, name: ex.name, primaryMuscle: ex.primary_muscle },
        temporaryInjuries
      );
      return { exercise: ex, risk };
    })
    .sort((a, b) => {
      // Safe first, then caution
      if (a.risk.risk === 'safe' && b.risk.risk !== 'safe') return -1;
      if (a.risk.risk !== 'safe' && b.risk.risk === 'safe') return 1;
      return a.exercise.name.localeCompare(b.exercise.name);
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div className="relative w-full max-w-lg max-h-[85vh] bg-surface-900 rounded-t-2xl sm:rounded-2xl border border-surface-800 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-surface-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-surface-100">Swap Exercise</h3>
              <p className="text-sm text-surface-400">
                Replace <span className="text-warning-400 font-medium">{targetBlock.exercise.name}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-surface-400 hover:text-surface-200"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="mt-3">
            <Input
              placeholder="Search exercises..."
              value={swapSearchQuery}
              onChange={(e) => onSwapSearchQueryChange(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {/* Info banner */}
          <div className={`mb-3 p-3 rounded-lg ${
            safeAlternatives.length > 0
              ? 'bg-success-500/10 border border-success-500/20'
              : 'bg-warning-500/10 border border-warning-500/20'
          }`}>
            {safeAlternatives.length > 0 ? (
              <p className="text-xs text-success-400">
                ✓ <span className="font-medium">{safeAlternatives.filter(a => a.risk.risk === 'safe').length} safe alternative(s)</span> found for {targetBlock.exercise.primaryMuscle}
              </p>
            ) : (
              <p className="text-xs text-warning-400">
                ⚠️ No safe alternatives found. Consider skipping this exercise.
              </p>
            )}
          </div>

          {/* Exercise list */}
          <div className="space-y-1">
            {safeAlternatives.map(({ exercise: alt, risk }) => (
              <button
                key={alt.id}
                onClick={async () => {
                  // Perform the swap
                  await onExerciseSwap(swapTargetBlockId, {
                    id: alt.id,
                    name: alt.name,
                    primaryMuscle: alt.primary_muscle,
                    secondaryMuscles: alt.secondary_muscles || [],
                    mechanic: alt.mechanic,
                    defaultRepRange: [8, 12] as [number, number],
                    defaultRir: 2,
                    minWeightIncrementKg: 2.5,
                    formCues: [],
                    commonMistakes: [],
                    setupNote: '',
                    movementPattern: '',
                    equipmentRequired: [],
                  });
                  onClose();
                  onAutoAdjustMessage(`✓ Swapped ${targetBlock.exercise.name} → ${alt.name}`);
                }}
                className="w-full p-3 text-left rounded-lg hover:bg-surface-800 transition-colors flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-surface-100 truncate">{alt.name}</p>
                    {risk.risk === 'safe' && temporaryInjuries.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-success-500/20 text-success-400">
                        ✓ Safe
                      </span>
                    )}
                    {risk.risk === 'caution' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning-500/20 text-warning-400">
                        ⚠️ Caution
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-500 capitalize">
                    {alt.primary_muscle} • {alt.mechanic}
                  </p>
                </div>
                <svg className="w-4 h-4 text-surface-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {safeAlternatives.length === 0 && (
              <p className="py-8 text-center text-surface-500">
                No safe alternatives found for {targetBlock.exercise.primaryMuscle}
              </p>
            )}
          </div>
        </div>

        {/* Skip option */}
        <div className="p-3 border-t border-surface-800 bg-surface-800/50">
          <button
            onClick={async () => {
              await onExerciseDelete(swapTargetBlockId);
              onClose();
              onAutoAdjustMessage(`Removed ${targetBlock.exercise.name} from workout`);
            }}
            className="w-full py-2.5 px-4 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-300 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Skip this exercise
          </button>
        </div>
      </div>
    </div>
  );
}
