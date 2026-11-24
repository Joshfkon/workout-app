'use client';

/**
 * The banners at the top of the workout screen, one at a time.
 *
 * UX panel round 21 (Dre): "Banners and warnings clutter the top of the
 * workout screen, so it's harder to see what matters." Offline, could-not-
 * sync, errors, "Still training?", readiness easing, recalculated targets and
 * coach notes each had their own block, and several could stack above the
 * first exercise. Now the most important one shows; the rest sit behind a
 * single "N more notes" disclosure. Safety notices (injury, pain) are never
 * collapsed: they always show, and are expected to be compact.
 */

import { useId, useState, type ReactNode } from 'react';
import { IconChevronDown } from '@tabler/icons-react';

export interface WorkoutNotice {
  /** Stable id (also the React key). */
  key: string;
  node: ReactNode;
  /** Injury / pain: never collapsed. */
  safety?: boolean;
}

/**
 * Which notices show and which collapse. `notices` is in priority order.
 * Safety notices always show; otherwise the first notice shows. When a
 * safety notice is up, every other notice collapses, so the top of the
 * screen never carries a safety warning AND another banner.
 */
export function splitNotices(notices: WorkoutNotice[]): {
  shown: WorkoutNotice[];
  collapsed: WorkoutNotice[];
} {
  const safety = notices.filter((n) => n.safety);
  const others = notices.filter((n) => !n.safety);
  if (safety.length > 0) return { shown: safety, collapsed: others };
  return { shown: others.slice(0, 1), collapsed: others.slice(1) };
}

export function moreNotesLabel(count: number): string {
  return `${count} more note${count === 1 ? '' : 's'}`;
}

export function WorkoutNoticeStack({ notices }: { notices: WorkoutNotice[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const { shown, collapsed } = splitNotices(notices);
  if (shown.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="workout-notices">
      {shown.map((n) => (
        <div key={n.key}>{n.node}</div>
      ))}
      {collapsed.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={listId}
            className="flex min-h-[44px] items-center gap-1.5 px-1 text-subhead font-medium text-action"
            data-testid="workout-notices-more"
          >
            <IconChevronDown
              size={16}
              className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            {expanded ? 'Hide notes' : moreNotesLabel(collapsed.length)}
          </button>
          {expanded && (
            <div id={listId} className="space-y-2">
              {collapsed.map((n) => (
                <div key={n.key}>{n.node}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
