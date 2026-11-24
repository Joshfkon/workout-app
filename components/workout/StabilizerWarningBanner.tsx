'use client';

/**
 * Pre-set stabilizer-fatigue warning (modeled on RecalcTargetsBanner).
 * Non-blocking and dismissible per session: the page owns detection
 * (services/muscleRecovery evaluateStabilizerWarning), event logging and the
 * dismissal record (workoutStore.stabilizerWarnings) — this component is
 * purely presentational.
 */

import { useId, useState } from 'react';
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
  // Compact by default (UX panel round 21: "banners and warnings clutter the
  // workout screen"): the warning itself stays visible on the exercise — it
  // is about load on a tired muscle — but the detail and the options open on
  // a tap instead of filling the card.
  const [open, setOpen] = useState(false);
  const recoveredPct = Math.round(warning.readinessRatio * 100);
  const intensityPct = Math.round(warning.intensityRatio * 100);
  const readyIn = formatReadyAt(warning.estimatedReadyAt);
  const detailsId = useId();

  return (
    <div
      className="rounded-xl border border-status-warn/45 bg-status-warn/10 px-3 py-2"
      role="status"
      data-testid="stabilizer-warning-banner"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-status-warn">⚠</span>
        <p className="flex-1 min-w-0 text-subhead font-medium text-status-warn">
          {warning.displayName} still recovering ({recoveredPct}%)
        </p>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailsId}
          className="flex-shrink-0 min-h-[36px] px-2 text-subhead font-medium text-action"
          data-testid="stabilizer-warning-toggle"
        >
          {open ? 'Less' : 'Options'}
        </button>
      </div>
      {open && (
        <div id={detailsId} className="mt-1 pl-6">
          <p className="text-subhead text-ink-2">
            {warning.hoursSinceLoaded !== null
              ? `Last loaded ${formatHoursAgo(warning.hoursSinceLoaded)}`
              : 'Recently loaded'}
            {readyIn ? `, fresh in ${readyIn}` : ''} — and this exercise leans on it at{' '}
            {intensityPct}% of your recent top weight.
          </p>
          {warning.mitigations.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {warning.suggestedLoadKg !== null && (
                <li className="text-subhead text-ink-2">
                  • Drop to ~{formatWeight(warning.suggestedLoadKg, unit, 0)} to stay easy on it
                </li>
              )}
              {warning.mitigations.map((m) => (
                <li key={m} className="text-subhead text-ink-2">• {m}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="mt-1 min-h-[36px] text-subhead text-ink-2 hover:text-ink"
            data-testid="stabilizer-warning-dismiss"
          >
            Got it — train as planned
          </button>
        </div>
      )}
    </div>
  );
}

export default StabilizerWarningBanner;
