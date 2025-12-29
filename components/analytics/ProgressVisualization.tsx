'use client';

import { useMemo } from 'react';

// ============================================================
// PROGRESS BAR COMPONENT
// ============================================================

interface ProgressBarProps {
  /** Current value (0-100) */
  value: number;
  /** Optional maximum value (default 100) */
  max?: number;
  /** Label to show on the left */
  label?: string;
  /** Value to show on the right */
  valueLabel?: string;
  /** Color variant */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show percentage text */
  showPercentage?: boolean;
  /** Show target marker */
  targetValue?: number;
  /** Target label */
  targetLabel?: string;
  /** Gradient colors [from, to] */
  gradient?: [string, string];
}

export function ProgressBar({
  value,
  max = 100,
  label,
  valueLabel,
  variant = 'default',
  size = 'md',
  showPercentage = false,
  targetValue,
  targetLabel,
  gradient,
}: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const targetPercentage = targetValue ? Math.min(100, Math.max(0, (targetValue / max) * 100)) : undefined;

  const sizeClasses = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const colorClasses = {
    default: 'bg-surface-500',
    success: 'bg-success-500',
    warning: 'bg-warning-500',
    danger: 'bg-danger-500',
    primary: 'bg-primary-500',
  };

  const gradientStyle = gradient
    ? { background: `linear-gradient(90deg, ${gradient[0]} 0%, ${gradient[1]} 100%)` }
    : undefined;

  return (
    <div className="w-full">
      {(label || valueLabel) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-xs text-surface-400">{label}</span>}
          {valueLabel && <span className="text-xs font-medium text-surface-200">{valueLabel}</span>}
        </div>
      )}
      <div className={`relative w-full bg-surface-800 rounded-full overflow-hidden ${sizeClasses[size]}`}>
        <div
          className={`${sizeClasses[size]} rounded-full transition-all duration-500 ease-out ${
            gradient ? '' : colorClasses[variant]
          }`}
          style={{
            width: `${percentage}%`,
            ...gradientStyle,
          }}
        />
        {targetPercentage !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/70"
            style={{ left: `${targetPercentage}%` }}
            title={targetLabel || `Target: ${targetValue}`}
          />
        )}
      </div>
      {showPercentage && (
        <div className="mt-1 text-right">
          <span className="text-[10px] text-surface-500">{Math.round(percentage)}%</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// RATIO PROGRESS BAR (shows current vs target)
// ============================================================

interface RatioProgressBarProps {
  /** Current ratio value */
  current: number;
  /** Target/ideal value */
  target: number;
  /** Acceptable range [min, max] */
  range: [number, number];
  /** Label for the ratio */
  label: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

export function RatioProgressBar({
  current,
  target,
  range,
  label,
  size = 'md',
}: RatioProgressBarProps) {
  // Calculate the visual range (extend slightly beyond the acceptable range)
  const visualMin = Math.min(range[0] * 0.85, current * 0.9);
  const visualMax = Math.max(range[1] * 1.15, current * 1.1);
  const visualRange = visualMax - visualMin;

  // Calculate positions as percentages
  const currentPos = ((current - visualMin) / visualRange) * 100;
  const targetPos = ((target - visualMin) / visualRange) * 100;
  const rangeStart = ((range[0] - visualMin) / visualRange) * 100;
  const rangeEnd = ((range[1] - visualMin) / visualRange) * 100;

  // Determine if current is in optimal range
  const isOptimal = current >= range[0] && current <= range[1];
  const isBelowOptimal = current < range[0];

  const sizeClasses = size === 'sm' ? 'h-2' : 'h-3';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-surface-400">{label}</span>
        <div className="flex items-center gap-2 text-xs">
          <span className={`font-medium ${isOptimal ? 'text-success-400' : isBelowOptimal ? 'text-warning-400' : 'text-surface-200'}`}>
            {current.toFixed(2)}
          </span>
          <span className="text-surface-600">→</span>
          <span className="text-surface-400">{target.toFixed(2)}</span>
        </div>
      </div>
      <div className={`relative w-full bg-surface-800 rounded-full overflow-hidden ${sizeClasses}`}>
        {/* Optimal range indicator */}
        <div
          className="absolute top-0 bottom-0 bg-success-500/20"
          style={{
            left: `${rangeStart}%`,
            width: `${rangeEnd - rangeStart}%`,
          }}
        />
        {/* Current value bar */}
        <div
          className={`absolute top-0 bottom-0 rounded-full ${
            isOptimal ? 'bg-success-500' : isBelowOptimal ? 'bg-warning-500' : 'bg-primary-500'
          }`}
          style={{
            left: 0,
            width: `${Math.max(2, currentPos)}%`,
          }}
        />
        {/* Target marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-surface-300"
          style={{ left: `${targetPos}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================
// BENCHMARK COMPARISON BAR
// ============================================================

interface BenchmarkBarProps {
  /** Current value in display unit */
  current: number;
  /** Benchmark tiers (in display unit) */
  benchmarks: {
    attainable: { min: number; max: number };
    elite: { min: number; max: number };
    superhero: { min: number; max: number };
  };
  /** Current tier achieved */
  currentTier: 'below_attainable' | 'attainable_natural' | 'elite_natural' | 'superhero';
  /** Measurement name */
  label: string;
  /** Display unit */
  unit: 'in' | 'cm';
  /** Whether lower is better (for waist) */
  isInverted?: boolean;
}

export function BenchmarkBar({
  current,
  benchmarks,
  currentTier,
  label,
  unit,
  isInverted = false,
}: BenchmarkBarProps) {
  // Calculate visual range
  const allValues = [
    benchmarks.attainable.min, benchmarks.attainable.max,
    benchmarks.elite.min, benchmarks.elite.max,
    benchmarks.superhero.min, benchmarks.superhero.max,
    current,
  ];
  const visualMin = Math.min(...allValues) * (isInverted ? 0.95 : 0.85);
  const visualMax = Math.max(...allValues) * (isInverted ? 1.05 : 1.15);
  const visualRange = visualMax - visualMin;

  const toPercent = (val: number) => ((val - visualMin) / visualRange) * 100;

  const tierColors = {
    below_attainable: 'bg-surface-500',
    attainable_natural: 'bg-warning-500',
    elite_natural: 'bg-primary-500',
    superhero: 'bg-success-500',
  };

  const tierLabels = {
    below_attainable: 'Building',
    attainable_natural: 'Attainable',
    elite_natural: 'Elite',
    superhero: 'Superhero',
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-surface-300">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${tierColors[currentTier].replace('bg-', 'text-').replace('-500', '-400')}`}>
            {current.toFixed(1)} {unit}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierColors[currentTier]} text-white`}>
            {tierLabels[currentTier]}
          </span>
        </div>
      </div>
      <div className="relative w-full h-6 bg-surface-900 rounded overflow-hidden">
        {/* Tier zones */}
        <div
          className="absolute top-0 bottom-0 bg-warning-500/20 border-r border-warning-500/40"
          style={{
            left: `${toPercent(isInverted ? benchmarks.attainable.max : benchmarks.attainable.min)}%`,
            width: `${Math.abs(toPercent(benchmarks.attainable.max) - toPercent(benchmarks.attainable.min))}%`,
          }}
        />
        <div
          className="absolute top-0 bottom-0 bg-primary-500/20 border-r border-primary-500/40"
          style={{
            left: `${toPercent(isInverted ? benchmarks.elite.max : benchmarks.elite.min)}%`,
            width: `${Math.abs(toPercent(benchmarks.elite.max) - toPercent(benchmarks.elite.min))}%`,
          }}
        />
        <div
          className="absolute top-0 bottom-0 bg-success-500/20"
          style={{
            left: `${toPercent(isInverted ? benchmarks.superhero.max : benchmarks.superhero.min)}%`,
            width: `${Math.abs(toPercent(benchmarks.superhero.max) - toPercent(benchmarks.superhero.min))}%`,
          }}
        />
        {/* Tier labels */}
        <div className="absolute inset-0 flex items-center justify-between px-1 text-[8px] text-surface-500">
          <span style={{ marginLeft: `${toPercent(benchmarks.attainable.min)}%` }}>
            {benchmarks.attainable.min.toFixed(1)}
          </span>
          <span style={{ marginRight: `${100 - toPercent(benchmarks.superhero.max)}%` }}>
            {benchmarks.superhero.max.toFixed(1)}
          </span>
        </div>
        {/* Current value marker */}
        <div
          className="absolute top-0 bottom-0 flex items-center justify-center"
          style={{ left: `${toPercent(current)}%`, transform: 'translateX(-50%)' }}
        >
          <div className={`w-1 h-full ${tierColors[currentTier]}`} />
          <div className="absolute -bottom-0.5 text-[10px] text-white font-bold">▲</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PROPORTIONS BENCHMARK BAR (for Classic Proportions)
// ============================================================

interface ProportionsBenchmarkBarProps {
  /** Current ratio value */
  current: number;
  /** Target/ideal value */
  target: number;
  /** Acceptable range [min, max] */
  range: [number, number];
  /** Measurement name */
  label: string;
  /** Status of the ratio */
  status: 'far_below' | 'below' | 'optimal' | 'above' | 'far_above';
}

export function ProportionsBenchmarkBar({
  current,
  target,
  range,
  label,
  status,
}: ProportionsBenchmarkBarProps) {
  // Calculate visual range (extend beyond the acceptable range)
  const visualMin = Math.min(range[0] * 0.8, current * 0.85);
  const visualMax = Math.max(range[1] * 1.2, current * 1.15);
  const visualRange = visualMax - visualMin;

  const toPercent = (val: number) => ((val - visualMin) / visualRange) * 100;

  // Zone colors based on status
  const statusConfig = {
    far_below: { color: 'bg-danger-500', textColor: 'text-danger-400', label: 'Needs Focus' },
    below: { color: 'bg-warning-500', textColor: 'text-warning-400', label: 'Below Target' },
    optimal: { color: 'bg-success-500', textColor: 'text-success-400', label: 'Optimal' },
    above: { color: 'bg-primary-500', textColor: 'text-primary-400', label: 'Above Target' },
    far_above: { color: 'bg-surface-500', textColor: 'text-surface-400', label: 'Well Developed' },
  };

  const config = statusConfig[status];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-surface-300">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${config.textColor}`}>
            {current.toFixed(2)}
          </span>
          <span className="text-[10px] text-surface-500">→ {target.toFixed(2)}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.color} text-white`}>
            {config.label}
          </span>
        </div>
      </div>
      <div className="relative w-full h-6 bg-surface-900 rounded overflow-hidden">
        {/* Below target zone (left of range) */}
        <div
          className="absolute top-0 bottom-0 bg-warning-500/20 border-r border-warning-500/40"
          style={{
            left: '0%',
            width: `${toPercent(range[0])}%`,
          }}
        />
        {/* Optimal zone (within range) */}
        <div
          className="absolute top-0 bottom-0 bg-success-500/20 border-r border-success-500/40"
          style={{
            left: `${toPercent(range[0])}%`,
            width: `${toPercent(range[1]) - toPercent(range[0])}%`,
          }}
        />
        {/* Above target zone (right of range) */}
        <div
          className="absolute top-0 bottom-0 bg-primary-500/20"
          style={{
            left: `${toPercent(range[1])}%`,
            width: `${100 - toPercent(range[1])}%`,
          }}
        />
        {/* Range labels */}
        <div className="absolute inset-0 flex items-center text-[8px] text-surface-500 px-1">
          <span style={{ position: 'absolute', left: `${Math.max(2, toPercent(range[0]) - 4)}%` }}>
            {range[0].toFixed(2)}
          </span>
          <span style={{ position: 'absolute', left: `${Math.min(92, toPercent(range[1]))}%` }}>
            {range[1].toFixed(2)}
          </span>
        </div>
        {/* Target marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-surface-300/50"
          style={{ left: `${toPercent(target)}%` }}
        />
        {/* Current value marker */}
        <div
          className="absolute top-0 bottom-0 flex items-center justify-center"
          style={{ left: `${toPercent(current)}%`, transform: 'translateX(-50%)' }}
        >
          <div className={`w-1 h-full ${config.color}`} />
          <div className={`absolute -bottom-0.5 text-[10px] ${config.textColor} font-bold`}>▲</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PROGRESS RING COMPONENT
// ============================================================

interface ProgressRingProps {
  /** Progress value (0-100) */
  value: number;
  /** Size in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Color variant */
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'primary';
  /** Show percentage in center */
  showValue?: boolean;
  /** Custom label in center */
  label?: string;
  /** Custom gradient colors */
  gradient?: { start: string; end: string; id: string };
}

export function ProgressRing({
  value,
  size = 64,
  strokeWidth = 6,
  variant = 'primary',
  showValue = true,
  label,
  gradient,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(100, Math.max(0, value)) / 100) * circumference;

  const colorClasses = {
    default: 'stroke-surface-500',
    success: 'stroke-success-500',
    warning: 'stroke-warning-500',
    danger: 'stroke-danger-500',
    primary: 'stroke-primary-500',
  };

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {gradient && (
          <defs>
            <linearGradient id={gradient.id} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gradient.start} />
              <stop offset="100%" stopColor={gradient.end} />
            </linearGradient>
          </defs>
        )}
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-surface-800"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={gradient ? `url(#${gradient.id})` : undefined}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`transition-all duration-500 ease-out ${gradient ? '' : colorClasses[variant]}`}
        />
      </svg>
      {(showValue || label) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {showValue && (
            <span className="text-sm font-bold text-surface-200">
              {Math.round(value)}%
            </span>
          )}
          {label && (
            <span className="text-[10px] text-surface-500">{label}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// SCORE GAUGE COMPONENT
// ============================================================

interface ScoreGaugeProps {
  /** Score value (0-100) */
  score: number;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Label below score */
  label?: string;
  /** Show breakdown button */
  onShowBreakdown?: () => void;
}

export function ScoreGauge({
  score,
  size = 'md',
  label,
  onShowBreakdown,
}: ScoreGaugeProps) {
  const sizeConfig = {
    sm: { ringSize: 48, fontSize: 'text-sm', labelSize: 'text-[9px]' },
    md: { ringSize: 80, fontSize: 'text-xl', labelSize: 'text-xs' },
    lg: { ringSize: 120, fontSize: 'text-3xl', labelSize: 'text-sm' },
  };

  const config = sizeConfig[size];

  // Determine color based on score
  const variant = useMemo((): 'success' | 'warning' | 'danger' | 'primary' => {
    if (score >= 80) return 'success';
    if (score >= 60) return 'primary';
    if (score >= 40) return 'warning';
    return 'danger';
  }, [score]);

  return (
    <div className="flex flex-col items-center">
      <ProgressRing
        value={score}
        size={config.ringSize}
        strokeWidth={size === 'lg' ? 10 : size === 'md' ? 8 : 4}
        variant={variant}
        showValue={false}
      />
      <div className="absolute flex flex-col items-center justify-center" style={{ height: config.ringSize }}>
        <span className={`font-bold text-surface-200 ${config.fontSize}`}>
          {Math.round(score)}%
        </span>
      </div>
      {label && (
        <span className={`mt-1 text-surface-400 ${config.labelSize}`}>{label}</span>
      )}
      {onShowBreakdown && (
        <button
          onClick={onShowBreakdown}
          className="mt-1 text-[10px] text-primary-400 hover:text-primary-300"
        >
          View breakdown
        </button>
      )}
    </div>
  );
}
