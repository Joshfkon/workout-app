'use client';

import { memo } from 'react';
import type { BodyweightData, WeightUnit } from '@/types/schema';
import { calculatePercentBodyweight } from '@/types/schema';
import { formatWeightValue, convertWeightForDisplay } from '@/lib/utils';

interface BodyweightDisplayProps {
  /** Bodyweight data from the set */
  data: BodyweightData;
  /** Display mode: compact for table rows, full for detailed view */
  mode?: 'compact' | 'full' | 'minimal';
  /** Weight unit for display */
  unit?: WeightUnit;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Display component for bodyweight exercise data
 *
 * Compact mode: "BW (176.6)", "BW+25", "BW-30"
 * Minimal mode: Just the effective load number
 * Full mode: Complete breakdown with BW, modification, and total
 */
export const BodyweightDisplay = memo(function BodyweightDisplay({
  data,
  mode = 'compact',
  unit = 'kg',
  className = '',
}: BodyweightDisplayProps) {
  const { userBodyweightKg, modification, addedWeightKg, assistanceWeightKg, effectiveLoadKg } = data;

  // Use convertWeightForDisplay to preserve exact values (not rounded to plate increments)
  const displayWeight = (kg: number) => convertWeightForDisplay(kg, unit);
  const bw = displayWeight(userBodyweightKg);
  const effective = displayWeight(effectiveLoadKg);
  const percentBw = calculatePercentBodyweight(effectiveLoadKg, userBodyweightKg);

  // Minimal mode - just show effective load
  if (mode === 'minimal') {
    return <span className={className}>{effective} {unit}</span>;
  }

  // Compact mode for table rows
  if (mode === 'compact') {
    let display: React.ReactNode;

    switch (modification) {
      case 'none':
        display = (
          <span className="text-ink">
            BW <span className="text-ink-2">({bw})</span>
          </span>
        );
        break;
      case 'weighted':
        display = (
          <span>
            <span className="text-ink">BW</span>
            <span className="text-status-ok">+{displayWeight(addedWeightKg || 0)}</span>
          </span>
        );
        break;
      case 'assisted':
        display = (
          <span>
            <span className="text-ink">BW</span>
            <span className="text-action">-{displayWeight(assistanceWeightKg || 0)}</span>
            {data.assistanceType === 'band' && (
              <span className="text-ink-3 text-caption ml-0.5">~</span>
            )}
          </span>
        );
        break;
    }

    return <span className={`font-mono text-subhead ${className}`}>{display}</span>;
  }

  // Full mode - detailed breakdown
  return (
    <div className={`bg-fill rounded-lg p-3 ${className}`}>
      <div className="space-y-2 text-subhead">
        {/* Bodyweight row */}
        <div className="flex justify-between items-center">
          <span className="text-ink-2">BW:</span>
          <span className="text-ink font-mono">{bw} {unit}</span>
        </div>

        {/* Added weight row */}
        {modification === 'weighted' && addedWeightKg && (
          <div className="flex justify-between items-center text-status-ok">
            <span>Added:</span>
            <span className="font-mono">+ {displayWeight(addedWeightKg)} {unit}</span>
          </div>
        )}

        {/* Assistance row */}
        {modification === 'assisted' && assistanceWeightKg && (
          <div className="flex justify-between items-center text-action">
            <span>
              Assistance
              {data.assistanceType === 'band' && data.bandColor && (
                <span className="text-ink-3 ml-1">
                  ({data.bandColor} band)
                </span>
              )}
              :
            </span>
            <span className="font-mono">
              - {displayWeight(assistanceWeightKg)} {unit}
              {data.assistanceType === 'band' && ' ~'}
            </span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-sep"></div>

        {/* Total/Effective row */}
        <div className="flex justify-between items-center font-semibold">
          <span className="text-ink-2">
            {modification === 'assisted' ? 'Effective:' : 'Total:'}
          </span>
          <span className="text-action font-mono">{effective} {unit}</span>
        </div>

        {/* Percentage indicator for assisted */}
        {modification === 'assisted' && (
          <div className="flex items-center justify-between text-caption">
            <span className="text-ink-3">% of Bodyweight:</span>
            <span className="text-ink-2">{percentBw}%</span>
          </div>
        )}
      </div>

      {/* Band disclaimer */}
      {modification === 'assisted' && data.assistanceType === 'band' && (
        <div className="mt-2 text-caption text-status-warn/70 italic">
          Band assistance varies through movement
        </div>
      )}
    </div>
  );
});

/**
 * Compact inline display for set history tables
 */
export const BodyweightDisplayInline = memo(function BodyweightDisplayInline({
  data,
  unit = 'kg',
  showTotal = false,
  className = '',
}: {
  data: BodyweightData;
  unit?: WeightUnit;
  showTotal?: boolean;
  className?: string;
}) {
  const { userBodyweightKg, modification, addedWeightKg, assistanceWeightKg, effectiveLoadKg } = data;
  // Use convertWeightForDisplay to preserve exact values (not rounded to plate increments)
  const displayWeight = (kg: number) => convertWeightForDisplay(kg, unit);

  let content: React.ReactNode;

  switch (modification) {
    case 'none':
      content = (
        <>
          <span className="text-ink-2">BW</span>
          {showTotal && (
            <span className="text-ink-3"> ({displayWeight(userBodyweightKg)})</span>
          )}
        </>
      );
      break;

    case 'weighted':
      content = (
        <>
          <span className="text-ink-2">BW</span>
          <span className="text-status-ok">+{displayWeight(addedWeightKg || 0)}</span>
          {showTotal && (
            <span className="text-ink-3"> = {displayWeight(effectiveLoadKg)}</span>
          )}
        </>
      );
      break;

    case 'assisted':
      content = (
        <>
          <span className="text-ink-2">BW</span>
          <span className="text-action">-{displayWeight(assistanceWeightKg || 0)}</span>
          {data.assistanceType === 'band' && <span className="text-ink-3">~</span>}
          {showTotal && (
            <span className="text-ink-3"> = {displayWeight(effectiveLoadKg)}</span>
          )}
        </>
      );
      break;
  }

  return <span className={`font-mono ${className}`}>{content}</span>;
});

/**
 * PR Badge display for bodyweight exercises
 */
export const BodyweightPRBadge = memo(function BodyweightPRBadge({
  prType,
  value,
  unit = 'kg',
}: {
  prType: 'weighted' | 'assisted' | 'pure_reps';
  value: number;
  unit?: WeightUnit;
}) {
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);

  let content: React.ReactNode;
  let bgColor: string;

  switch (prType) {
    case 'weighted':
      content = (
        <>
          <span className="mr-1">+{displayWeight(value)}</span>
          <span className="text-caption opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-status-ok-tint text-status-ok border-status-ok/40';
      break;

    case 'assisted':
      content = (
        <>
          <span className="mr-1">-{displayWeight(value)}</span>
          <span className="text-caption opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-action-tint text-action border-action/40';
      break;

    case 'pure_reps':
      content = (
        <>
          <span className="mr-1">{value} reps</span>
          <span className="text-caption opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-action/20 text-action border-action/40';
      break;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-caption font-medium ${bgColor}`}>
      {content}
    </span>
  );
});
