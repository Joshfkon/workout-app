'use client';

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { SwipeableRow } from '@/components/ui/SwipeableRow';
import type { WeightLogEntry } from '@/types/nutrition';

interface WeightHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: WeightLogEntry[];
  onEdit: (entry: WeightLogEntry) => void;
  onDelete: (id: string) => Promise<void>;
}

export function WeightHistoryModal({
  isOpen,
  onClose,
  entries,
  onEdit,
  onDelete,
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

  // Calculate change from previous entry
  const getChange = (index: number) => {
    if (index >= entries.length - 1) return null;
    const current = entries[index].weight;
    const previous = entries[index + 1].weight;
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
                      {entry.weight.toFixed(1)} lbs
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
                      <div className="text-xs">lbs</div>
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

