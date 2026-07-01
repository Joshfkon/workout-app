'use client';

import { IconScale, IconDroplet, IconWalk, IconRun } from '@tabler/icons-react';

interface QuickLogRowProps {
  /** Water tile needs a signed-in user (hydration card only renders with one). */
  showWater: boolean;
  /**
   * Cardio card only renders with an active cardio prescription — don't show a
   * quick-log button that would scroll to a card that isn't in the DOM.
   */
  showCardio: boolean;
}

/**
 * Quick log row — taps scroll to and open the matching collapsed card below
 * the glance summary (cards render with ids like `dash-card-weight`).
 */
export function QuickLogRow({ showWater, showCardio }: QuickLogRowProps) {
  return (
    <div>
      <div className="text-xs text-surface-500 mb-2">Quick log</div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Weight', icon: IconScale, target: 'dash-card-weight', show: true },
          { label: 'Water', icon: IconDroplet, target: 'dash-card-hydration', show: showWater },
          { label: 'Steps', icon: IconWalk, target: 'dash-card-steps', show: true },
          { label: 'Cardio', icon: IconRun, target: 'dash-card-cardio', show: showCardio },
        ].filter((q) => q.show).map((q) => (
          <button
            key={q.label}
            onClick={() => {
              const el = document.getElementById(q.target) as HTMLDetailsElement | null;
              if (el) { el.open = true; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            }}
            className="bg-surface-900 border border-surface-800 rounded-lg py-2.5 flex flex-col items-center gap-1 text-xs text-surface-400 hover:bg-surface-800 hover:text-surface-200 transition-colors"
          >
            <q.icon size={18} aria-hidden="true" />
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}
