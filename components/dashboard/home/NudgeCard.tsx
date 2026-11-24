'use client';

import type { ReactNode } from 'react';
import { IconAlertTriangle, IconBulb, IconCircleCheck } from '@tabler/icons-react';
import { cn } from '@/lib/utils';

export type NudgeTone = 'info' | 'warn' | 'ok';

export interface NudgeCardProps {
  title: ReactNode;
  body?: ReactNode;
  tone?: NudgeTone;
  /** Compact action on the right (e.g. "Check in", "See"). */
  action?: ReactNode;
  /** Extra content under the text (e.g. a reasons list and two buttons). */
  children?: ReactNode;
}

const TONES: Record<NudgeTone, { badge: string; icon: ReactNode }> = {
  info: { badge: 'bg-action-tint text-action', icon: <IconBulb size={18} /> },
  warn: { badge: 'bg-status-warn-tint text-status-warn', icon: <IconAlertTriangle size={18} /> },
  ok: { badge: 'bg-status-ok-tint text-status-ok', icon: <IconCircleCheck size={18} /> },
};

/**
 * The single nudge Home shows at a time (design system "one thing per
 * card"): an icon badge, one bold line, one quiet line and at most one small
 * action. Home picks which nudge wins; see pickHomeNudge.
 */
export function NudgeCard({ title, body, tone = 'info', action, children }: NudgeCardProps) {
  const t = TONES[tone];
  return (
    <div className="rounded-card bg-card shadow-card px-4 py-3.5" data-testid="home-nudge">
      <div className="flex items-center gap-3">
        <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px]', t.badge)} aria-hidden="true">
          {t.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">{title}</p>
          {body && <p className="text-subhead text-ink-2">{body}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-3 pl-11">{children}</div>}
    </div>
  );
}

export type HomeNudgeKind = 'deload' | 'checkin' | 'tracking' | 'volume' | 'waist';

/**
 * Which nudge Home shows, in priority order: an actionable deload decision,
 * then today's check-in, then overdue body tracking (weigh-in, tape,
 * progress photos), then low weekly volume. The waist-pace check is
 * last — it decides for itself whether it has anything to say, so it only
 * gets the slot when nothing else wants it.
 */
export function pickHomeNudge(candidates: Partial<Record<HomeNudgeKind, boolean>>): HomeNudgeKind | null {
  const order: HomeNudgeKind[] = ['deload', 'checkin', 'tracking', 'volume', 'waist'];
  return order.find((k) => candidates[k]) ?? null;
}
