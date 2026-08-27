'use client';

/**
 * Pre-set stabilizer-fatigue warning (modeled on RecalcTargetsBanner).
 * Non-blocking and dismissible per session: the page owns detection
 * (services/muscleRecovery evaluateStabilizerWarning), event logging and the
 * dismissal record (workoutStore.stabilizerWarnings) — this component is
 * purely presentational.
 */

import { formatWeight } from '@/lib/utils';
import type { StandardMuscleGroup, WeightUnit } from '@/types/schema';

export interface StabilizerWarningView {
  muscle: StandardMuscleGroup;
  displayName: string;
  /** Stabilizer-channel readiness, [0, 1]. */
  readinessRatio: number;
  /** Planned load ÷ reference load. */
  intensityRatio: number;
  /** A load that would sit under the intensity gate, or null. */
  suggestedLoadKg: number | null;
  /** Hours since the stabilizer was last loaded (null: unknown). */
  hoursSinceLoaded: number | null;
  /** When the stabilizer channel expects the muscle fresh again. */
  estimatedReadyAt: string | null;
  /** Per-muscle mitigation copy (stabilizerTags.STABILIZER_MITIGATIONS). */
  mitigations: string[];
  /** Raw gate inputs, carried for event logging (not rendered). */
  plannedLoadKg: number;
  referenceLoadKg: number;
}

export interface StabilizerWarningBannerProps {
  warning: StabilizerWarningView;
  unit: WeightUnit;
  onDismiss: () => void;
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) return 'under an hour ago';
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function formatReadyAt(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Visual-only read of the wall clock (allowed per lib/clock rules).
  const hoursAway = (date.getTime() - Date.now()) / 3_600_000;
  if (hoursAway <= 0) return null;
  if (hoursAway < 24) return `~${Math.max(1, Math.round(hoursAway))}h`;
  return `~${Math.round(hoursAway / 24)}d`;
}

export function StabilizerWarningBanner({ warning, unit, onDismiss }: StabilizerWarningBannerProps) {
  const recoveredPct = Math.round(warning.readinessRatio * 100);
  const intensityPct = Math.round(warning.intensityRatio * 100);
  const readyIn = formatReadyAt(warning.estimatedReadyAt);

  return (
    <div
      className="rounded-xl border border-warning-500/45 bg-warning-500/10 px-4 py-3"
      role="status"
      data-testid="stabilizer-warning-banner"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="text-warning-400 mt-0.5">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-warning-300">
            {warning.displayName} still recovering ({recoveredPct}%)
          </p>
          <p className="text-[13px] text-surface-400 mt-0.5">
            {warning.hoursSinceLoaded !== null
              ? `Last loaded ${formatHoursAgo(warning.hoursSinceLoaded)}`
              : 'Recently loaded'}
            {readyIn ? `, fresh in ${readyIn}` : ''} — and this exercise leans on it at{' '}
            {intensityPct}% of your recent top weight.
          </p>
          {warning.mitigations.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {warning.suggestedLoadKg !== null && (
                <li className="text-[13px] text-surface-300">
                  • Drop to ~{formatWeight(warning.suggestedLoadKg, unit, 0)} to stay easy on it
                </li>
              )}
              {warning.mitigations.map((m) => (
                <li key={m} className="text-[13px] text-surface-300">• {m}</li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-[36px] px-3 text-sm text-surface-400 hover:text-surface-200"
              data-testid="stabilizer-warning-dismiss"
            >
              Got it — train as planned
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StabilizerWarningBanner;
