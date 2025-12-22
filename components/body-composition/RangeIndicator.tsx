'use client';

import { cn } from '@/lib/utils';

/**
 * Visual component showing prediction range with prominent uncertainty
 *
 * Renders as:
 *
 * Body Fat %
 *    ├────────[####|####]────────┤
 *   17.2%      14.8%      12.9%
 *   worst     expected    best
 */
interface RangeIndicatorProps {
  label: string;
  pessimistic: number;
  expected: number;
  optimistic: number;
  unit: string;
  /** Show change from a baseline value */
  showChange?: {
    from: number;
    label: string;
  };
  /** Format numbers with fixed decimals */
  decimals?: number;
  /** Higher is better (e.g., for lean mass) vs lower is better (e.g., for body fat %) */
  higherIsBetter?: boolean;
  className?: string;
}

export function RangeIndicator({
  label,
  pessimistic,
  expected,
  optimistic,
  unit,
  showChange,
  decimals = 1,
  higherIsBetter = true,
  className,
}: RangeIndicatorProps) {
  // Calculate the range spread
  const min = Math.min(pessimistic, optimistic);
  const max = Math.max(pessimistic, optimistic);
  const range = max - min;

  // Position of expected value as percentage of range
  const expectedPosition = range > 0 ? ((expected - min) / range) * 100 : 50;

  // Format values
  const formatValue = (v: number) => v.toFixed(decimals);

  // Calculate changes from baseline
  const getChange = (value: number) => {
    if (!showChange) return null;
    const change = value - showChange.from;
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toFixed(decimals)}`;
  };

  // Determine if this value is good or bad
  const getChangeColor = (value: number) => {
    if (!showChange) return 'text-surface-500';
    const change = value - showChange.from;
    const isPositive = change > 0;
    const isGood = higherIsBetter ? isPositive : !isPositive;
    return isGood ? 'text-success-400' : 'text-danger-400';
  };

  return (
    <div className={cn('space-y-2', className)}>
      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-surface-200">{label}</span>
        <span className="text-xs text-surface-500">
          Expected: {formatValue(expected)} {unit}
        </span>
      </div>

      {/* Visual Bar */}
      <div className="relative h-6 flex items-center">
        {/* Track */}
        <div className="absolute inset-x-0 h-2 bg-surface-800 rounded-full" />

        {/* Range fill */}
        <div
          className="absolute h-2 bg-gradient-to-r from-warning-500/50 via-primary-500/50 to-success-500/50 rounded-full"
          style={{
            left: '0%',
            right: '0%',
          }}
        />

        {/* Expected value marker */}
        <div
          className="absolute w-4 h-4 bg-primary-500 rounded-full border-2 border-white shadow-lg z-10 transform -translate-x-1/2"
          style={{ left: `${expectedPosition}%` }}
        />

        {/* Pessimistic marker */}
        <div className="absolute w-0.5 h-4 bg-warning-500 rounded-full" style={{ left: '0%' }} />

        {/* Optimistic marker */}
        <div className="absolute w-0.5 h-4 bg-success-500 rounded-full" style={{ right: '0%' }} />
      </div>

      {/* Values */}
      <div className="flex justify-between text-xs">
        <div className="text-left">
          <div className="font-medium text-warning-400">
            {formatValue(pessimistic)} {unit}
          </div>
          {showChange && (
            <div className={getChangeColor(pessimistic)}>
              ({getChange(pessimistic)})
            </div>
          )}
          <div className="text-surface-500">worst</div>
        </div>

        <div className="text-center">
          <div className="font-medium text-primary-400">
            {formatValue(expected)} {unit}
          </div>
          {showChange && (
            <div className={getChangeColor(expected)}>
              ({getChange(expected)})
            </div>
          )}
          <div className="text-surface-500">expected</div>
        </div>

        <div className="text-right">
          <div className="font-medium text-success-400">
            {formatValue(optimistic)} {unit}
          </div>
          {showChange && (
            <div className={getChangeColor(optimistic)}>
              ({getChange(optimistic)})
            </div>
          )}
          <div className="text-surface-500">best</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact version of the range indicator for dashboard cards
 */
export function RangeIndicatorCompact({
  label,
  pessimistic,
  expected,
  optimistic,
  unit,
  decimals = 1,
  className,
}: Omit<RangeIndicatorProps, 'showChange' | 'higherIsBetter'>) {
  const formatValue = (v: number) => v.toFixed(decimals);

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-surface-400">{label}</span>
        <span className="text-surface-200 font-medium">
          {formatValue(expected)} {unit}
        </span>
      </div>
      <div className="flex items-center gap-1 text-xs">
        <span className="text-warning-400">{formatValue(pessimistic)}</span>
        <div className="flex-1 h-1 bg-gradient-to-r from-warning-500/40 via-primary-500/40 to-success-500/40 rounded-full" />
        <span className="text-success-400">{formatValue(optimistic)}</span>
      </div>
    </div>
  );
}

/**
 * Horizontal bar showing where a value falls in a range
 */
export function ValueOnRange({
  label,
  value,
  min,
  max,
  unit,
  showLabels = true,
  zones?: {
    poor: number;
    fair: number;
    good: number;
  };
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  showLabels?: boolean;
  zones?: {
    poor: number;
    fair: number;
    good: number;
  };
  className?: string;
}) {
  const range = max - min;
  const position = range > 0 ? ((value - min) / range) * 100 : 0;

  // Get zone color based on value
  const getZoneColor = () => {
    if (!zones) return 'bg-primary-500';
    if (value >= zones.good) return 'bg-success-500';
    if (value >= zones.fair) return 'bg-warning-500';
    if (value >= zones.poor) return 'bg-danger-500';
    return 'bg-danger-600';
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-surface-400">{label}</span>
        <span className="text-surface-200 font-medium">
          {value.toFixed(2)} {unit}
        </span>
      </div>

      <div className="relative h-2">
        {/* Track with gradient zones if provided */}
        <div className="absolute inset-0 bg-surface-800 rounded-full overflow-hidden">
          {zones && (
            <>
              <div className="absolute inset-y-0 left-0 bg-danger-500/30" style={{ width: '25%' }} />
              <div className="absolute inset-y-0 left-1/4 bg-warning-500/30" style={{ width: '25%' }} />
              <div className="absolute inset-y-0 left-1/2 bg-success-500/30" style={{ width: '50%' }} />
            </>
          )}
        </div>

        {/* Value marker */}
        <div
          className={cn(
            'absolute w-3 h-3 rounded-full border-2 border-white shadow-lg transform -translate-x-1/2 -translate-y-0.5',
            getZoneColor()
          )}
          style={{ left: `${Math.min(100, Math.max(0, position))}%` }}
        />
      </div>

      {showLabels && (
        <div className="flex justify-between text-xs text-surface-500">
          <span>{min.toFixed(2)}</span>
          <span>{max.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
