'use client';

import { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getDisplayWeight, validateUserInput } from '@/lib/weightUtils';
import { getLocalDateString } from '@/lib/utils';
import type { WeightLogEntry } from '@/types/nutrition';

interface WeightLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (weight: number, date: string, notes?: string) => Promise<void>;
  existingEntry?: WeightLogEntry;
  preferredUnit?: 'lb' | 'kg';
}

export function WeightLogModal({
  isOpen,
  onClose,
  onSave,
  existingEntry,
  preferredUnit = 'lb',
}: WeightLogModalProps) {
  const [weight, setWeight] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Sync state with existingEntry when modal opens or entry changes
  useEffect(() => {
    if (isOpen) {
      const today = getLocalDateString();

      if (existingEntry) {
        // Use unified weight utility to get display weight (with validation)
        const displayWeight = getDisplayWeight(
          existingEntry.weight,
          existingEntry.unit as 'lb' | 'kg' | null,
          preferredUnit
        );
        setWeight(displayWeight.toFixed(1));
      } else {
        setWeight('');
      }

      setDate(existingEntry?.logged_at || today);
      setNotes(existingEntry?.notes || '');
      setError('');
    }
  }, [isOpen, existingEntry, preferredUnit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const weightNum = parseFloat(weight);
    
    // Use unified validation
    const validation = validateUserInput(weightNum, preferredUnit);
    if (!validation.isValid) {
      setError(validation.error || 'Please enter a valid weight');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(weightNum, date, notes || undefined);
      onClose();
    } catch (err) {
      setError('Failed to save weight. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existingEntry ? 'Update Weight' : 'Log Weight'}
      size="sm"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-status-bad bg-status-bad/10 border border-status-bad/20 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-ink-2 mb-1">
              Weight ({preferredUnit === 'kg' ? 'kg' : 'lbs'})
            </label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={preferredUnit === 'kg' ? '70.0' : '150.0'}
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="date" className="block text-sm font-medium text-ink-2 mb-1">
              Date
            </label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="notes" className="block text-sm font-medium text-ink-2 mb-1">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-fill border border-sep rounded-lg text-ink placeholder-ink-3 focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent"
              rows={3}
              placeholder="How are you feeling?"
            />
          </div>
        </div>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
