'use client';

import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface ListGroupProps {
  /** Optional heading shown above the card. */
  title?: ReactNode;
  /** Right side of the heading (e.g. "See all"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A card of rows with inset separators (design system "Card with list rows").
 * Separators are added between children automatically.
 */
export function ListGroup({ title, action, children, className }: ListGroupProps) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <section className={className}>
      {(title || action) && (
        <div className="mx-1 mb-2 flex items-baseline justify-between gap-3">
          {title && <h2 className="text-headline text-ink">{title}</h2>}
          {action && <div className="text-subhead text-ink-2">{action}</div>}
        </div>
      )}
      <div className="overflow-hidden rounded-card bg-card shadow-card">
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 && <div className="ml-4 h-px bg-sep" aria-hidden="true" />}
            {row}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Icon shown in a tinted rounded square on the left. */
  icon?: ReactNode;
  /** Value on the right (before the chevron). */
  value?: ReactNode;
  /** Navigates when set (shows a chevron). */
  href?: string;
  /** Click handler (shows a chevron unless `chevron={false}`). */
  onClick?: () => void;
  chevron?: boolean;
  /** Fully custom right-side content (replaces value + chevron). */
  trailing?: ReactNode;
  className?: string;
}

function Chevron() {
  return (
    <svg className="h-4 w-4 flex-shrink-0 text-ink-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/**
 * One row in a ListGroup: 52pt+ tall, title + optional subtitle, optional
 * icon badge, value and chevron. A chevron always means "opens more".
 */
export function ListRow({ title, subtitle, icon, value, href, onClick, chevron, trailing, className }: ListRowProps) {
  const interactive = Boolean(href || onClick);
  const showChevron = chevron ?? interactive;
  const body = (
    <>
      {icon && (
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] bg-action-tint text-action" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block text-body text-ink">{title}</span>
        {subtitle && <span className="block text-subhead text-ink-2">{subtitle}</span>}
      </span>
      {trailing ?? (
        <>
          {value !== undefined && <span className="flex-shrink-0 text-body text-ink-2 tabular-nums">{value}</span>}
          {showChevron && <Chevron />}
        </>
      )}
    </>
  );
  const classes = cn(
    'flex min-h-[52px] w-full items-center gap-3 px-4 text-left',
    interactive && 'transition-colors active:bg-fill focus:outline-none focus-visible:bg-fill',
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}
