'use client';

import { useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { ExerciseHideReason, ExerciseVisibilityStatus } from '@/types/user-exercise-preferences';

interface ExerciseStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  exerciseName: string;
  action: 'mute' | 'archive';
  onConfirm: (reason?: ExerciseHideReason, reasonNote?: string) => Promise<void>;
}

const REASON_OPTIONS: { value: ExerciseHideReason; label: string; description: string }[] = [
  {
    value: 'no_equipment',
    label: "My gym doesn't have this equipment",
    description: 'Equipment unavailable',
  },
  {
    value: 'causes_pain',
    label: 'Causes pain/discomfort',
    description: 'Physical limitation',
  },
  {
    value: 'dislike',
    label: "Just don't like this exercise",
    description: 'Personal preference',
  },
  {
    value: 'other',
    label: 'Other reason',
    description: 'Custom reason',
  },
];

export function ExerciseStatusModal({
  isOpen,
  onClose,
  exerciseName,
  action,
  onConfirm,
}: ExerciseStatusModalProps) {
  const [selectedReason, setSelectedReason] = useState<ExerciseHideReason | null>(null);
  const [customNote, setCustomNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isArchive = action === 'archive';
  const title = isArchive ? `Archive ${exerciseName}?` : `Don't suggest ${exerciseName}?`;
  const description = isArchive
    ? 'This will hide it from your exercise list. You can still find it by searching.'
    : "This exercise will remain visible but won't be auto-suggested in program generation or substitutions.";

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm(selectedReason || undefined, customNote || undefined);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSelectedReason(null);
    setCustomNote('');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} description={description} size="sm">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-surface-400 mb-3">Reason (optional):</p>
          <div className="space-y-2">
            {REASON_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedReason === option.value
                    ? 'border-primary-500 bg-primary-500/10'
                    : 'border-surface-700 hover:border-surface-600 bg-surface-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="reason"
                  value={option.value}
                  checked={selectedReason === option.value}
                  onChange={() => setSelectedReason(option.value)}
                  className="mt-0.5 w-4 h-4 text-primary-600 bg-surface-800 border-surface-600 focus:ring-primary-500 focus:ring-offset-surface-900"
                />
                <div>
                  <p className="text-sm text-surface-200">{option.label}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {selectedReason === 'other' && (
          <div>
            <label className="block text-sm text-surface-400 mb-2">
              Add a note (optional):
            </label>
            <textarea
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Why are you hiding this exercise?"
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              rows={2}
            />
          </div>
        )}

        <ModalFooter>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant={isArchive ? 'secondary' : 'primary'}
            onClick={handleSubmit}
            isLoading={isSubmitting}
          >
            {isArchive ? 'Archive' : "Don't Suggest"}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

/**
 * Confirmation modal for resetting all preferences
 */
interface ResetPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  archivedCount: number;
  doNotSuggestCount: number;
}

export function ResetPreferencesModal({
  isOpen,
  onClose,
  onConfirm,
  archivedCount,
  doNotSuggestCount,
}: ResetPreferencesModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reset All Exercise Preferences"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-surface-300">This will:</p>
        <ul className="list-disc list-inside text-sm text-surface-400 space-y-1">
          {archivedCount > 0 && (
            <li>Unarchive {archivedCount} exercise{archivedCount > 1 ? 's' : ''}</li>
          )}
          {doNotSuggestCount > 0 && (
            <li>Re-enable suggestions for {doNotSuggestCount} exercise{doNotSuggestCount > 1 ? 's' : ''}</li>
          )}
        </ul>
        <p className="text-sm text-surface-500">Your workout history is not affected.</p>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleSubmit} isLoading={isSubmitting}>
            Reset
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
