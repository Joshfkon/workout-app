'use client';

import { IconScale, IconDroplet, IconSalad, IconRun, IconHeartbeat, IconMoon, type Icon } from '@tabler/icons-react';
import { Chip } from '@/components/ui';

interface QuickLogRowProps {
  /** Opens the weight-log modal. */
  onLogWeight: () => void;
  /** Opens the water (hydration) modal; omit to hide (needs a signed-in user). */
  onLogWater?: () => void;
  /** Opens the food quick-log modal. */
  onLogFood: () => void;
  /** Opens the sleep log; omit to hide (needs a signed-in user). */
  onLogSleep?: () => void;
  /** Opens the cardio modal; omit to hide (only with an active cardio prescription). */
  onLogCardio?: () => void;
  /** Opens the blood-pressure modal; omit to hide (needs a signed-in user). */
  onLogBloodPressure?: () => void;
}

/**
 * Quick log — one-tap logging as a row of chips (design system): Water,
 * Food, Weight, Sleep, Cardio, Blood pressure. Each opens its sheet; the row
 * scrolls sideways when it doesn't fit.
 */
export function QuickLogRow({ onLogWeight, onLogWater, onLogFood, onLogSleep, onLogCardio, onLogBloodPressure }: QuickLogRowProps) {
  const actions: { label: string; icon: Icon; onClick: (() => void) | undefined }[] = [
    { label: 'Water', icon: IconDroplet, onClick: onLogWater },
    { label: 'Food', icon: IconSalad, onClick: onLogFood },
    { label: 'Weight', icon: IconScale, onClick: onLogWeight },
    { label: 'Sleep', icon: IconMoon, onClick: onLogSleep },
    { label: 'Cardio', icon: IconRun, onClick: onLogCardio },
    { label: 'Blood pressure', icon: IconHeartbeat, onClick: onLogBloodPressure },
  ];
  const visible = actions.filter(
    (a): a is (typeof actions)[number] & { onClick: () => void } => !!a.onClick
  );

  return (
    <section aria-label="Quick log">
      <h2 className="mx-1 mb-2 text-headline text-ink">Quick log</h2>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {visible.map((a) => (
          <Chip key={a.label} onClick={a.onClick} icon={<a.icon size={16} />}>
            {a.label}
          </Chip>
        ))}
      </div>
    </section>
  );
}
