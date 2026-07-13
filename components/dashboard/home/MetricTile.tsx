'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Icon } from '@tabler/icons-react';

interface MetricTileProps {
  icon: Icon;
  label: string;
  /** When set, the tile becomes a tap-through link to the detail page. */
  href?: string;
  /** When set (and no href), the whole tile is a tap target — e.g. the Sleep
   *  tile opening its inline log sheet instead of navigating. */
  onClick?: () => void;
  /** Header-right action (e.g. the Weight tile's "+ log" button). With href,
   *  clicks on the action are kept from triggering the tile navigation. */
  action?: ReactNode;
  /** 'warning' draws attention with an amber border (e.g. volume below MEV). */
  accent?: 'warning';
  children: ReactNode;
}

/** Shared shell for the dashboard glance tiles: bordered card + icon label row. */
export function MetricTile({ icon: TileIcon, label, href, onClick, action, accent, children }: MetricTileProps) {
  const borderClass = accent === 'warning' ? 'border-warning-500/40' : 'border-surface-800';
  const inner = (
    <>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 text-xs text-surface-500">
          <TileIcon size={14} aria-hidden="true" /> {label}
        </div>
        {action && href ? (
          // Keep the action tappable inside the link without navigating.
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            {action}
          </span>
        ) : (
          action
        )}
      </div>
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`block bg-surface-900 border ${borderClass} rounded-xl p-3 hover:bg-surface-800/50 transition-colors`}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`block w-full text-left bg-surface-900 border ${borderClass} rounded-xl p-3 hover:bg-surface-800/50 transition-colors`}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`bg-surface-900 border ${borderClass} rounded-xl p-3`}>
      {inner}
    </div>
  );
}
