'use client';

import { IconChevronDown, IconInfoCircle } from '@tabler/icons-react';
import { EST_MAX_METHOD } from './liftTrendFormat';

/** Plain explanation of "est. max", shown once where the term first appears. */
export const EST_MAX_EXPLAINER = 'Est. max = the heaviest single rep your recent sets suggest you could lift.';

/**
 * "How est. max is worked out": one tap row that opens the formula, the
 * reps-left rule and the arithmetic on the user's own set (UX panel: an
 * advanced lifter read "est. max 260 for 180 × 10" as inflated because the
 * method wasn't disclosed). Shared by the Strength card and a lift's screen.
 */
export function EstMaxMethod({
  example,
  rate,
  className = '',
}: {
  example: string | null;
  rate?: string | null;
  className?: string;
}) {
  return (
    <details className={`group ${className}`} data-testid="est-max-method">
      <summary className="-ml-1 inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 px-1 text-subhead font-semibold text-action [&::-webkit-details-marker]:hidden">
        <IconInfoCircle size={16} aria-hidden="true" />
        How est. max is worked out
        <IconChevronDown size={16} aria-hidden="true" className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-1 pb-1 text-caption text-ink-2">
        <p data-testid="est-max-explainer">
          {EST_MAX_EXPLAINER} {EST_MAX_METHOD}
        </p>
        {example && (
          <p className="text-ink tabular-nums" data-testid="est-max-example">
            {example}
          </p>
        )}
        {rate && <p data-testid="rate-explainer">{rate}</p>}
      </div>
    </details>
  );
}
