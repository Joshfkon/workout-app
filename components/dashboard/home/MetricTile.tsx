'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

interface MetricTileProps {
  icon: Icon;
  label: string;
  /** When set, the tile becomes a tap-through link to the detail page. */
  href?: string;
  children: ReactNode;
}

/** Shared shell for the dashboard glance tiles: bordered card + icon label row. */
export function MetricTile({ icon: TileIcon, label, href, children }: MetricTileProps) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-surface-500 mb-1"><TileIcon size={14} aria-hidden="true" /> {label}</div>
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="block bg-surface-900 border border-surface-800 rounded-xl p-3 hover:bg-surface-800/50 transition-colors">
        {inner}
      </Link>
    );
  }

  return (
    <div className="bg-surface-900 border border-surface-800 rounded-xl p-3">
      {inner}
    </div>
  );
}
