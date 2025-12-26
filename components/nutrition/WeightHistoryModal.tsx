'use client';

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SwipeableRow } from '@/components/ui/SwipeableRow';
import { convertWeight } from '@/lib/utils';
import type { WeightLogEntry } from '@/types/nutrition';

interface WeightHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: WeightLogEntry[];
  onEdit: (entry: WeightLogEntry) => void;
  onDelete: (id: string) => Promise<void>;
  preferredUnit?: 'lb' | 'kg'; // User's preferred unit for display
}

export function WeightHistoryModal({
  isOpen,
  onClose,
  entries,
  onEdit,
  onDelete,
  preferredUnit = 'lb',
}: WeightHistoryModalProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  // Convert weight to preferred unit with validation
  const convertWeightWithValidation = (weight: number, fromUnit: string | null | undefined): number => {
    // If unit is missing, try to infer from weight value
    if (!fromUnit) {
      if (preferredUnit === 'lb' && weight > 300) {
        // Likely stored in kg, convert
        return weight * 2.20462;
      } else if (preferredUnit === 'kg' && weight > 150) {
        // Likely stored in lb, convert
        return weight / 2.20462;
      }
      // Assume already in preferred unit
      return weight;
    }
    
    // Validate: detect mislabeled units
    // If unit says 'lb' but weight > 500, it's probably stored in kg (convert)
    // If unit says 'kg' but weight is in human range (150-200), it's probably mislabeled as kg but actually in lbs (don't convert, just use as-is)
    if (fromUnit === 'lb' && weight > 500) {
      return weight * 2.20462; // Convert from kg
    } else if (fromUnit === 'kg' && weight >= 150 && weight <= 200) {
      // Common weights 150-200 are human weights in lbs, mislabeled as kg
      // The weight is already in lbs, just mislabeled - don't convert, use as-is
      return weight; // Already in lbs, just mislabeled
    } else if (fromUnit === 'kg' && weight > 250) {
      // Weight > 250 kg is probably in lbs, convert
      return weight / 2.20462; // Convert from lb
    }
    
    // Normal conversion
    if (fromUnit === preferredUnit) return weight;
    return fromUnit === 'kg' ? weight * 2.20462 : weight / 2.20462;
  };

  // Calculate change from previous entry (in preferred unit)
  const getChange = (index: number) => {
    if (index >= entries.length - 1) return null;
    const current = convertWeightWithValidation(entries[index].weight, entries[index].unit);
    const previous = convertWeightWithValidation(entries[index + 1].weight, entries[index + 1].unit);
    return current - previous;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Weight History"
      description="Tap to edit, swipe left to delete"
      size="md"
    >
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {entries.length === 0 ? (
          <p className="text-center text-surface-400 py-8">No weight entries yet</p>
        ) : (
          entries.map((entry, index) => {
            const change = getChange(index);
            return (
              <SwipeableRow
                key={entry.id}
                onDelete={() => handleDelete(entry.id)}
              >
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  disabled={deletingId === entry.id}
                  className="w-full flex items-center gap-3 p-3 hover:bg-surface-800/50 rounded-lg transition-colors text-left disabled:opacity-50"
                >
                  {/* Date */}
                  <div className="flex-shrink-0 w-16 text-center">
                    <div className="text-sm font-medium text-surface-100">
                      {new Date(entry.logged_at + 'T00:00:00').toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </div>
                    <div className="text-xs text-surface-500">
                      {new Date(entry.logged_at + 'T00:00:00').toLocaleDateString('en-US', {
                        weekday: 'short',
                      })}
                    </div>
                  </div>

                  {/* Weight */}
                  <div className="flex-1">
                    <div className="text-lg font-semibold text-surface-100">
                      {(() => {
                        const displayWeight = convertWeightWithValidation(entry.weight, entry.unit);
                        return `${displayWeight.toFixed(1)} ${preferredUnit === 'kg' ? 'kg' : 'lbs'}`;
                      })()}
                    </div>
                    {entry.notes && (
                      <div className="text-xs text-surface-500 truncate max-w-[200px]">
                        {entry.notes}
                      </div>
                    )}
                  </div>

                  {/* Change indicator */}
                  {change !== null && (
                    <div className={`flex-shrink-0 text-right ${
                      change > 0 ? 'text-danger-400' : change < 0 ? 'text-success-400' : 'text-surface-400'
                    }`}>
                      <div className="text-sm font-medium">
                        {change > 0 ? '+' : ''}{change.toFixed(1)}
                      </div>
                      <div className="text-xs">{preferredUnit === 'kg' ? 'kg' : 'lbs'}</div>
                    </div>
                  )}

                  {/* Edit icon */}
                  <div className="flex-shrink-0 text-surface-600">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                </button>
              </SwipeableRow>
            );
          })
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
}

