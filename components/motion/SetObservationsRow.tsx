'use client';

/**
 * Observations block for a COMPLETED set's history row in the workout
 * logger. Hidden until the set is logged AND a RIR value has been entered
 * — logged RIR is the label for a future velocity-loss → RIR fit and these
 * metrics are the features; showing metrics first contaminates the label.
 * Reveals collapsed; expanding is recorded (session-scoped) so captures
 * saved later in the workout can carry the contamination flag.
 *
 * Descriptive only — same framing rules and banned-language test as the
 * capture review. Never rendered on the active set card, never any live
 * velocity.
 */

import { useMemo, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { CaptureAnalysis } from '@/services/shared/motion';
import {
  buildObservations,
  NOTHING_NOTABLE_LINE,
  OBSERVATIONS_CONTEXT_LINE,
  THIN_REFERENCE_LINE,
} from '@/services/shared/motion';
import { markObservationsViewed } from '@/lib/motion/observationsViewed';

interface SetObservationsRowProps {
  analysis: CaptureAnalysis;
  /** The gate: a RIR value has been entered for this logged set. */
  hasRir: boolean;
  workoutSessionId: string | null;
}

export function SetObservationsRow({ analysis, hasRir, workoutSessionId }: SetObservationsRowProps) {
  const [expanded, setExpanded] = useState(false);
  const observations = useMemo(() => buildObservations(analysis.reps), [analysis.reps]);

  if (!hasRir || analysis.reps.length === 0) return null;

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && workoutSessionId) markObservationsViewed(workoutSessionId);
      return next;
    });
  };

  return (
    <div className="pl-8 pr-1" data-testid="set-observations-row">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 py-0.5 text-[11px] text-surface-500 hover:text-surface-300 transition-colors"
        data-testid="set-observations-toggle"
      >
        {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        Observations
      </button>
      {expanded && (
        <div className="pb-1.5 space-y-1" data-testid="set-observations-body">
          {observations.referenceTooThin ? (
            <p className="text-[12px] text-surface-300">{THIN_REFERENCE_LINE}</p>
          ) : observations.nothingNotable ? (
            <p className="text-[12px] text-surface-300">{NOTHING_NOTABLE_LINE}</p>
          ) : (
            observations.lines.map((line) => (
              <p key={line} className="text-[12px] text-surface-300">
                {line}
              </p>
            ))
          )}
          <p className="text-[11px] text-surface-500">{OBSERVATIONS_CONTEXT_LINE}</p>
        </div>
      )}
    </div>
  );
}
