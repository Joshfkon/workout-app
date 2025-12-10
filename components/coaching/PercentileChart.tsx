'use client';

import { generatePercentileSegments } from '@/services/coachingEngine';

interface PercentileChartProps {
  percentile: number;
  label: string;
  showValue?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function PercentileChart({ 
  percentile, 
  label, 
  showValue = true,
  size = 'md',
  className = ''
}: PercentileChartProps) {
  const segments = generatePercentileSegments(percentile);
  
  const heights = {
    sm: 'h-1.5',
    md: 'h-2',
    lg: 'h-3'
  };
  
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex justify-between text-xs text-surface-400">
        <span>{label}</span>
        {showValue && <span className="font-medium">{percentile}th</span>}
      </div>
      <div className="flex gap-0.5">
        {segments.map((seg, i) => (
          <div 
            key={i}
            className={`${heights[size]} flex-1 rounded-sm transition-colors`}
            style={{ backgroundColor: seg.color }}
          />
        ))}
      </div>
    </div>
  );
}

// Circular percentile display
interface CircularPercentileProps {
  percentile: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

export function CircularPercentile({
  percentile,
  size = 120,
  strokeWidth = 8,
  label,
  className = ''
}: CircularPercentileProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentile / 100) * circumference;
  
  // Color based on percentile
  const getColor = () => {
    if (percentile >= 75) return '#22c55e'; // Green
    if (percentile >= 50) return '#84cc16'; // Lime
    if (percentile >= 25) return '#f59e0b'; // Orange
    return '#ef4444'; // Red
  };
  
  return (
    <div className={`relative inline-flex ${className}`}>
      <svg width={size} height={size} className="-rotate-90">
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
          stroke={getColor()}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-white">{percentile}</span>
        {label && <span className="text-xs text-surface-500">{label}</span>}
      </div>
    </div>
  );
}

// Comparison bar showing where user falls in distribution
interface DistributionBarProps {
  percentile: number;
  showLabels?: boolean;
  className?: string;
}

export function DistributionBar({
  percentile,
  showLabels = true,
  className = ''
}: DistributionBarProps) {
  return (
    <div className={className}>
      <div className="relative h-6 bg-surface-800 rounded-full overflow-hidden">
        {/* Gradient background */}
        <div 
          className="absolute inset-0 bg-gradient-to-r from-danger-500 via-warning-500 via-50% to-success-500"
          style={{ opacity: 0.3 }}
        />
        
        {/* Marker */}
        <div 
          className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
          style={{ 
            left: `${percentile}%`,
            transform: 'translateX(-50%)'
          }}
        >
          {/* Tooltip */}
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-white text-surface-900 text-xs font-bold rounded whitespace-nowrap">
            {percentile}th
          </div>
        </div>
      </div>
      
      {showLabels && (
        <div className="flex justify-between text-xs text-surface-500 mt-1">
          <span>0th</span>
          <span>25th</span>
          <span>50th</span>
          <span>75th</span>
          <span>100th</span>
        </div>
      )}
    </div>
  );
}

