'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ProgressRingProps {
  /** 0–1; values outside are clamped. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  /** Tailwind stroke class for the filled arc (default: accent). */
  colorClassName?: string;
  /** Centre content (e.g. "1,240" / "kcal left"). */
  children?: ReactNode;
  /** Accessible description, e.g. "1,210 of 2,450 kcal eaten". */
  label: string;
  className?: string;
}

/** Design system progress ring (Eat's calorie ring). */
export function ProgressRing({
  progress,
  size = 112,
  strokeWidth = 10,
  colorClassName = 'stroke-action',
  children,
  label,
  className,
}: ProgressRingProps) {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn('relative flex-shrink-0', className)} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-fill" />
        {p > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${p * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            className={cn('transition-[stroke-dasharray] duration-500', colorClassName)}
            data-testid="progress-ring-arc"
          />
        )}
      </svg>
      {children && <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  );
}
