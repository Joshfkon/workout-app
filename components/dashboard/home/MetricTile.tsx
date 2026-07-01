'use client';

import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

interface MetricTileProps {
  icon: Icon;
  label: string;
  children: ReactNode;
}

/** Shared shell for the 2x2 dashboard glance tiles: bordered card + icon label row. */
export function MetricTile({ icon: TileIcon, label, children }: MetricTileProps) {
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs text-surface-500 mb-1"><TileIcon size={14} aria-hidden="true" /> {label}</div>
      {children}
    </div>
  );
}
