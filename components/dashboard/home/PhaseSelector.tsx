'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { updateTrainingPhase, type TrainingPhase, type UpdatePhaseResult } from '@/lib/actions/phase';

const PHASE_META: Record<
  TrainingPhase,
  { label: string; chipClasses: string; selectedClasses: string; description: string }
> = {
  cut: {
    label: 'Cutting',
    chipClasses: 'bg-warning-500/10 text-warning-400',
    selectedClasses: 'border-warning-500/60 bg-warning-500/10',
    description: 'Lose fat while holding on to muscle. Calorie deficit.',
  },
  maintenance: {
    label: 'Maintaining',
    chipClasses: 'bg-surface-800 text-surface-300',
    selectedClasses: 'border-surface-400/60 bg-surface-800',
    description: 'Hold steady or recomp. Eat around maintenance.',
  },
  bulk: {
    label: 'Bulking',
    chipClasses: 'bg-success-500/10 text-success-400',
    selectedClasses: 'border-success-500/60 bg-success-500/10',
    description: 'Build muscle. Calorie surplus.',
  },
};

const PHASE_ORDER: TrainingPhase[] = ['cut', 'maintenance', 'bulk'];

interface PhaseSelectorProps {
  /** Current phase (normalized from users.goal). */
  phase: TrainingPhase;
  /** Called after a successful save so the caller can update state/cache. */
  onPhaseChanged: (phase: TrainingPhase, newTargets?: UpdatePhaseResult['newTargets']) => void;
}

/**
 * Tappable phase chip ("Bulking" / "Cutting" / "Maintaining") for the home
 * glance header. Opens a small modal to switch phase; saving goes through the
 * unified updateTrainingPhase action, which syncs the profile goal, the macro
 * calculator goal, and (optionally) recalculates nutrition targets.
 */
export function PhaseSelector({ phase, onPhaseChanged }: PhaseSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<TrainingPhase>(phase);
  const [syncTargets, setSyncTargets] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openModal = () => {
    setSelected(phase);
    setSyncTargets(true);
    setError(null);
    setIsOpen(true);
  };

  const handleSave = async () => {
    if (selected === phase) {
      setIsOpen(false);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const result = await updateTrainingPhase(selected, { recalculateTargets: syncTargets });
      if (!result.success) {
        setError(result.message);
        return;
      }
      onPhaseChanged(selected, result.newTargets);
      setIsOpen(false);
    } catch {
      setError('Failed to update phase. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const meta = PHASE_META[phase];

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={`Current phase: ${meta.label}. Tap to change.`}
        className={`rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-opacity hover:opacity-80 ${meta.chipClasses}`}
      >
        {meta.label}
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="What phase are you in?" size="sm">
        <div className="space-y-2">
          {PHASE_ORDER.map((p) => {
            const option = PHASE_META[p];
            const isSelected = selected === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setSelected(p)}
                aria-pressed={isSelected}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${
                  isSelected
                    ? option.selectedClasses
                    : 'border-surface-800 bg-surface-900 hover:border-surface-600'
                }`}
              >
                <span className="block text-[14px] font-medium text-surface-100">{option.label}</span>
                <span className="block text-xs text-surface-400 mt-0.5">{option.description}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={syncTargets}
            onChange={(e) => setSyncTargets(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-surface-600 bg-surface-800 accent-primary-600"
          />
          <span className="text-xs text-surface-400">
            Update my calorie &amp; macro targets to match the new phase
          </span>
        </label>

        {error && <p className="mt-3 text-xs text-danger-400">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} isLoading={isSaving} disabled={isSaving}>
            Save phase
          </Button>
        </div>
      </Modal>
    </>
  );
}
