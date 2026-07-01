'use client';

import { IconScale, IconDroplet, IconSalad, IconRun, type Icon } from '@tabler/icons-react';

interface QuickLogRowProps {
  /** Opens the weight-log modal. */
  onLogWeight: () => void;
  /** Opens the water (hydration) modal; omit to hide (needs a signed-in user). */
  onLogWater?: () => void;
  /** Opens the food quick-log modal. */
  onLogFood: () => void;
  /** Opens the cardio modal; omit to hide (only with an active cardio prescription). */
  onLogCardio?: () => void;
}

/**
 * Quick log row — one-tap logging for Weight / Water / Food / Cardio.
 * Each button opens a modal wired up by the dashboard (the old scroll-to
 * detail cards were removed from the home page).
 */
export function QuickLogRow({ onLogWeight, onLogWater, onLogFood, onLogCardio }: QuickLogRowProps) {
  const actions: { label: string; icon: Icon; onClick: (() => void) | undefined }[] = [
    { label: 'Weight', icon: IconScale, onClick: onLogWeight },
    { label: 'Water', icon: IconDroplet, onClick: onLogWater },
    { label: 'Food', icon: IconSalad, onClick: onLogFood },
    { label: 'Cardio', icon: IconRun, onClick: onLogCardio },
  ];

  return (
    <div>
      <div className="text-xs text-surface-500 mb-2">Quick log</div>
      <div className="grid grid-cols-4 gap-2">
        {actions.filter((a): a is { label: string; icon: Icon; onClick: () => void } => !!a.onClick).map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="bg-surface-900 border border-surface-800 rounded-lg py-2.5 flex flex-col items-center gap-1 text-xs text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
          >
            <a.icon size={18} aria-hidden="true" />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
