'use client';

import { memo } from 'react';
import type { BodyweightData, WeightUnit } from '@/types/schema';
import { calculatePercentBodyweight } from '@/types/schema';
import { formatWeightValue } from '@/lib/utils';

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

  const displayWeight = (kg: number) => formatWeightValue(kg, unit);
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
          <span className="text-surface-200">
            BW <span className="text-surface-400">({bw})</span>
          </span>
        );
        break;
      case 'weighted':
        display = (
          <span>
            <span className="text-surface-200">BW</span>
            <span className="text-green-400">+{displayWeight(addedWeightKg || 0)}</span>
          </span>
        );
        break;
      case 'assisted':
        display = (
          <span>
            <span className="text-surface-200">BW</span>
            <span className="text-blue-400">-{displayWeight(assistanceWeightKg || 0)}</span>
            {data.assistanceType === 'band' && (
              <span className="text-surface-500 text-xs ml-0.5">~</span>
            )}
          </span>
        );
        break;
    }

    return <span className={`font-mono text-sm ${className}`}>{display}</span>;
  }

  // Full mode - detailed breakdown
  return (
    <div className={`bg-surface-800 rounded-lg p-3 ${className}`}>
      <div className="space-y-2 text-sm">
        {/* Bodyweight row */}
        <div className="flex justify-between items-center">
          <span className="text-surface-400">BW:</span>
          <span className="text-surface-200 font-mono">{bw} {unit}</span>
        </div>

        {/* Added weight row */}
        {modification === 'weighted' && addedWeightKg && (
          <div className="flex justify-between items-center text-green-400">
            <span>Added:</span>
            <span className="font-mono">+ {displayWeight(addedWeightKg)} {unit}</span>
          </div>
        )}

        {/* Assistance row */}
        {modification === 'assisted' && assistanceWeightKg && (
          <div className="flex justify-between items-center text-blue-400">
            <span>
              Assistance
              {data.assistanceType === 'band' && data.bandColor && (
                <span className="text-surface-500 ml-1">
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
        <div className="border-t border-surface-700"></div>

        {/* Total/Effective row */}
        <div className="flex justify-between items-center font-semibold">
          <span className="text-surface-300">
            {modification === 'assisted' ? 'Effective:' : 'Total:'}
          </span>
          <span className="text-primary-400 font-mono">{effective} {unit}</span>
        </div>

        {/* Percentage indicator for assisted */}
        {modification === 'assisted' && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-surface-500">% of Bodyweight:</span>
            <span className="text-surface-400">{percentBw}%</span>
          </div>
        )}
      </div>

      {/* Band disclaimer */}
      {modification === 'assisted' && data.assistanceType === 'band' && (
        <div className="mt-2 text-xs text-amber-400/70 italic">
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
  const displayWeight = (kg: number) => formatWeightValue(kg, unit);

  let content: React.ReactNode;

  switch (modification) {
    case 'none':
      content = (
        <>
          <span className="text-surface-300">BW</span>
          {showTotal && (
            <span className="text-surface-500"> ({displayWeight(userBodyweightKg)})</span>
          )}
        </>
      );
      break;

    case 'weighted':
      content = (
        <>
          <span className="text-surface-300">BW</span>
          <span className="text-green-400">+{displayWeight(addedWeightKg || 0)}</span>
          {showTotal && (
            <span className="text-surface-500"> = {displayWeight(effectiveLoadKg)}</span>
          )}
        </>
      );
      break;

    case 'assisted':
      content = (
        <>
          <span className="text-surface-300">BW</span>
          <span className="text-blue-400">-{displayWeight(assistanceWeightKg || 0)}</span>
          {data.assistanceType === 'band' && <span className="text-surface-500">~</span>}
          {showTotal && (
            <span className="text-surface-500"> = {displayWeight(effectiveLoadKg)}</span>
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
          <span className="text-xs opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-green-500/20 text-green-400 border-green-500/40';
      break;

    case 'assisted':
      content = (
        <>
          <span className="mr-1">-{displayWeight(value)}</span>
          <span className="text-xs opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      break;

    case 'pure_reps':
      content = (
        <>
          <span className="mr-1">{value} reps</span>
          <span className="text-xs opacity-75">PR</span>
        </>
      );
      bgColor = 'bg-primary-500/20 text-primary-400 border-primary-500/40';
      break;
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${bgColor}`}>
      {content}
    </span>
  );
});
