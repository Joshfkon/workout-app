'use client';

import { useId, useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { targetBasisLines, type TargetBasis } from '@/lib/nutrition/targetBasis';

interface TargetBasisDisclosureProps {
  basis: TargetBasis;
  /** Opens the macro calculator (where targets are changed). */
  onChangeTargets: () => void;
}

/**
 * Small "How this is set" disclosure under Eat's target card: the inputs the
 * calorie target came from (lib/nutrition/targetBasis — only values that
 * reproduce the stored target) and a "Change targets" link to the calculator.
 */
export function TargetBasisDisclosure({ basis, onChangeTargets }: TargetBasisDisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const lines = targetBasisLines(basis);
  const heading =
    basis.source === 'calculator'
      ? 'Based on:'
      : basis.source === 'unknown'
        ? 'Your saved calculator settings:'
        : null;

  return (
    <div className="mt-2 px-1 text-subhead" data-testid="target-basis">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex items-center gap-1 text-ink-2 hover:text-action"
        data-testid="target-basis-toggle"
      >
        How this is set
        <IconChevronDown
          size={14}
          aria-hidden="true"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div id={panelId} className="mt-1.5 rounded-card bg-card p-3 shadow-card" data-testid="target-basis-panel">
          {heading && lines.length > 0 && <p className="text-ink-2">{heading}</p>}
          {lines.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 text-ink tabular-nums">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onChangeTargets}
            className="mt-2 font-semibold text-action"
            data-testid="target-basis-change"
          >
            Change targets
          </button>
        </div>
      )}
    </div>
  );
}
