'use client';

/**
 * Home's "tracking due" nudge: which of weigh-in / measurements / progress
 * photos are due (services/trackingReminders has the rules), minus the ones
 * snoozed on this device. Cached-first via React Query; the snapshot is
 * persisted so a warm start shows the same nudge immediately instead of
 * swapping it in after the fetch.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalDateString } from '@/lib/utils';
import { fetchTrackingSnapshot } from '@/lib/reminders/trackingSnapshot';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';
import {
  NUDGE_SNOOZE_DAYS,
  TRACKING_KINDS,
  addDays,
  computeTrackingStatus,
  dueTrackingItems,
  readTrackingReminderSettings,
  type TrackingKind,
  type TrackingStatus,
} from '@/services/trackingReminders';

export const TRACKING_REMINDERS_QUERY_PREFIX = 'tracking-reminders';

const SNOOZE_KEY = (kind: TrackingKind) => `home.trackingSnoozedUntil.${kind}`;

function readSnoozes(): Partial<Record<TrackingKind, string>> {
  const out: Partial<Record<TrackingKind, string>> = {};
  try {
    for (const kind of TRACKING_KINDS) {
      const value = localStorage.getItem(SNOOZE_KEY(kind));
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) out[kind] = value;
    }
  } catch {
    // Storage blocked: nothing snoozed.
  }
  return out;
}

export interface TrackingRemindersResult {
  /** Due items (null until both the snapshot and this device's snoozes are read). */
  due: TrackingStatus[] | null;
  snooze: (kinds: TrackingKind[]) => void;
}

export function useTrackingReminders(userId: string | null | undefined): TrackingRemindersResult {
  const query = useQuery({
    queryKey: [TRACKING_REMINDERS_QUERY_PREFIX, userId],
    enabled: !!userId,
    // Cheap reads; refetch on every Home visit so a weigh-in logged elsewhere
    // clears the nudge, while the persisted copy paints first.
    staleTime: 0,
    queryFn: () => fetchTrackingSnapshot(createUntypedClient(), userId as string),
  });

  // localStorage is read after mount only (no SSR/hydration mismatch).
  const [snoozes, setSnoozes] = useState<Partial<Record<TrackingKind, string>> | null>(null);
  useEffect(() => setSnoozes(readSnoozes()), []);

  const today = getLocalDateString();
  const due = useMemo(() => {
    if (!query.data || !snoozes) return null;
    const statuses = computeTrackingStatus({
      settings: readTrackingReminderSettings(query.data.preferences),
      lastLogged: query.data.lastLogged,
      accountCreated: query.data.accountCreated,
      today,
    });
    return dueTrackingItems(statuses, today, snoozes);
  }, [query.data, snoozes, today]);

  const snooze = useCallback(
    (kinds: TrackingKind[]) => {
      const until = addDays(today, NUDGE_SNOOZE_DAYS);
      setSnoozes((prev) => {
        const next = { ...(prev ?? {}) };
        for (const kind of kinds) {
          next[kind] = until;
          try {
            localStorage.setItem(SNOOZE_KEY(kind), until);
          } catch {
            // Storage blocked: snoozed for this visit only.
          }
        }
        return next;
      });
    },
    [today]
  );

  return { due, snooze };
}

/**
 * Call after logging (or deleting) a weigh-in, tape entry or photo: Home's
 * nudge refetches, and in the native app the scheduled notifications are
 * re-planned at once — otherwise a reminder for the thing just logged could
 * still fire before the next launch/foreground re-plan.
 */
export function useInvalidateTrackingReminders(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [TRACKING_REMINDERS_QUERY_PREFIX] });
    if (isNativePlatform()) {
      import('@/lib/reminders/trackingReminderSync')
        .then(({ syncTrackingReminders }) => syncTrackingReminders())
        .catch(() => {});
    }
  }, [queryClient]);
}
