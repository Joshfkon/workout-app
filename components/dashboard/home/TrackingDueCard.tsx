'use client';

import { Button } from '@/components/ui';
import {
  trackingActionLabel,
  trackingItemDetail,
  trackingNudgeTitle,
  type TrackingKind,
  type TrackingStatus,
} from '@/services/trackingReminders';
import { NudgeCard } from './NudgeCard';

export interface TrackingDueCardProps {
  /** Due items (non-empty). */
  items: TrackingStatus[];
  onLog: (kind: TrackingKind) => void;
  /** "Not now": hides these items on this device for a week. */
  onSnooze: (kinds: TrackingKind[]) => void;
}

/**
 * Home nudge for overdue body tracking: weigh-in, tape measurements and
 * progress photos (services/trackingReminders decides what's due). One item
 * gets the compact action; several get a row each, still one card.
 */
export function TrackingDueCard({ items, onLog, onSnooze }: TrackingDueCardProps) {
  if (items.length === 0) return null;
  const single = items.length === 1 ? items[0] : null;
  const notNow = (
    <button
      type="button"
      onClick={() => onSnooze(items.map((i) => i.kind))}
      className="text-caption text-ink-2 hover:text-ink transition-colors"
    >
      Not now
    </button>
  );

  return (
    <div data-testid="tracking-due-card">
      <NudgeCard
        title={trackingNudgeTitle(items)}
        body={single ? trackingItemDetail(single) : 'Regular entries keep your trend readable'}
        action={
          single ? (
            <Button size="sm" variant="secondary" onClick={() => onLog(single.kind)}>
              {trackingActionLabel(single.kind)}
            </Button>
          ) : undefined
        }
      >
        {single ? (
          notNow
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.kind} className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-subhead text-ink-2">{trackingItemDetail(item)}</p>
                  <Button size="sm" variant="secondary" onClick={() => onLog(item.kind)}>
                    {trackingActionLabel(item.kind)}
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-2">{notNow}</div>
          </>
        )}
      </NudgeCard>
    </div>
  );
}
