'use client';

import { cn } from '@/lib/utils';

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  /** Tailwind stroke class (default: accent). Use stroke-status-ok etc. for trend colour. */
  colorClassName?: string;
  className?: string;
}

/**
 * Tiny trend line for list rows (design system). Decorative: pair it with a
 * text value, it has no accessible name of its own.
 */
export function Sparkline({ values, width = 56, height = 24, colorClassName = 'stroke-action', className }: SparklineProps) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <span className={className} style={{ width, height, display: 'inline-block' }} aria-hidden="true" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const pad = 2;
  const points = pts
    .map((v, i) => {
      const x = pad + (i / (pts.length - 1)) * (width - pad * 2);
      const y = pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('flex-shrink-0', className)} aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={colorClassName} />
    </svg>
  );
}
