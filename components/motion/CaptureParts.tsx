'use client';

/**
 * Building blocks for the capture views: the coach block, per-rep velocity
 * bars, the tap-to-expand rep table, collapsible sections, and the
 * diagnostics drawer. All read CLEANED reps (captureGating) — artifacts
 * never reach a figure here.
 */

import { useState, type ReactNode } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type {
  CaptureAnalysis,
  CleanedCapture,
  CleanRep,
  CoachFeedback,
  EffortZone,
  RepVelocity,
} from '@/services/shared/motion';
import {
  describeCleaning,
  effortZone,
  GRAVITY_ROM_SUPPRESS_BELOW_DEG,
  MOTION_SET_CONFIG,
  RAD_TO_DEG,
} from '@/services/shared/motion';
import { TAP_LATENCY_WARN_MS } from '@/lib/motion/deviceMotionRecorder';

export const ZONE_TEXT: Record<EffortZone, string> = {
  easy: 'text-success-400',
  moderate: 'text-success-300',
  hard: 'text-warning-400',
  'near-failure': 'text-danger-400',
};
const ZONE_BAR: Record<EffortZone, string> = {
  easy: 'bg-success-500',
  moderate: 'bg-success-600',
  hard: 'bg-warning-500',
  'near-failure': 'bg-danger-500',
};
export const ZONE_LABEL: Record<EffortZone, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  'near-failure': 'Near failure',
};

const TIER_LABEL: Record<CaptureAnalysis['tier'], { text: string; className: string }> = {
  mounted: { text: 'mounted', className: 'text-success-400' },
  handheld: { text: 'hand-held', className: 'text-warning-400' },
  none: { text: 'no still ref', className: 'text-danger-400' },
};

/** Bar area height, px (fixed so bar heights never depend on flex sizing). */
const BAR_AREA_PX = 96;

const degPerS = (radps: number) => `${Math.round(radps * RAD_TO_DEG)}°/s`;
const relZone = (rel: number) => effortZone(Math.max(0, 1 - rel));

// ---------------------------------------------------------------------------
// Coach block
// ---------------------------------------------------------------------------

export interface CoachText {
  verdict: string | null;
  cues: string[];
  nextSetCall: string | null;
}

/** Template text from the findings (the ship-ready default). */
export function coachTemplateText(fb: CoachFeedback, nextSetCall: string | null): CoachText {
  return { verdict: fb.verdict, cues: fb.cues.map((c) => c.cue), nextSetCall };
}

export function CoachBlock({ feedback, text }: { feedback: CoachFeedback; text: CoachText }) {
  return (
    <div className="space-y-2" data-testid="coach-feedback">
      {feedback.unclearLine ? (
        <p className="text-sm text-surface-300" data-testid="coach-unclear">
          {feedback.unclearLine}
        </p>
      ) : text.verdict ? (
        <p className="text-[15px] font-medium text-surface-100" data-testid="coach-verdict">
          {text.verdict}
        </p>
      ) : null}
      {!feedback.unclearLine &&
        text.cues.map((cue) => (
          <p key={cue} className="text-sm text-surface-300 pl-3 border-l-2 border-surface-600" data-testid="coach-cue">
            {cue}
          </p>
        ))}
      {text.nextSetCall && (
        <p className="text-sm font-medium text-primary-300" data-testid="coach-next-set">
          {text.nextSetCall}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Velocity bars
// ---------------------------------------------------------------------------

export function VelocityBars({ perRep }: { perRep: RepVelocity[] }) {
  const showPct = perRep.length <= 12;
  // Reps can be faster than the baseline (it's the first two reps, not the
  // fastest), so heights scale to the tallest bar.
  const maxRel = Math.max(1, ...perRep.map((p) => p.relative ?? 0));
  return (
    <div className="rounded-lg bg-surface-900/60 p-3" data-testid="motion-velocity-bars">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">
        Velocity by rep · % of start
      </p>
      <div className="flex items-end gap-1" role="list" aria-label="Velocity by rep">
        {perRep.map((p) => {
          const rel = p.relative;
          const pct = rel === null ? null : Math.round(rel * 100);
          return (
            <div
              key={p.n}
              role="listitem"
              className="flex min-w-0 flex-1 flex-col items-center"
              aria-label={`Rep ${p.n}: ${pct === null ? 'no velocity measured' : `${pct}% of start`}`}
            >
              <div
                className="flex w-full flex-col items-center justify-end"
                style={{ height: BAR_AREA_PX + (showPct ? 14 : 0) }}
              >
                {showPct && (
                  <span className="mb-0.5 text-[10px] leading-none text-surface-400">{pct ?? '—'}</span>
                )}
                <div
                  className={`w-full max-w-[28px] rounded-t ${rel === null ? 'bg-surface-700' : ZONE_BAR[relZone(rel)]}`}
                  style={{ height: rel === null ? 3 : Math.max(3, (rel / maxRel) * BAR_AREA_PX) }}
                />
              </div>
              <span className="mt-1 text-[10px] leading-none text-surface-500">{p.n}</span>
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

export function RepTable({
  reps,
  perRep,
  romSuppressed,
  gravityLabel,
}: {
  reps: CleanRep[];
  /** null → no velocity column values (low confidence). */
  perRep: RepVelocity[] | null;
  romSuppressed: boolean;
  /** Gravity-ROM detail label, or null to hide that detail. */
  gravityLabel: string | null;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
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
        const rel = perRep?.[i]?.relative ?? null;
        const isOpen = expanded === rep.n;
        const toggle = () => setExpanded(isOpen ? null : rep.n);
        return (
          <tbody key={rep.n} className="border-t border-surface-800">
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
              data-testid={`motion-rep-row-${rep.n}`}
            >
              <td className="py-2">
                <span className="inline-flex items-center gap-0.5">
                  {isOpen ? (
                    <IconChevronDown size={12} className="text-surface-500" aria-hidden />
                  ) : (
                    <IconChevronRight size={12} className="text-surface-500" aria-hidden />
                  )}
                  {rep.n}
                </span>
              </td>
              <td className="py-2 whitespace-nowrap tabular-nums">
                {(rep.concentricMs / 1000).toFixed(1)}↑ {(rep.eccentricMs / 1000).toFixed(1)}↓
              </td>
              <td className={`py-2 tabular-nums ${rel === null ? 'text-surface-500' : ZONE_TEXT[relZone(rel)]}`}>
                {rel === null ? '—' : `${Math.round(rel * 100)}%`}
              </td>
              <td className="py-2 text-right tabular-nums">
                {romSuppressed ? '—' : `${rep.romDeg.toFixed(0)}°`}
              </td>
            </tr>
            {isOpen && (
              <tr data-testid={`motion-rep-detail-${rep.n}`}>
                <td colSpan={4} className="pb-3">
                  <RepDetail rep={rep} gravityLabel={gravityLabel} />
                </td>
              </tr>
            )}
          </tbody>
        );
      })}
    </table>
  );
}

function RepDetail({ rep, gravityLabel }: { rep: CleanRep; gravityLabel: string | null }) {
  const items: Array<[string, string]> = [
    ['Peak ω', degPerS(rep.peakW)],
    ['Mean ω', degPerS(rep.meanW)],
    ['Concentric', `${(rep.concentricMs / 1000).toFixed(2)} s`],
    ['Eccentric', `${(rep.eccentricMs / 1000).toFixed(2)} s`],
    ['Dwell', rep.dwellMs === null ? '—' : `${Math.round(rep.dwellMs / 10) * 10} ms`],
    [
      'Turn accel',
      rep.turnaroundAccelRadps2 === null ? '—' : `${Math.round(rep.turnaroundAccelRadps2 * RAD_TO_DEG)}°/s²`,
    ],
  ];
  if (gravityLabel) {
    items.push([gravityLabel, rep.romGravityDeg === null ? '—' : `${rep.romGravityDeg.toFixed(0)}°`]);
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
// Collapsible + diagnostics
// ---------------------------------------------------------------------------

export function Collapsible({
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

const Tile = ({ label, value, className = 'text-surface-200' }: { label: string; value: string; className?: string }) => (
  <div className="rounded-lg bg-surface-900/60 p-2">
    <p className="text-[10px] uppercase tracking-wide text-surface-500">{label}</p>
    <p className={`text-sm font-semibold ${className}`}>{value}</p>
  </div>
);

export function Diagnostics({
  analysis,
  cleaned,
  stopLatencyMs,
  stopLatencyFallback,
  onDownloadCsv,
  downloadLabel,
}: {
  analysis: CaptureAnalysis | null;
  cleaned: CleanedCapture;
  stopLatencyMs: number | null;
  stopLatencyFallback: string;
  onDownloadCsv?: () => void;
  downloadLabel: string;
}) {
  const min = MOTION_SET_CONFIG.gating.minPc1Share;
  const pc1 = cleaned.pc1ShareClean ?? cleaned.pc1ShareRaw;
  const cleaningLog = describeCleaning(cleaned);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {analysis && <Tile label="Sample rate" value={`${analysis.sampleRateHz.toFixed(1)} Hz`} />}
        {analysis && (
          <Tile
            label="Dropped"
            value={String(analysis.droppedFrames)}
            className={analysis.droppedFrames > 0 ? 'text-warning-400' : 'text-surface-200'}
          />
        )}
        {analysis && (
          <Tile label="Stillness" value={TIER_LABEL[analysis.tier].text} className={TIER_LABEL[analysis.tier].className} />
        )}
        <Tile
          label="PC1 share"
          value={`${(pc1 * 100).toFixed(0)}%`}
          className={pc1 < min ? 'text-warning-400' : 'text-surface-200'}
        />
      </div>

      <p className="text-xs text-surface-500" data-testid="motion-pc1-technical">
        PC1 variance share {(cleaned.pc1ShareRaw * 100).toFixed(0)}% over the whole capture
        {cleaned.pc1ShareClean !== null && `, ${(cleaned.pc1ShareClean * 100).toFixed(0)}% over the clean reps`}
        {pc1 < min
          ? ` — below ${min * 100}%, the motion is not single-DOF; treat this capture as low-confidence.`
          : '.'}
      </p>

      {analysis && (
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
      )}

      {analysis?.gravityRomStatus === 'suppressed' && (
        <p className="text-xs text-surface-500" data-testid="motion-gravity-rom-suppressed">
          The rotation axis is within {GRAVITY_ROM_SUPPRESS_BELOW_DEG}° of vertical, so the
          accelerometer cross-check can&apos;t resolve this rotation — gravity ROM is hidden.
        </p>
      )}

      {cleaningLog.length > 0 && (
        <div className="space-y-1" data-testid="motion-cleaning-log">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Rep cleaning</p>
          {cleaningLog.map((line) => (
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
