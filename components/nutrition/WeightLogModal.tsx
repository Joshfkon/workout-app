'use client';

import { useState, useEffect } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import type { WeightLogEntry } from '@/types/nutrition';

interface WeightLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (weight: number, date: string, notes?: string) => Promise<void>;
  existingEntry?: WeightLogEntry;
  preferredUnit?: 'lb' | 'kg'; // User's preferred unit for display
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

  // Helper function to validate and convert weight (same logic as history modal and graph)
  const validateAndConvertWeight = (weight: number, unit: string | null | undefined): number => {
    const entryUnit = unit || 'lb';
    let weightInLbs = weight;
    
    // Apply same unit validation as TDEE calculation and weight graph
    if (entryUnit === 'lb') {
      if (weight > 400) {
        // Weight > 400 lbs is probably in kg, convert
        weightInLbs = weight * 2.20462;
      } else if (weight <= 85 && weight >= 30) {
        // Weight 30-85 lbs when labeled as 'lb' is suspicious - likely in kg
        weightInLbs = weight * 2.20462;
      } else {
        weightInLbs = weight;
      }
    } else if (entryUnit === 'kg') {
      if (weight >= 30 && weight <= 150) {
        // Common weights 30-150 kg are actually human weights in lbs, mislabeled as kg
        weightInLbs = weight; // Already in lbs, just mislabeled
      } else {
        weightInLbs = weight * 2.20462; // Normal kg to lbs conversion
      }
    }
    
    // Convert to display unit (preferredUnit is the user's preference: 'lb' or 'kg')
    // weightInLbs is now in lbs, convert to display unit
    if (preferredUnit === 'kg') {
      return weightInLbs / 2.20462;
    }
    return weightInLbs; // Already in lbs, return as-is
  };

  // Sync state with existingEntry when modal opens or entry changes
  useEffect(() => {
    if (isOpen) {
      const today = new Date().toISOString().split('T')[0];
      // Show validated weight in edit modal (matches what user sees in history list)
      if (existingEntry) {
        const validatedWeight = validateAndConvertWeight(existingEntry.weight, (existingEntry as any).unit);
        setWeight(validatedWeight.toFixed(1));
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
    if (!weightNum || weightNum <= 0 || weightNum > 1000) {
      setError('Please enter a valid weight');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave(weightNum, date, notes || undefined);
      onClose();
      // Form will be reset by useEffect when modal opens again
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
            <div className="p-3 text-sm text-danger-400 bg-danger-500/10 border border-danger-500/20 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="weight" className="block text-sm font-medium text-surface-300 mb-1">
              Weight (lbs)
            </label>
            <Input
              id="weight"
              type="number"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="150.0"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="date" className="block text-sm font-medium text-surface-300 mb-1">
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
            <label htmlFor="notes" className="block text-sm font-medium text-surface-300 mb-1">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-surface-800 border border-surface-700 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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
