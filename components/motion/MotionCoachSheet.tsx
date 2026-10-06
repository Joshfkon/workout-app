'use client';

/**
 * Coach feedback for one logged set, in a swipe-dismissible bottom sheet
 * (opened from the set row's sensor icon or cue line):
 *
 *   verdict · up to 2 cues · next-set call (latest set only)
 *   ▸ Details — rep table, chart, diagnostics (collapsed)
 *
 * Sources: a live / reprocessed capture (full analysis), a capture restored
 * from its cleaning snapshot (no chart), or a capture that predates rep
 * cleaning and has no raw buffer — that one gets NO coach feedback, only
 * its stored per-rep numbers, so old-pipeline observations never resurface.
 */

import { useMemo, useState } from 'react';
import type { CaptureAnalysisMetrics } from '@/types/motion';
import type { CaptureAnalysis, CleanedCapture, CoachContext } from '@/services/shared/motion';
import { buildCoachFeedback, RAD_TO_DEG } from '@/services/shared/motion';
import { BottomSheet } from '@/components/workout/BottomSheet';
import { buildCoachPhrasingPayload } from '@/lib/motion/coachPhrasing';
import { markObservationsViewed } from '@/lib/motion/observationsViewed';
import { CaptureAnalysisView } from './CaptureAnalysisView';
import { CoachBlock, coachTemplateText, Collapsible } from './CaptureParts';
import { useCoachPhrasing } from './useCoachPhrasing';

export interface MotionSheetCapture {
  analysis: CaptureAnalysis | null;
  cleaned: CleanedCapture | null;
  /** Persisted per-rep metrics (shown for captures that can't be coached). */
  metrics: CaptureAnalysisMetrics | null;
}

interface MotionCoachSheetProps {
  title: string;
  exerciseName: string;
  capture: MotionSheetCapture;
  coachContext: CoachContext;
  /** "Next set: …" from the prescription engine (latest set only). */
  nextSetCall: string | null;
  /** Logged set, for the optional LLM phrasing payload. */
  loggedWeightLabel: string;
  workoutSessionId: string | null;
  /** Estimated-RIR line from the learned velocity profile (if any). */
  velocityRirLine?: string | null;
  onClose: () => void;
}

export function MotionCoachSheet({
  title,
  exerciseName,
  capture,
  coachContext,
  nextSetCall,
  loggedWeightLabel,
  workoutSessionId,
  velocityRirLine = null,
  onClose,
}: MotionCoachSheetProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const feedback = useMemo(
    () => (capture.cleaned ? buildCoachFeedback(capture.cleaned, coachContext) : null),
    [capture.cleaned, coachContext]
  );
  const payload = useMemo(
    () =>
      feedback
        ? buildCoachPhrasingPayload(feedback, {
            exercise: exerciseName,
            weight: loggedWeightLabel,
            reps: coachContext.loggedReps ?? 0,
            rir: coachContext.loggedRir,
            nextSetCall,
          })
        : null,
    [feedback, exerciseName, loggedWeightLabel, coachContext, nextSetCall]
  );
  const phrased = useCoachPhrasing(payload);

  return (
    <BottomSheet isOpen onClose={onClose} title={title}>
      <div className="space-y-4" data-testid="motion-coach-sheet">
        {feedback ? (
          <CoachBlock feedback={feedback} text={phrased ?? coachTemplateText(feedback, nextSetCall)} />
        ) : (
          <div className="space-y-2" data-testid="motion-legacy-capture">
            <p className="text-sm text-surface-300">
              This capture was recorded before the current rep analysis and its raw data
              wasn&apos;t kept, so there&apos;s no coach feedback for it.
            </p>
            {nextSetCall && <p className="text-sm font-medium text-primary-300">{nextSetCall}</p>}
          </div>
        )}

        <Collapsible
          title="Details"
          open={detailsOpen}
          onToggle={() =>
            setDetailsOpen((o) => {
              // Same label-contamination flag the old Observations expander set.
              if (!o && workoutSessionId) markObservationsViewed(workoutSessionId);
              return !o;
            })
          }
          testId="motion-sheet-details"
        >
          {velocityRirLine && feedback?.confidence.confidence === 'ok' && (
            <p className="text-xs text-surface-400" data-testid="velocity-rir-line">
              {velocityRirLine}
            </p>
          )}
          {capture.cleaned ? (
            <CaptureAnalysisView
              analysis={capture.analysis}
              cleaned={capture.cleaned}
              coachContext={coachContext}
              showCoach={false}
            />
          ) : capture.metrics ? (
            <LegacyMetrics metrics={capture.metrics} />
          ) : null}
        </Collapsible>
      </div>
    </BottomSheet>
  );
}

/** Stored per-rep numbers of a pre-cleaning capture — as recorded, unjudged. */
function LegacyMetrics({ metrics }: { metrics: CaptureAnalysisMetrics }) {
  const deg = (radps: number) => Math.round(radps * RAD_TO_DEG);
  return (
    <table className="w-full table-fixed text-xs" data-testid="motion-legacy-metrics">
      <thead>
        <tr className="text-left text-surface-500">
          <th className="py-1 font-medium">Rep</th>
          <th className="py-1 font-medium">Mean ω</th>
          <th className="py-1 font-medium">Peak ω</th>
          <th className="py-1 text-right font-medium">ROM</th>
        </tr>
      </thead>
      <tbody>
        {metrics.reps.map((r) => (
          <tr key={r.index} className="border-t border-surface-800 text-surface-300">
            <td className="py-1.5">{r.index + 1}</td>
            <td className="py-1.5 tabular-nums">{deg(r.meanConcentricW_radps)}°/s</td>
            <td className="py-1.5 tabular-nums">{deg(r.peakConcentricW_radps)}°/s</td>
            <td className="py-1.5 text-right tabular-nums">{r.romDeg.toFixed(0)}°</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
