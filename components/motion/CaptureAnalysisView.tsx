'use client';

/**
 * Shared display for a capture analysis (used by both the in-workout
 * capture review and the calibration wizard): header strip, the w(t)
 * chart, the per-rep metric table, and the post-set Observations block.
 *
 * FRAMING: this panel DESCRIBES what the sensor measured. It never judges
 * reps — no dismissive or judgmental labels ever attach to a rep; the
 * user interprets, the app reports (see services/shared/motion/
 * observations.ts and its banned-language test).
 *
 * Display-only — this consumes services/shared/motion output and feeds
 * nothing back anywhere.
 */

import { useMemo } from 'react';
import type { CaptureAnalysis } from '@/services/shared/motion';
import {
  buildObservations,
  GRAVITY_ROM_SUPPRESS_BELOW_DEG,
  LOW_CONFIDENCE_PC1_SHARE,
  NOTHING_NOTABLE_LINE,
  OBSERVATIONS_CONTEXT_LINE,
  THIN_REFERENCE_LINE,
} from '@/services/shared/motion';
import { CaptureChart } from './CaptureChart';

const TIER_LABEL: Record<CaptureAnalysis['tier'], { text: string; className: string }> = {
  mounted: { text: 'mounted', className: 'text-success-400' },
  handheld: { text: 'hand-held', className: 'text-warning-400' },
  none: { text: 'no still ref', className: 'text-danger-400' },
};

export function CaptureAnalysisView({ analysis }: { analysis: CaptureAnalysis }) {
  const tier = TIER_LABEL[analysis.tier];
  // The gravity cross-check column only appears when the rotation axis is
  // far enough from vertical for the accelerometer to see the rotation.
  const showGravity =
    analysis.gravityRomStatus === 'ok' || analysis.gravityRomStatus === 'low-confidence';
  const observations = useMemo(() => buildObservations(analysis.reps), [analysis.reps]);

  return (
    <div className="space-y-3" data-testid="motion-analysis-view">
      {/* Header strip */}
      <div className="grid grid-cols-5 gap-2 text-center" data-testid="motion-analysis-header">
        <div className="p-2 rounded-lg bg-surface-900/60">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Sample rate</p>
          <p className="text-sm font-semibold text-surface-200">{analysis.sampleRateHz.toFixed(1)} Hz</p>
        </div>
        <div className="p-2 rounded-lg bg-surface-900/60">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Dropped</p>
          <p className={`text-sm font-semibold ${analysis.droppedFrames > 0 ? 'text-warning-400' : 'text-surface-200'}`}>
            {analysis.droppedFrames}
          </p>
        </div>
        <div className="p-2 rounded-lg bg-surface-900/60">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Stillness</p>
          <p className={`text-sm font-semibold ${tier.className}`}>{tier.text}</p>
        </div>
        <div className="p-2 rounded-lg bg-surface-900/60">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">PC1 share</p>
          <p className={`text-sm font-semibold ${analysis.lowConfidence ? 'text-warning-400' : 'text-surface-200'}`}>
            {(analysis.pc1VarianceShare * 100).toFixed(0)}%
          </p>
        </div>
        {/* Set-relative segmentation thresholds actually used (enter/exit,
            rad/s) — surfaced so threshold behavior is debuggable from the
            UI when a capture's rep count looks off. */}
        <div className="p-2 rounded-lg bg-surface-900/60" data-testid="motion-analysis-thresholds">
          <p className="text-[10px] uppercase tracking-wide text-surface-500">Thresholds</p>
          <p className="text-sm font-semibold text-surface-200">
            {analysis.enterOmegaRadps.toFixed(2)}/{analysis.exitOmegaRadps.toFixed(2)}
          </p>
        </div>
      </div>

      {analysis.lowConfidence && (
        <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
          <p className="text-xs text-warning-400">
            Motion is not single-DOF (PC1 variance share below{' '}
            {LOW_CONFIDENCE_PC1_SHARE * 100}%) — treat this capture as low-confidence.
          </p>
        </div>
      )}

      <CaptureChart analysis={analysis} />

      {/* Per-rep table */}
      {analysis.reps.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="motion-analysis-rep-table">
            <thead>
              <tr className="text-surface-500 text-left">
                <th className="py-1 pr-2 font-medium">Rep</th>
                <th className="py-1 pr-2 font-medium">Conc (s)</th>
                <th className="py-1 pr-2 font-medium">Ecc (s)</th>
                <th className="py-1 pr-2 font-medium">Peak ω</th>
                <th className="py-1 pr-2 font-medium">Mean ω</th>
                <th className="py-1 pr-2 font-medium">ROM</th>
                {showGravity && (
                  <th className="py-1 pr-2 font-medium">
                    ROM (gravity)
                    {analysis.gravityRomStatus === 'low-confidence' && (
                      <span className="ml-1 font-normal text-surface-500">low conf.</span>
                    )}
                  </th>
                )}
                <th className="py-1 pr-2 font-medium">Dwell</th>
                <th className="py-1 font-medium">Turn accel</th>
              </tr>
            </thead>
            <tbody>
              {analysis.reps.map((rep) => (
                <tr key={rep.index} className="text-surface-300">
                  <td className="py-1.5 pr-2">{rep.index + 1}</td>
                  <td className="py-1.5 pr-2">{(rep.concentricMs / 1000).toFixed(2)}</td>
                  <td className="py-1.5 pr-2">{(rep.eccentricMs / 1000).toFixed(2)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{rep.peakW.toFixed(2)} rad/s</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">{rep.meanWConcentric.toFixed(2)} rad/s</td>
                  <td className="py-1.5 pr-2">
                    {analysis.romSuppressed ? '—' : `${rep.romConcentricDeg.toFixed(0)}°`}
                  </td>
                  {showGravity && (
                    <td className="py-1.5 pr-2">
                      {rep.romGravityDeg === null ? '—' : `${rep.romGravityDeg.toFixed(0)}°`}
                    </td>
                  )}
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {rep.bottomDwellMs === null ? '—' : `${Math.round(rep.bottomDwellMs / 10) * 10} ms`}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    {rep.turnaroundPeakAccelRadps2 === null
                      ? '—'
                      : `${rep.turnaroundPeakAccelRadps2.toFixed(1)} rad/s²`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-surface-400">No reps detected in this capture.</p>
      )}

      {analysis.gravityRomStatus === 'suppressed' && (
        <p className="text-xs text-surface-500" data-testid="motion-gravity-rom-suppressed">
          The rotation axis is within {GRAVITY_ROM_SUPPRESS_BELOW_DEG}° of vertical, so the
          accelerometer cross-check can&apos;t resolve this rotation — the gravity ROM column is
          hidden.
        </p>
      )}
      {analysis.romSuppressed && (
        <p className="text-xs text-surface-500">
          No still reference anywhere in the capture, so absolute ROM is suppressed — rep count,
          tempo, and velocity are unaffected. If the phone was hand-held, that is expected.
        </p>
      )}
      {analysis.unpairedHalfReps > 0 && (
        <p className="text-xs text-surface-500">
          {analysis.unpairedHalfReps} movement phase{analysis.unpairedHalfReps === 1 ? '' : 's'}{' '}
          didn&apos;t pair into a rep.
        </p>
      )}

      {/* Observations: descriptive only, within-set median reference. */}
      {analysis.reps.length > 0 && (
        <div className="space-y-1.5" data-testid="motion-observations">
          <p className="text-xs font-medium uppercase tracking-wide text-surface-500">
            Observations
          </p>
          {observations.referenceTooThin ? (
            <p className="text-sm text-surface-300">{THIN_REFERENCE_LINE}</p>
          ) : observations.nothingNotable ? (
            <p className="text-sm text-surface-300">{NOTHING_NOTABLE_LINE}</p>
          ) : (
            observations.lines.map((line) => (
              <p key={line} className="text-sm text-surface-300">
                {line}
              </p>
            ))
          )}
          <p className="text-xs text-surface-500" data-testid="motion-observations-context">
            {OBSERVATIONS_CONTEXT_LINE}
          </p>
        </div>
      )}
    </div>
  );
}
