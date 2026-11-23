'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { readSectionHidden, writeSectionHidden, type ProgressSectionId } from './sectionCollapse';

/**
 * A secondary Progress section the viewer can hide (UX panel: "let users
 * hide the Strength, photos and phases sections"). The header stays, so a
 * hidden section is one tap from coming back; the choice is remembered per
 * viewer (sectionCollapse). Shown by default, and on the server render —
 * the stored choice is applied after mount so hydration matches.
 */
export function CollapsibleSection({
  id,
  title,
  children,
  className,
}: {
  id: ProgressSectionId;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const bodyId = useId();

  useEffect(() => {
    setHidden(readSectionHidden(id));
  }, [id]);

  const toggle = () => {
    const next = !hidden;
    writeSectionHidden(id, next);
    setHidden(next);
  };

  return (
    <section className={className} data-testid={`progress-section-${id}`}>
      <div className="mx-1 mb-2 flex items-center justify-between gap-3">
        <h2 className="text-headline text-ink">{title}</h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!hidden}
          aria-controls={bodyId}
          aria-label={`${hidden ? 'Show' : 'Hide'} ${title.toLowerCase()}`}
          data-testid={`progress-section-${id}-toggle`}
          className="-mr-1 inline-flex min-h-[44px] items-center gap-1 px-1 text-subhead font-semibold text-action"
        >
          {hidden ? 'Show' : 'Hide'}
          <IconChevronDown size={16} aria-hidden="true" className={cn('transition-transform', !hidden && 'rotate-180')} />
        </button>
      </div>
      <div id={bodyId} hidden={hidden} className="space-y-6">
        {!hidden && children}
      </div>
    </section>
  );
}
