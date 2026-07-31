'use client';

/**
 * Shared display for a capture analysis (used by both the in-workout
 * capture review and the calibration wizard): header strip, the w(t)
 * chart, and the per-rep metric table. Display-only — this consumes
 * services/shared/motion output and feeds nothing back anywhere.
 */

import type { CaptureAnalysis } from '@/services/shared/motion';
import { LOW_CONFIDENCE_PC1_SHARE } from '@/services/shared/motion';
import { CaptureChart } from './CaptureChart';

const TIER_LABEL: Record<CaptureAnalysis['tier'], { text: string; className: string }> = {
  mounted: { text: 'mounted', className: 'text-success-400' },
  handheld: { text: 'hand-held', className: 'text-warning-400' },
  none: { text: 'no still ref', className: 'text-danger-400' },
};

export function CaptureAnalysisView({ analysis }: { analysis: CaptureAnalysis }) {
  const tier = TIER_LABEL[analysis.tier];
  const showGravity = analysis.tier !== 'none';

  return (
    <div className="space-y-3" data-testid="motion-analysis-view">
      {/* Header strip */}
      <div className="grid grid-cols-4 gap-2 text-center" data-testid="motion-analysis-header">
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
                {showGravity && <th className="py-1 font-medium">ROM (gravity)</th>}
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
                    <td className="py-1.5">
                      {rep.romGravityDeg === null ? '—' : `${rep.romGravityDeg.toFixed(0)}°`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-surface-400">No reps detected in this capture.</p>
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
          didn&apos;t pair into a rep (partial or interrupted stroke).
        </p>
      )}
    </div>
  );
}
