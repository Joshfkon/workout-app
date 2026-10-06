'use client';

/**
 * Shared display for a capture (the in-workout capture review, the
 * calibration wizard, and the Details section of a set's coach sheet).
 * Reads top-down: coach feedback (verdict + up to two cues), the rep count
 * and velocity loss with a capture-quality badge, per-rep velocity bars, a
 * tap-to-expand rep table, then collapsed "Rep detection" (the w(t) chart)
 * and "Capture diagnostics" (sensor quality, the rep-cleaning log, the
 * technical PC1 note, raw CSV export).
 *
 * Everything reads the CLEANED capture (captureGating): setup / re-rack
 * artifacts are gone before any figure is computed. A low-confidence
 * capture shows why — and no velocity claims, no technique cues.
 *
 * `analysis` may be null for a capture restored from its persisted
 * cleaning snapshot (no raw samples): then there is no chart and no
 * sensor-level diagnostics, but the reps and the coach still work.
 *
 * Display-only — consumes services/shared/motion output, feeds nothing.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import type { CaptureAnalysis, CleanedCapture, CoachContext, EffortZone } from '@/services/shared/motion';
import {
  assessCaptureQuality,
  buildCoachFeedback,
  cleanCapture,
  computeVelocityLoss,
  MOTION_SET_CONFIG,
  MULTI_AXIS_REASON,
} from '@/services/shared/motion';
import { TAP_LATENCY_WARN_MS } from '@/lib/motion/deviceMotionRecorder';
import { CaptureChart } from './CaptureChart';
import {
  CoachBlock,
  coachTemplateText,
  Collapsible,
  Diagnostics,
  RepTable,
  VelocityBars,
  ZONE_LABEL,
  ZONE_TEXT,
} from './CaptureParts';

export interface CaptureAnalysisViewProps {
  analysis: CaptureAnalysis | null;
  /** Defaults to cleanCapture(analysis) (no PC1 recompute without samples). */
  cleaned?: CleanedCapture;
  /** Logged set context for the coach (rep count / RIR cross-checks, history). */
  coachContext?: Partial<CoachContext>;
  /** The coach block at the top; the set sheet renders its own above Details. */
  showCoach?: boolean;
  /** Sensor latency at the stop tap, ms; null when unknown / no tap. */
  stopLatencyMs?: number | null;
  /** Shown instead of a latency figure when stopLatencyMs is null. */
  stopLatencyFallback?: string;
  onDownloadCsv?: () => void;
  downloadLabel?: string;
}

export function CaptureAnalysisView({
  analysis,
  cleaned: cleanedProp,
  coachContext,
  showCoach = true,
  stopLatencyMs = null,
  stopLatencyFallback = 'n/a',
  onDownloadCsv,
  downloadLabel = 'Download raw capture (CSV)',
}: CaptureAnalysisViewProps) {
  const cleaned = useMemo(
    () => cleanedProp ?? (analysis ? cleanCapture(analysis) : null),
    [cleanedProp, analysis]
  );
  const feedback = useMemo(
    () =>
      cleaned
        ? buildCoachFeedback(cleaned, {
            loggedReps: null,
            loggedRir: null,
            weightKg: null,
            pausePoint: null,
            history: null,
            ...coachContext,
          })
        : null,
    [cleaned, coachContext]
  );
  const velocity = useMemo(() => (cleaned ? computeVelocityLoss(cleaned.reps) : null), [cleaned]);
  const pc1 = cleaned ? cleaned.pc1ShareClean ?? cleaned.pc1ShareRaw : 1;
  const issues = useMemo(
    () =>
      analysis
        ? assessCaptureQuality(analysis, {
            pc1Share: pc1,
            stopLatencyMs,
            latencyWarnMs: TAP_LATENCY_WARN_MS,
          })
        : null,
    [analysis, pc1, stopLatencyMs]
  );

  const [repDetectionOpen, setRepDetectionOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [scrollToDiagnostics, setScrollToDiagnostics] = useState(false);
  const diagnosticsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollToDiagnostics) return;
    diagnosticsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollToDiagnostics(false);
  }, [scrollToDiagnostics]);

  if (!cleaned || !feedback || !velocity) return null;
  const low = feedback.confidence.confidence === 'low';
  const reps = cleaned.reps;
  const showGravity =
    analysis?.gravityRomStatus === 'ok' || analysis?.gravityRomStatus === 'low-confidence';

  return (
    <div className="space-y-4 min-w-0" data-testid="motion-analysis-view">
      {showCoach && <CoachBlock feedback={feedback} text={coachTemplateText(feedback, null)} />}

      <SummaryHeader
        repCount={reps.length}
        loss={low ? null : velocity.loss}
        zone={low ? null : velocity.zone}
        issues={issues}
        onBadgeClick={() => {
          setDiagnosticsOpen(true);
          setScrollToDiagnostics(true);
        }}
      />

      {/* Plain-language version; the technical PC1 note lives in diagnostics. */}
      {pc1 < MOTION_SET_CONFIG.gating.minPc1Share && (
        <p className="text-xs text-warning-400" data-testid="motion-multi-axis-note">
          {MULTI_AXIS_REASON[0].toUpperCase() + MULTI_AXIS_REASON.slice(1)}.
        </p>
      )}

      {reps.length > 0 ? (
        <>
          {!low && <VelocityBars perRep={velocity.perRep} />}
          <RepTable
            reps={reps}
            perRep={low ? null : velocity.perRep}
            romSuppressed={analysis?.romSuppressed ?? false}
            gravityLabel={
              showGravity
                ? analysis?.gravityRomStatus === 'low-confidence'
                  ? 'ROM (gravity, low conf.)'
                  : 'ROM (gravity)'
                : null
            }
          />
          {analysis?.romSuppressed && (
            <p className="text-xs text-surface-500">
              No still reference anywhere in the capture, so absolute ROM is suppressed — rep
              count, tempo, and velocity are unaffected. If the phone was hand-held, that is
              expected.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-surface-400">No working reps detected in this capture.</p>
      )}

      {analysis && (
        <Collapsible
          title="Rep detection"
          open={repDetectionOpen}
          onToggle={() => setRepDetectionOpen((o) => !o)}
          testId="motion-rep-detection"
        >
          <CaptureChart analysis={analysis} />
        </Collapsible>
      )}

      <div ref={diagnosticsRef}>
        <Collapsible
          title="Capture diagnostics"
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen((o) => !o)}
          testId="motion-diagnostics"
        >
          <Diagnostics
            analysis={analysis}
            cleaned={cleaned}
            stopLatencyMs={stopLatencyMs}
            stopLatencyFallback={stopLatencyFallback}
            onDownloadCsv={onDownloadCsv}
            downloadLabel={downloadLabel}
          />
        </Collapsible>
      </div>
    </div>
  );
}

function SummaryHeader({
  repCount,
  loss,
  zone,
  issues,
  onBadgeClick,
}: {
  repCount: number;
  loss: number | null;
  zone: EffortZone | null;
  /** null = no sensor-level data (restored from a snapshot): no badge. */
  issues: ReturnType<typeof assessCaptureQuality> | null;
  onBadgeClick: () => void;
}) {
  const clean = issues !== null && issues.length === 0;
  return (
    <div className="space-y-1.5" data-testid="motion-analysis-header">
      <p className="text-lg font-semibold text-surface-100" data-testid="motion-summary-line">
        {repCount} rep{repCount === 1 ? '' : 's'}
        {loss !== null && <> · {Math.round(loss * 100)}% velocity loss</>}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {zone ? (
          <span className={`text-sm font-medium ${ZONE_TEXT[zone]}`} data-testid="motion-summary-status">
            {ZONE_LABEL[zone]}
          </span>
        ) : (
          <span />
        )}
        {issues !== null && (
          <button
            type="button"
            onClick={onBadgeClick}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
              clean
                ? 'bg-success-500/10 text-success-400'
                : 'bg-warning-500/10 text-warning-400 border border-warning-500/20'
            }`}
            data-testid="motion-quality-badge"
            aria-label={
              clean
                ? 'Clean capture — show capture diagnostics'
                : `Capture warning: ${issues.map((i) => i.label).join(', ')} — show capture diagnostics`
            }
          >
            {clean ? (
              <>
                <IconCheck size={14} aria-hidden /> Clean capture
              </>
            ) : (
              <>
                <IconAlertTriangle size={14} aria-hidden />
                {issues[0].label}
                {issues.length > 1 && ` +${issues.length - 1}`}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
