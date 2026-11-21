'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { updateTrainingPhase, type TrainingPhase, type UpdatePhaseResult } from '@/lib/actions/phase';
import { PHASES_QUERY_KEY_PREFIX } from '@/hooks/useTrainingPhases';

const PHASE_META: Record<
  TrainingPhase,
  { label: string; chipClasses: string; selectedClasses: string; description: string }
> = {
  cut: {
    label: 'Cutting',
    chipClasses: 'bg-status-warn-tint text-status-warn',
    selectedClasses: 'border-status-warn/60 bg-status-warn/10',
    description: 'Lose fat while holding on to muscle. Calorie deficit.',
  },
  maintenance: {
    label: 'Maintaining',
    chipClasses: 'bg-fill text-ink-2',
    selectedClasses: 'border-ink-3/60 bg-fill',
    description: 'Hold steady or recomp. Eat around maintenance.',
  },
  bulk: {
    label: 'Bulking',
    chipClasses: 'bg-status-ok-tint text-status-ok',
    selectedClasses: 'border-status-ok/60 bg-status-ok/10',
    description: 'Build muscle. Calorie surplus.',
  },
};

const PHASE_ORDER: TrainingPhase[] = ['cut', 'maintenance', 'bulk'];

interface PhaseSelectorProps {
  /** Current phase (normalized from users.goal). */
  phase: TrainingPhase;
  /** Called after a successful save so the caller can update state/cache. */
  onPhaseChanged: (phase: TrainingPhase, newTargets?: UpdatePhaseResult['newTargets']) => void;
  /**
   * Offer to rebuild an active mesocycle after a phase change. False in the
   * freestyle training style (lib/training/trainingStyle), where the plan is
   * hidden and a rebuild prompt would push it back into view.
   */
  offerPlanRebuild?: boolean;
}

/**
 * Tappable phase chip ("Bulking" / "Cutting" / "Maintaining") for the home
 * glance header. Opens a small modal to switch phase; saving goes through the
 * unified updateTrainingPhase action, which syncs the profile goal, the macro
 * calculator goal, and (optionally) recalculates nutrition targets.
 */
export function PhaseSelector({ phase, onPhaseChanged, offerPlanRebuild = true }: PhaseSelectorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<TrainingPhase>(phase);
  const [syncTargets, setSyncTargets] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a successful save when an active mesocycle exists: its program
  // was built for the old phase, so we offer a rebuild before closing.
  const [staleMesocycle, setStaleMesocycle] = useState<{ id: string; name: string | null } | null>(null);

  const openModal = () => {
    setSelected(phase);
    setSyncTargets(true);
    setError(null);
    setStaleMesocycle(null);
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
      // The server action rewrote the training_phases spans (close + open) —
      // refetch so the Body tab verdict/banner reflect the new active span.
      void queryClient.invalidateQueries({ queryKey: [PHASES_QUERY_KEY_PREFIX] });
      onPhaseChanged(selected, result.newTargets);
      if (result.activeMesocycle && offerPlanRebuild) {
        setStaleMesocycle(result.activeMesocycle);
      } else {
        setIsOpen(false);
      }
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
        className={`rounded-full px-2 py-0.5 text-caption font-semibold whitespace-nowrap transition-opacity hover:opacity-80 ${meta.chipClasses}`}
      >
        {meta.label}
      </button>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={staleMesocycle ? 'Rebuild your training plan?' : 'What phase are you in?'}
        size="sm"
      >
        {staleMesocycle ? (
          <>
            <p className="text-subhead text-ink-2">
              Phase updated to <span className="font-medium text-ink">{PHASE_META[selected].label.toLowerCase()}</span>.
              Your current training block{staleMesocycle.name ? (
                <> &ldquo;<span className="font-medium text-ink">{staleMesocycle.name}</span>&rdquo;</>
              ) : null} was planned for your old phase &mdash; its split, volume, and rep ranges won&apos;t match the new one.
            </p>
            <p className="mt-2 text-caption text-ink-2">
              Rebuilding starts a fresh block for your new phase. Your workout history and progress are kept.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)}>
                Keep current plan
              </Button>
              <Button size="sm" onClick={() => router.push('/dashboard/mesocycle/new')}>
                Rebuild plan
              </Button>
            </div>
          </>
        ) : (
        <>
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
                    : 'border-sep bg-card hover:border-sep'
                }`}
              >
                <span className="block text-body font-medium text-ink">{option.label}</span>
                <span className="block text-caption text-ink-2 mt-0.5">{option.description}</span>
              </button>
            );
          })}
        </div>

        <label className="mt-4 flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={syncTargets}
            onChange={(e) => setSyncTargets(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-sep bg-fill accent-action"
          />
          <span className="text-caption text-ink-2">
            Update my calorie &amp; macro targets to match the new phase
          </span>
        </label>

        {error && <p className="mt-3 text-caption text-status-bad">{error}</p>}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setIsOpen(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} isLoading={isSaving} disabled={isSaving}>
            Save phase
          </Button>
        </div>
        </>
        )}
      </Modal>
    </>
  );
}
