'use client';

/**
 * Progress check-in reminders: how often weigh-in, tape measurements and
 * progress photos come due (Home nudge), plus opt-in iOS notifications for
 * those and for scheduled training days. Saved to users.preferences
 * (services/trackingReminders); the native app schedules them
 * (lib/reminders/trackingReminderSync).
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Toggle } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';
import { TRACKING_REMINDERS_QUERY_PREFIX } from '@/hooks/useTrackingReminders';
import {
  CADENCE_OPTIONS,
  readTrackingReminderSettings,
  type TrackingKind,
  type TrackingReminderSettings as Settings,
} from '@/services/trackingReminders';

const ITEMS: { kind: TrackingKind; label: string }[] = [
  { kind: 'weigh', label: 'Weigh-in' },
  { kind: 'measure', label: 'Measurements' },
  { kind: 'photo', label: 'Progress photos' },
];

export function cadenceLabel(days: number): string {
  if (days === 0) return 'Off';
  if (days === 1) return 'Daily';
  if (days === 7) return 'Weekly';
  if (days % 7 === 0) return `Every ${days / 7} weeks`;
  return `Every ${days} days`;
}

const selectClass =
  'rounded-lg bg-fill border border-sep px-3 py-1.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-action focus:border-transparent';

export function TrackingReminderSettings() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('users').select('preferences').eq('id', user.id).maybeSingle();
      if (!cancelled) setSettings(readTrackingReminderSettings(data?.preferences));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (next: Settings) => {
    setSettings(next);
    setIsSaving(true);
    setNotice(null);
    try {
      const { saveTrackingReminderSettings } = await import('@/lib/reminders/trackingReminderSync');
      const scheduled = await saveTrackingReminderSettings(next);
      void queryClient.invalidateQueries({ queryKey: [TRACKING_REMINDERS_QUERY_PREFIX] });
      if ((next.notify || next.workoutNotify) && isNativePlatform() && !scheduled) {
        setNotice('Notifications are off for HyperTrack. Turn them on in iPhone Settings → HyperTrack.');
      }
    } catch {
      setNotice("Couldn't save. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = !settings || isSaving;

  return (
    <div className="space-y-3" data-testid="tracking-reminder-settings">
      <div>
        <p className="text-body font-medium text-ink">Progress check-ins</p>
        <p className="text-caption text-ink-3">
          Home reminds you when one is due, so the trend has regular data points.
        </p>
      </div>

      <div className="space-y-2 pl-1">
        {ITEMS.map(({ kind, label }) => (
          <div key={kind} className="flex items-center justify-between">
            <label htmlFor={`tracking-cadence-${kind}`} className="text-body text-ink-2">
              {label}
            </label>
            <select
              id={`tracking-cadence-${kind}`}
              value={settings?.cadenceDays[kind] ?? ''}
              disabled={disabled}
              onChange={(e) =>
                settings &&
                void persist({
                  ...settings,
                  cadenceDays: { ...settings.cadenceDays, [kind]: Number(e.target.value) },
                })
              }
              className={selectClass}
            >
              {CADENCE_OPTIONS[kind].map((days) => (
                <option key={days} value={days}>
                  {cadenceLabel(days)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="pr-4">
          <p className="text-body font-medium text-ink">Notify me when one is due</p>
          <p className="text-caption text-ink-3">Once on the day, then weekly until it&apos;s logged.</p>
        </div>
        <Toggle
          checked={!!settings?.notify}
          onChange={(notify) => settings && void persist({ ...settings, notify })}
          disabled={disabled}
        />
      </div>
      {settings?.notify && (
        <div className="flex items-center justify-between pl-1">
          <label htmlFor="tracking-notify-time" className="text-body text-ink-2">
            Time
          </label>
          <input
            id="tracking-notify-time"
            type="time"
            value={settings.notifyTime}
            onChange={(e) => e.target.value && void persist({ ...settings, notifyTime: e.target.value })}
            className={selectClass}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="pr-4">
          <p className="text-body font-medium text-ink">Training day reminders</p>
          <p className="text-caption text-ink-3">
            On the days your block schedules a workout. Skipped once you&apos;ve trained.
          </p>
        </div>
        <Toggle
          checked={!!settings?.workoutNotify}
          onChange={(workoutNotify) => settings && void persist({ ...settings, workoutNotify })}
          disabled={disabled}
        />
      </div>
      {settings?.workoutNotify && (
        <div className="flex items-center justify-between pl-1">
          <label htmlFor="tracking-workout-time" className="text-body text-ink-2">
            Time
          </label>
          <input
            id="tracking-workout-time"
            type="time"
            value={settings.workoutTime}
            onChange={(e) => e.target.value && void persist({ ...settings, workoutTime: e.target.value })}
            className={selectClass}
          />
        </div>
      )}

      {notice && <p className="text-caption text-status-warn">{notice}</p>}
      {(settings?.notify || settings?.workoutNotify) && !isNativePlatform() && (
        <p className="text-caption text-ink-3">Notifications are delivered in the HyperTrack iPhone app.</p>
      )}
    </div>
  );
}
