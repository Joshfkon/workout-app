'use client';

/**
 * Building blocks for the Learn / Science / About content pages so every
 * article reads the same: large-title header, one card style, the single
 * accent, the type scale, and plain-words notes next to jargon.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Icon as TablerIcon } from '@tabler/icons-react';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

/**
 * One-line plain-words explanations for the acronyms the content pages use.
 * Keep each to a single short sentence a newcomer can read in one go.
 */
export const PLAIN_TERMS = {
  MEV: 'the fewest hard sets per week that still make a muscle grow.',
  MAV: 'the range of weekly sets where most people grow best.',
  MRV: 'the most weekly sets you can do and still recover.',
  RIR: 'how many more reps you could have done before failing.',
  RPE: 'how hard a set felt, out of 10 (10 means you could not do another rep).',
  e1RM: 'the most you could lift once, estimated from a set of several reps.',
  TDEE: 'the calories you burn in a day, all activity included.',
} as const;

export type PlainTerm = keyof typeof PLAIN_TERMS;

/** Accent icon in a tinted rounded square (the list-row icon style). */
export function IconBadge({ icon: Icon, size = 'md', className }: { icon: TablerIcon; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-xl', lg: 'h-12 w-12 rounded-xl' }[size];
  const px = { sm: 18, md: 22, lg: 26 }[size];
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-action-tint text-action', box, className)} aria-hidden="true">
      <Icon size={px} stroke={2} />
    </span>
  );
}

/** Back link shown above an article header. */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="-ml-1 inline-flex items-center gap-1 text-body text-action">
      <IconChevronLeft size={20} aria-hidden="true" />
      {label}
    </Link>
  );
}

export interface ArticleHeaderProps {
  icon?: TablerIcon;
  /** Small category label, e.g. "Training science". */
  tag?: string;
  title: string;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
}

/** Large-title article header with an optional back link. */
export function ArticleHeader({ icon, tag, title, subtitle, backHref = '/dashboard/learn', backLabel = 'Learn' }: ArticleHeaderProps) {
  return (
    <header className="space-y-3">
      {backHref && <BackLink href={backHref} label={backLabel} />}
      {(icon || tag) && (
        <div className="flex items-center gap-3">
          {icon && <IconBadge icon={icon} />}
          {tag && <span className="text-subhead font-medium text-action">{tag}</span>}
        </div>
      )}
      <h1 className="text-large-title text-ink">{title}</h1>
      {subtitle && <p className="text-body text-ink-2">{subtitle}</p>}
    </header>
  );
}

/** A titled article section. */
export function ArticleSection({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      {title && <h2 className="text-title text-ink">{title}</h2>}
      {children}
    </section>
  );
}

/** The one card style. */
export function ContentCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-card bg-card p-4 shadow-card', className)}>{children}</div>;
}

/** A highlighted key idea: accent tint, no border. */
export function Callout({ icon, title, children, className }: { icon?: TablerIcon; title?: ReactNode; children: ReactNode; className?: string }) {
  const Icon = icon;
  return (
    <div className={cn('flex gap-3 rounded-card bg-action-tint p-4', className)}>
      {Icon && <Icon size={20} stroke={2} className="mt-0.5 shrink-0 text-action" aria-hidden="true" />}
      <div className="min-w-0 space-y-1 text-body text-ink">
        {title && <p className="text-headline text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** A bulleted list with accent dots. */
export function BulletList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('space-y-2 text-body text-ink-2', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-action" aria-hidden="true" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Plain-words note for an acronym, e.g. "MRV (maximum recoverable volume):
 * the most weekly sets you can do and still recover."
 */
export function TermNote({ term, fullName, children, className }: { term: PlainTerm | string; fullName?: string; children?: ReactNode; className?: string }) {
  const text = children ?? (term in PLAIN_TERMS ? PLAIN_TERMS[term as PlainTerm] : null);
  return (
    <p className={cn('text-subhead text-ink-2', className)}>
      <span className="font-semibold text-ink">{term}</span>
      {fullName && <> ({fullName})</>}
      {text && <>: {text}</>}
    </p>
  );
}

/** Closing call to action. */
export function ArticleCTA({ title, body, href, label }: { title: string; body?: ReactNode; href: string; label: string }) {
  return (
    <ContentCard className="space-y-3 text-center">
      <h2 className="text-headline text-ink">{title}</h2>
      {body && <p className="text-body text-ink-2">{body}</p>}
      <Link
        href={href}
        className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-button bg-action px-5 text-body font-semibold text-on-action"
      >
        {label}
        <IconChevronRight size={18} aria-hidden="true" />
      </Link>
    </ContentCard>
  );
}

/** Page column used by every content page. */
export function ArticlePage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto max-w-3xl space-y-8 pb-12', className)}>{children}</div>;
}
