'use client';

/**
 * Add/edit form for one training-phase span. Pure form UI: local field state,
 * light syntax checks, then hands a TrainingPhaseInput to the page — span
 * validation (overlap / active-phase invariants) stays with the caller, which
 * owns the sibling phases and the boundary-shift flow.
 */

import { useEffect, useState } from 'react';
import { Button, Input, Modal, ModalFooter, Select } from '@/components/ui';
import type { TrainingPhaseInput } from '@/lib/body/trainingPhases';
import { PHASE_STYLE } from '@/components/body/phaseStyle';
import type { PhaseType } from '@/types/schema';

export interface PhaseFormSeed {
  id?: string;
  phaseType: PhaseType;
  startDay: string;
  /** Empty string = open-ended (active phase). */
  endDay: string;
  targetRate: string;
  note: string;
}

const PHASE_TYPE_OPTIONS = (['bulk', 'cut', 'recomp', 'maintenance'] as PhaseType[]).map(
  (value) => ({ value, label: PHASE_STYLE[value].label })
);

/** Spec defaults for the signed weekly target when switching type. */
export const DEFAULT_TARGET: Record<PhaseType, string> = {
  bulk: '0.5',
  cut: '-1.0',
  recomp: '',
  maintenance: '',
};

interface PhaseFormModalProps {
  /** Field seed; null keeps the modal closed. */
  seed: PhaseFormSeed | null;
  /** Validation error from the caller (overlap etc.), shown inline. */
  error: string | null;
  saving: boolean;
  onClose: () => void;
  /** Syntactically valid input; caller validates spans and persists. */
  onSave: (input: TrainingPhaseInput, id?: string) => void;
}

export function PhaseFormModal({ seed, error, saving, onClose, onSave }: PhaseFormModalProps) {
  const [form, setForm] = useState<PhaseFormSeed | null>(seed);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setForm(seed);
    setLocalError(null);
  }, [seed]);

  const handleSave = () => {
    if (!form) return;
    if (!form.startDay) {
      setLocalError('Start date is required.');
      return;
    }
    if (form.targetRate.trim() !== '' && Number.isNaN(Number(form.targetRate))) {
      setLocalError('Target rate must be a number (lb/week, signed).');
      return;
    }
    setLocalError(null);
    onSave(
      {
        phaseType: form.phaseType,
        startDay: form.startDay,
        endDay: form.endDay ? form.endDay : null,
        targetRateLbsPerWeek: form.targetRate.trim() === '' ? null : Number(form.targetRate),
        note: form.note.trim() ? form.note.trim() : null,
      },
      form.id
    );
  };

  const shownError = localError ?? error;

  return (
    <Modal isOpen={seed !== null} onClose={onClose} title={seed?.id ? 'Edit phase' : 'Add phase'}>
      {form && (
        <div className="space-y-4">
          <Select
            label="Phase type"
            options={PHASE_TYPE_OPTIONS}
            value={form.phaseType}
            onChange={(e) => {
              const phaseType = e.target.value as PhaseType;
              setForm((prev) =>
                prev
                  ? {
                      ...prev,
                      phaseType,
                      // Only swap in the new default if the user hasn't typed
                      // a custom rate (field still matches the old default).
                      targetRate:
                        prev.targetRate === DEFAULT_TARGET[prev.phaseType]
                          ? DEFAULT_TARGET[phaseType]
                          : prev.targetRate,
                    }
                  : prev
              );
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start"
              type="date"
              value={form.startDay}
              max={form.endDay || undefined}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, startDay: e.target.value } : prev))}
            />
            <Input
              label="End (empty = active)"
              type="date"
              value={form.endDay}
              min={form.startDay || undefined}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, endDay: e.target.value } : prev))}
            />
          </div>
          {(form.phaseType === 'bulk' || form.phaseType === 'cut') && (
            <Input
              label="Target rate (lb/week, signed)"
              type="number"
              step="0.25"
              value={form.targetRate}
              placeholder={DEFAULT_TARGET[form.phaseType]}
              onChange={(e) => setForm((prev) => (prev ? { ...prev, targetRate: e.target.value } : prev))}
              hint={form.phaseType === 'bulk' ? 'e.g. +0.5 for a lean bulk' : 'e.g. -1.0 for a moderate cut'}
            />
          )}
          <Input
            label="Note (optional)"
            value={form.note}
            onChange={(e) => setForm((prev) => (prev ? { ...prev, note: e.target.value } : prev))}
          />
          {shownError && <p className="text-sm text-danger-400">{shownError}</p>}
          <ModalFooter>
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} data-testid="save-phase-button">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </ModalFooter>
        </div>
      )}
    </Modal>
  );
}
