'use client';

import { useEffect, useMemo, useState } from 'react';
import { IconShare } from '@tabler/icons-react';
import { Button, Modal, ModalFooter, Toggle } from '@/components/ui';
import { useTextShare } from '@/hooks/useTextShare';
import {
  formatNutritionShareText,
  type NutritionShareMode,
  type NutritionShareTargets,
  type NutritionShareTotals,
} from '@/services/nutritionShareText';
import type { EatingWindow, PacingPhase } from '@/services/intakePacing';

const NO_NUMBERS_STORAGE_KEY = 'hypertrack:nutritionShareNoNumbers';
const MODE_STORAGE_KEY = 'hypertrack:nutritionShareMode';

const MODES: { value: NutritionShareMode; label: string; hint: string }[] = [
  { value: 'full', label: 'Full', hint: 'Every macro with targets' },
  { value: 'compact', label: 'Compact', hint: 'One line per macro' },
  { value: 'minimal', label: 'Minimal', hint: 'Calories + protein' },
];

function isShareMode(value: string | null): value is NutritionShareMode {
  return value === 'full' || value === 'compact' || value === 'minimal';
}

interface ShareNutritionTextProps {
  totals: NutritionShareTotals;
  targets: NutritionShareTargets;
  phase: PacingPhase | null;
  /** Current mesocycle week, or null when there's no active mesocycle. */
  phaseWeek: number | null;
  /** Distinct meal buckets logged today. */
  mealsLogged: number;
  eatingWindow: EatingWindow;
}

/**
 * Share the current day's nutrition as a Wordle-style plain-text macro grid —
 * the Eat-tab sibling of ShareWorkoutText. Native builds get the OS share
 * sheet, web gets navigator.share where available, otherwise clipboard +
 * "Copied!". A three-way mode selector (Full / Compact / Minimal) and the
 * "no numbers" privacy toggle both persist across sessions.
 */
export function ShareNutritionText({
  totals,
  targets,
  phase,
  phaseWeek,
  mealsLogged,
  eatingWindow,
}: ShareNutritionTextProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [noNumbers, setNoNumbers] = useState(false);
  const [mode, setMode] = useState<NutritionShareMode>('full');
  // Snapshot the clock when the sheet opens so the preview matches what gets
  // shared (and doesn't re-tick while open).
  const [openedAt, setOpenedAt] = useState<Date | null>(null);
  const { share, copied } = useTextShare();

  // Restore persisted preferences once, on mount.
  useEffect(() => {
    try {
      setNoNumbers(localStorage.getItem(NO_NUMBERS_STORAGE_KEY) === '1');
      const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
      if (isShareMode(savedMode)) setMode(savedMode);
    } catch {
      // localStorage unavailable (private mode / SSR) — keep the defaults.
    }
  }, []);

  const handleToggleNoNumbers = (next: boolean) => {
    setNoNumbers(next);
    try {
      localStorage.setItem(NO_NUMBERS_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Persistence is best-effort.
    }
  };

  const handleSelectMode = (next: NutritionShareMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort.
    }
  };

  const open = () => {
    setOpenedAt(new Date());
    setIsOpen(true);
  };

  const shareText = useMemo(
    () =>
      formatNutritionShareText(
        { totals, mealsLogged },
        targets,
        phase,
        {
          now: openedAt ?? new Date(),
          window: eatingWindow,
          phaseWeek,
          noNumbers,
          mode,
        }
      ),
    [totals, mealsLogged, targets, phase, openedAt, eatingWindow, phaseWeek, noNumbers, mode]
  );

  return (
    <>
      <button
        onClick={open}
        className="p-2 text-surface-400 hover:text-surface-100 rounded-lg hover:bg-surface-800 transition-colors"
        aria-label="Share nutrition as text"
      >
        <IconShare size={18} aria-hidden="true" />
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Share Nutrition" size="sm">
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Share format" className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const active = mode === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={m.hint}
                  onClick={() => handleSelectMode(m.value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                      : 'border-surface-700 bg-surface-900 text-surface-300 hover:bg-surface-800'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <pre
            data-testid="nutrition-share-preview"
            className="whitespace-pre-wrap break-words rounded-lg bg-surface-900 border border-surface-700 p-4 font-mono text-sm text-surface-100 select-all"
          >
            {shareText}
          </pre>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-surface-200">No numbers</p>
              <p className="text-xs text-surface-500">Share compliance without disclosing intake</p>
            </div>
            <Toggle checked={noNumbers} onChange={handleToggleNoNumbers} />
          </div>
        </div>

        <ModalFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Close
          </Button>
          <Button onClick={() => share(shareText)}>{copied ? '✓ Copied!' : 'Share 📋'}</Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
