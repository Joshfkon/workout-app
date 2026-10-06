'use client';

/**
 * Shared display for a capture analysis (used by both the in-workout
 * capture review and the calibration wizard). Reads top-down as a set
 * summary: verdict header + capture-quality badge, per-rep velocity bars,
 * short callouts, a tap-to-expand rep table, then collapsed "Rep detection"
 * (the w(t) chart) and "Capture diagnostics" (sensor quality, notes, raw
 * CSV export) sections.
 *
 * Thresholds live in MOTION_SET_CONFIG (services/shared/motion/
 * motionSetConfig.ts). Display-only — this consumes services/shared/motion
 * output and feeds nothing back anywhere.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
} from '@tabler/icons-react';
import type {
  CaptureAnalysis,
  CaptureGating,
  CaptureRep,
  VelocityZone,
} from '@/services/shared/motion';
import {
  assessCaptureQuality,
  buildObservations,
  buildSetCallouts,
  captureUnclearLine,
  computeVelocityLoss,
  describeGating,
  gateCapture,
  GRAVITY_ROM_SUPPRESS_BELOW_DEG,
  LOW_CONFIDENCE_PC1_SHARE,
  RAD_TO_DEG,
  MOTION_SET_CONFIG,
  velocityZone,
} from '@/services/shared/motion';
import { TAP_LATENCY_WARN_MS } from '@/lib/motion/deviceMotionRecorder';
import { CaptureChart } from './CaptureChart';

const TIER_LABEL: Record<CaptureAnalysis['tier'], { text: string; className: string }> = {
  mounted: { text: 'mounted', className: 'text-success-400' },
  handheld: { text: 'hand-held', className: 'text-warning-400' },
  none: { text: 'no still ref', className: 'text-danger-400' },
};

const ZONE_TEXT: Record<VelocityZone, string> = {
  fresh: 'text-success-400',
  hard: 'text-warning-400',
  'near-failure': 'text-danger-400',
};
const ZONE_BAR: Record<VelocityZone, string> = {
  fresh: 'bg-success-500',
  hard: 'bg-warning-500',
  'near-failure': 'bg-danger-500',
};

/** Bar area height, px (fixed so bar heights never depend on flex sizing). */
const BAR_AREA_PX = 96;

const degPerS = (radps: number) => `${Math.round(radps * RAD_TO_DEG)}°/s`;
const relZone = (rel: number) => velocityZone(1 - rel);

export interface CaptureAnalysisViewProps {
  analysis: CaptureAnalysis;
  /** Sensor latency at the stop tap, ms; null when unknown / no tap. */
  stopLatencyMs?: number | null;
  /** Shown instead of a latency figure when stopLatencyMs is null. */
  stopLatencyFallback?: string;
  onDownloadCsv?: () => void;
  downloadLabel?: string;
  /**
   * Confidence gating (captureGating). Pass it when the logged rep count is
   * known; otherwise the view gates without one (pauses / short travel).
   */
  gating?: CaptureGating;
}

export function CaptureAnalysisView({
  analysis,
  stopLatencyMs = null,
  stopLatencyFallback = 'n/a',
  onDownloadCsv,
  downloadLabel = 'Download raw capture (CSV)',
  gating: gatingProp,
}: CaptureAnalysisViewProps) {
  // Everything below reads the GATED reps: the longest continuous block,
  // short-travel movements removed. A low-confidence capture shows no
  // velocity figures at all — only why.
  const gating = useMemo(() => gatingProp ?? gateCapture(analysis), [gatingProp, analysis]);
  const reps = gating.reps;
  const low = gating.confidence === 'low';
  const velocity = useMemo(() => computeVelocityLoss(reps), [reps]);
  const callouts = useMemo(() => buildSetCallouts(reps, velocity), [reps, velocity]);
  const issues = useMemo(
    () => assessCaptureQuality(analysis, { stopLatencyMs, latencyWarnMs: TAP_LATENCY_WARN_MS }),
    [analysis, stopLatencyMs]
  );
  const medianComparisons = useMemo(() => buildObservations(reps), [reps]);
  const gatingNote = describeGating(gating);

  const [repDetectionOpen, setRepDetectionOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [scrollToDiagnostics, setScrollToDiagnostics] = useState(false);
  const diagnosticsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollToDiagnostics) return;
    diagnosticsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setScrollToDiagnostics(false);
  }, [scrollToDiagnostics]);

  const openDiagnostics = () => {
    setDiagnosticsOpen(true);
    setScrollToDiagnostics(true);
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="motion-analysis-view">
      <SummaryHeader
        repCount={reps.length}
        loss={low ? null : velocity.loss}
        zone={low ? null : velocity.zone}
        issues={issues}
        onBadgeClick={openDiagnostics}
      />

      {low ? (
        <p
          className="text-sm text-surface-300 pl-3 border-l-2 border-surface-600"
          data-testid="motion-capture-unclear-detail"
        >
          {captureUnclearLine(gating)}
        </p>
      ) : reps.length > 0 ? (
        <>
          <VelocityBars perRep={velocity.perRep} />
          {velocity.excludedIndices.length > 0 && (
            <p className="text-xs text-surface-500" data-testid="motion-velocity-excluded">
              {velocity.excludedIndices.length === 1 ? 'Rep ' : 'Reps '}
              {velocity.excludedIndices.map((i) => i + 1).join(', ')} had no measurable
              concentric velocity and {velocity.excludedIndices.length === 1 ? 'is' : 'are'} left
              out of the baseline.
            </p>
          )}

          {callouts.length > 0 && (
            <ul className="space-y-1.5" data-testid="motion-callouts">
              {callouts.map((c) => (
                <li
                  key={c.kind}
                  className="text-sm text-surface-200 pl-3 border-l-2 border-surface-600"
                >
                  {c.text}
                </li>
              ))}
            </ul>
          )}

          <RepTable analysis={analysis} reps={reps} perRep={velocity.perRep} />

          {analysis.romSuppressed && (
            <p className="text-xs text-surface-500">
              No still reference anywhere in the capture, so absolute ROM is suppressed — rep
              count, tempo, and velocity are unaffected. If the phone was hand-held, that is
              expected.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-surface-400">No reps detected in this capture.</p>
      )}

      <Collapsible
        title="Rep detection"
        open={repDetectionOpen}
        onToggle={() => setRepDetectionOpen((o) => !o)}
        testId="motion-rep-detection"
      >
        <CaptureChart analysis={analysis} />
      </Collapsible>

      <div ref={diagnosticsRef}>
        <Collapsible
          title="Capture diagnostics"
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen((o) => !o)}
          testId="motion-diagnostics"
        >
          <Diagnostics
            analysis={analysis}
            stopLatencyMs={stopLatencyMs}
            stopLatencyFallback={stopLatencyFallback}
            onDownloadCsv={onDownloadCsv}
            downloadLabel={downloadLabel}
            gatingNote={gatingNote}
            medianLines={
              low || medianComparisons.referenceTooThin || medianComparisons.nothingNotable
                ? []
                : medianComparisons.lines
            }
          />
        </Collapsible>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function SummaryHeader({
  repCount,
  loss,
  zone,
  issues,
  onBadgeClick,
}: {
  repCount: number;
  loss: number | null;
  zone: VelocityZone | null;
  issues: ReturnType<typeof assessCaptureQuality>;
  onBadgeClick: () => void;
}) {
  const clean = issues.length === 0;
  return (
    <div className="space-y-1.5" data-testid="motion-analysis-header">
      <p className="text-lg font-semibold text-surface-100" data-testid="motion-summary-line">
        {repCount} rep{repCount === 1 ? '' : 's'}
        {loss !== null && <> · {Math.round(loss * 100)}% velocity loss</>}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {zone ? (
          <span
            className={`text-sm font-medium ${ZONE_TEXT[zone]}`}
            data-testid="motion-summary-status"
          >
            {MOTION_SET_CONFIG.summary.zoneLabels[zone]}
          </span>
        ) : (
          <span />
        )}
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
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Velocity bars
// ---------------------------------------------------------------------------

function VelocityBars({ perRep }: { perRep: ReturnType<typeof computeVelocityLoss>['perRep'] }) {
  // Percent labels above bars only while they have room to breathe.
  const showPct = perRep.length <= 12;
  return (
    <div className="rounded-lg bg-surface-900/60 p-3" data-testid="motion-velocity-bars">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">
        Velocity by rep · % of fastest
      </p>
      <div className="flex items-end gap-1" role="list" aria-label="Velocity by rep">
        {perRep.map((p) => {
          const rel = p.relative;
          const pct = rel === null ? null : Math.round(rel * 100);
          return (
            <div
              key={p.index}
              role="listitem"
              className="flex min-w-0 flex-1 flex-col items-center"
              aria-label={`Rep ${p.index + 1}: ${pct === null ? 'no velocity measured' : `${pct}% of fastest`}`}
            >
              <div
                className="flex w-full flex-col items-center justify-end"
                style={{ height: BAR_AREA_PX + (showPct ? 14 : 0) }}
              >
                {showPct && (
                  <span className="mb-0.5 text-[10px] leading-none text-surface-400">
                    {pct === null ? '—' : pct}
                  </span>
                )}
                <div
                  className={`w-full max-w-[28px] rounded-t ${
                    rel === null ? 'bg-surface-700' : ZONE_BAR[relZone(rel)]
                  }`}
                  style={{ height: rel === null ? 3 : Math.max(3, rel * BAR_AREA_PX) }}
                />
              </div>
              <span className="mt-1 text-[10px] leading-none text-surface-500">{p.index + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rep table
// ---------------------------------------------------------------------------

function RepTable({
  analysis,
  reps,
  perRep,
}: {
  analysis: CaptureAnalysis;
  reps: CaptureRep[];
  perRep: ReturnType<typeof computeVelocityLoss>['perRep'];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  // The gravity cross-check only applies when the rotation axis is far
  // enough from vertical for the accelerometer to see the rotation.
  const showGravity =
    analysis.gravityRomStatus === 'ok' || analysis.gravityRomStatus === 'low-confidence';

  return (
    <table className="w-full table-fixed text-sm" data-testid="motion-analysis-rep-table">
      <thead>
        <tr className="text-left text-xs text-surface-500">
          <th className="w-[18%] py-1 font-medium">Rep</th>
          <th className="w-[36%] py-1 font-medium">Tempo</th>
          <th className="w-[26%] py-1 font-medium">Velocity</th>
          <th className="w-[20%] py-1 text-right font-medium">ROM</th>
        </tr>
      </thead>
      {reps.map((rep, i) => {
        const v = perRep[i];
        const isOpen = expanded === rep.index;
        const toggle = () => setExpanded(isOpen ? null : rep.index);
        return (
          <tbody key={rep.index} className="border-t border-surface-800">
            <tr
              className="cursor-pointer text-surface-300"
              onClick={toggle}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle();
                }
              }}
              tabIndex={0}
              aria-expanded={isOpen}
              data-testid={`motion-rep-row-${rep.index + 1}`}
            >
              <td className="py-2">
                <span className="inline-flex items-center gap-0.5">
                  {isOpen ? (
                    <IconChevronDown size={12} className="text-surface-500" aria-hidden />
                  ) : (
                    <IconChevronRight size={12} className="text-surface-500" aria-hidden />
                  )}
                  {rep.index + 1}
                </span>
              </td>
              <td className="py-2 whitespace-nowrap tabular-nums">
                {(rep.concentricMs / 1000).toFixed(1)}↑ {(rep.eccentricMs / 1000).toFixed(1)}↓
              </td>
              <td
                className={`py-2 tabular-nums ${
                  v.relative === null ? 'text-surface-500' : ZONE_TEXT[relZone(v.relative)]
                }`}
              >
                {v.relative === null ? '—' : `${Math.round(v.relative * 100)}%`}
              </td>
              <td className="py-2 text-right tabular-nums">
                {analysis.romSuppressed ? '—' : `${rep.romConcentricDeg.toFixed(0)}°`}
              </td>
            </tr>
            {isOpen && (
              <tr data-testid={`motion-rep-detail-${rep.index + 1}`}>
                <td colSpan={4} className="pb-3">
                  <RepDetail rep={rep} analysis={analysis} showGravity={showGravity} />
                </td>
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}

function RepDetail({
  rep,
  analysis,
  showGravity,
}: {
  rep: CaptureRep;
  analysis: CaptureAnalysis;
  showGravity: boolean;
}) {
  const items: Array<[string, string]> = [
    ['Peak ω', degPerS(rep.peakW)],
    ['Mean ω', degPerS(rep.meanWConcentric)],
    ['Concentric', `${(rep.concentricMs / 1000).toFixed(2)} s`],
    ['Eccentric', `${(rep.eccentricMs / 1000).toFixed(2)} s`],
    ['Dwell', rep.bottomDwellMs === null ? '—' : `${Math.round(rep.bottomDwellMs / 10) * 10} ms`],
    [
      'Turn accel',
      rep.turnaroundPeakAccelRadps2 === null
        ? '—'
        : `${Math.round(rep.turnaroundPeakAccelRadps2 * RAD_TO_DEG)}°/s²`,
    ],
  ];
  if (showGravity) {
    items.push([
      analysis.gravityRomStatus === 'low-confidence' ? 'ROM (gravity, low conf.)' : 'ROM (gravity)',
      rep.romGravityDeg === null ? '—' : `${rep.romGravityDeg.toFixed(0)}°`,
    ]);
  }
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg bg-surface-900/60 p-2.5 text-xs">
      {items.map(([k, val]) => (
        <div key={k} className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-surface-500">{k}</dt>
          <dd className="whitespace-nowrap tabular-nums text-surface-200">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Collapsible sections
// ---------------------------------------------------------------------------

function Collapsible({
  title,
  open,
  onToggle,
  testId,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-surface-800 pt-2" data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between py-1 text-xs font-medium uppercase tracking-wide text-surface-500 hover:text-surface-300"
        aria-expanded={open}
        data-testid={`${testId}-toggle`}
      >
        {title}
        {open ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
      </button>
      {open && <div className="mt-2 space-y-3">{children}</div>}
    </div>
  );
}

function Diagnostics({
  analysis,
  stopLatencyMs,
  stopLatencyFallback,
  onDownloadCsv,
  downloadLabel,
  medianLines,
  gatingNote,
}: {
  analysis: CaptureAnalysis;
  stopLatencyMs: number | null;
  stopLatencyFallback: string;
  onDownloadCsv?: () => void;
  downloadLabel: string;
  medianLines: string[];
  gatingNote: string | null;
}) {
  const tier = TIER_LABEL[analysis.tier];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        <div className="rounded-lg bg-surface-900/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Sample rate</p>
          <p className="text-sm font-semibold text-surface-200">
            {analysis.sampleRateHz.toFixed(1)} Hz
          </p>
        </div>
        <div className="rounded-lg bg-surface-900/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Dropped</p>
          <p
            className={`text-sm font-semibold ${analysis.droppedFrames > 0 ? 'text-warning-400' : 'text-surface-200'}`}
          >
            {analysis.droppedFrames}
          </p>
        </div>
        <div className="rounded-lg bg-surface-900/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Stillness</p>
          <p className={`text-sm font-semibold ${tier.className}`}>{tier.text}</p>
        </div>
        <div className="rounded-lg bg-surface-900/60 p-2">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">PC1 share</p>
          <p
            className={`text-sm font-semibold ${analysis.lowConfidence ? 'text-warning-400' : 'text-surface-200'}`}
          >
            {(analysis.pc1VarianceShare * 100).toFixed(0)}%
          </p>
        </div>
      </div>

      {analysis.lowConfidence && (
        <p className="text-xs text-warning-400">
          Motion is not single-DOF (PC1 variance share below {LOW_CONFIDENCE_PC1_SHARE * 100}%) —
          treat this capture as low-confidence.
        </p>
      )}

      <p className="text-xs text-surface-400" data-testid="motion-stop-latency">
        Sensor latency at stop tap:{' '}
        {stopLatencyMs === null ? stopLatencyFallback : `${Math.round(stopLatencyMs)} ms`}
        {stopLatencyMs !== null && stopLatencyMs > TAP_LATENCY_WARN_MS && (
          <span className="text-warning-400">
            {' '}
            — stale (&gt;{TAP_LATENCY_WARN_MS} ms; sensor delivery is lagging taps)
          </span>
        )}
      </p>

      {analysis.gravityRomStatus === 'suppressed' && (
        <p className="text-xs text-surface-500" data-testid="motion-gravity-rom-suppressed">
          The rotation axis is within {GRAVITY_ROM_SUPPRESS_BELOW_DEG}° of vertical, so the
          accelerometer cross-check can&apos;t resolve this rotation — gravity ROM is hidden.
        </p>
      )}
      {gatingNote && (
        <p className="text-xs text-surface-500" data-testid="motion-gating-note">
          {gatingNote}
        </p>
      )}
      {analysis.unpairedHalfReps > 0 && (
        <p className="text-xs text-surface-500">
          {analysis.unpairedHalfReps} movement phase{analysis.unpairedHalfReps === 1 ? '' : 's'}{' '}
          didn&apos;t pair into a rep.
        </p>
      )}

      {medianLines.length > 0 && (
        <div className="space-y-1" data-testid="motion-observations">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">
            Compared with set median
          </p>
          {medianLines.map((line) => (
            <p key={line} className="text-xs text-surface-400">
              {line}
            </p>
          ))}
        </div>
      )}

      {onDownloadCsv && (
        <button
          type="button"
          onClick={onDownloadCsv}
          className="text-xs text-primary-400 hover:text-primary-300"
          data-testid="motion-download-csv"
        >
          {downloadLabel}
        </button>
      )}
    </>
  );
}
