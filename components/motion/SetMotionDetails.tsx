'use client';

/**
 * "Details" row under a COMPLETED set's history line: the rep-level capture
 * data (CaptureAnalysisView) behind one tap. The set's recommendation line
 * lives at the top of the exercise card; this is only the evidence.
 *
 * Hidden until the set is logged AND a RIR value has been entered — logged
 * RIR is the label for the velocity → RIR fit and these metrics are the
 * features; showing them first contaminates the label. Expanding is
 * recorded (session-scoped) so later captures carry the contamination flag.
 *
 * Gated (captureGating): reps are checked against the LOGGED count, and a
 * low-confidence capture shows no velocity figures at all.
 */

import { useMemo, useState } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { CaptureAnalysis, MvtProfile } from '@/services/shared/motion';
import {
  buildVelocityRirLine,
  captureRepsToVelocityReps,
  estimateRirFromVelocity,
  gateCapture,
  VELOCITY_RIR_CONTEXT_LINE,
} from '@/services/shared/motion';
import { markObservationsViewed } from '@/lib/motion/observationsViewed';
import { CaptureAnalysisView } from './CaptureAnalysisView';

interface SetMotionDetailsProps {
  analysis: CaptureAnalysis;
  /** The logged rep count — the source of truth the capture is checked against. */
  loggedReps: number;
  /** The gate: a RIR value has been entered for this logged set. */
  hasRir: boolean;
  workoutSessionId: string | null;
  /** Learned failure-velocity profile for this exercise's calibration. */
  mvtProfile?: MvtProfile | null;
  loggedRir?: number | null;
}

export function SetMotionDetails({
  analysis,
  loggedReps,
  hasRir,
  workoutSessionId,
  mvtProfile = null,
  loggedRir = null,
}: SetMotionDetailsProps) {
  const [expanded, setExpanded] = useState(false);
  const gating = useMemo(() => gateCapture(analysis, loggedReps), [analysis, loggedReps]);
  const velocityRirLine = useMemo(() => {
    if (!mvtProfile || gating.confidence === 'low') return null;
    const estimate = estimateRirFromVelocity(captureRepsToVelocityReps(gating.reps), mvtProfile);
    return estimate ? buildVelocityRirLine(estimate, loggedRir) : null;
  }, [gating, mvtProfile, loggedRir]);

  if (!hasRir || analysis.reps.length === 0) return null;

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && workoutSessionId) markObservationsViewed(workoutSessionId);
      return next;
    });
  };

  return (
    <div className="pl-8 pr-1" data-testid="set-motion-details">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex items-center gap-1 py-0.5 text-[11px] text-surface-500 hover:text-surface-300 transition-colors"
        data-testid="set-motion-details-toggle"
      >
        {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
        Details
      </button>
      {expanded && (
        <div className="pb-2 pt-1 space-y-2" data-testid="set-motion-details-body">
          {velocityRirLine && (
            <div className="space-y-0.5">
              <p className="text-[12px] text-surface-300" data-testid="velocity-rir-line">
                {velocityRirLine}
              </p>
              <p className="text-[11px] text-surface-500">{VELOCITY_RIR_CONTEXT_LINE}</p>
            </div>
          )}
          <CaptureAnalysisView analysis={analysis} gating={gating} />
        </div>
      )}
    </div>
  );
}
