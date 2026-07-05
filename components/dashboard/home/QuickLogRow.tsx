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
  const actions: { label: string; icon: Icon; iconClass: string; onClick: (() => void) | undefined }[] = [
    { label: 'Water', icon: IconDroplet, iconClass: 'text-primary-400', onClick: onLogWater },
    { label: 'Food', icon: IconSalad, iconClass: 'text-success-400', onClick: onLogFood },
    { label: 'Weight', icon: IconScale, iconClass: 'text-accent-400', onClick: onLogWeight },
    { label: 'Cardio', icon: IconRun, iconClass: 'text-danger-400', onClick: onLogCardio },
  ];
  const visible = actions.filter(
    (a): a is (typeof actions)[number] & { onClick: () => void } => !!a.onClick
  );

  return (
    <div>
      <div className="text-[11px] font-semibold tracking-widest uppercase text-surface-500 mb-2">
        Quick log
      </div>
      <div className="grid grid-cols-2 gap-2">
        {visible.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="bg-surface-900 border border-surface-800 rounded-xl py-3.5 flex items-center justify-center gap-2 text-sm font-medium text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <a.icon size={18} aria-hidden="true" className={a.iconClass} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
