'use client';

import { cn } from '@/lib/utils';

export interface SectionLabelProps {
  /** Section label text */
  children: string;
  /** Optional className for customization */
  className?: string;
}

/**
 * Standardized section label with consistent typography.
 * Used for grouping related content within a page.
 */
export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <h2 className={cn(
      'text-sm font-semibold text-surface-200 uppercase tracking-wide',
      className
    )}>
      {children}
    </h2>
  );
}
