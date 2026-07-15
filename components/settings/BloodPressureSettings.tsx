'use client';

import { useCallback, useEffect, useState } from 'react';
import { Toggle } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useAuthUser } from '@/hooks/useAuthUser';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

/**
 * BloodPressureSettings — opt-in daily "log blood pressure" reminder toggle
 * for the Settings › Preferences tab. Persists to users.preferences JSONB with
 * a read-merge-write (so unrelated keys survive), mirroring BodyHubNudges. On
 * the native app it (re)schedules a repeating local notification; on web it's
 * a stored preference only (there is no web push infra), with a hint saying so.
 *
 * Reminders are OFF by default — never forced on.
 */

const DEFAULT_TIME = '08:00'; // morning — the suggested default

interface BPReminderPrefs {
  enabled: boolean;
  time: string;
}

function parseTime(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  return {
    hour: Number.isFinite(h) ? h : 8,
    minute: Number.isFinite(m) ? m : 0,
  };
}

export function BloodPressureSettings() {
  const { user: authUser } = useAuthUser();
  const [prefs, setPrefs] = useState<BPReminderPrefs>({
    enabled: false,
    time: DEFAULT_TIME,
  });
  const [loaded, setLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Load current preference.
  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    (async () => {
      try {
        const supabase = createUntypedClient();
        const { data } = await supabase
          .from('users')
          .select('preferences')
          .eq('id', authUser.id)
          .single();
        const p = (data?.preferences as Record<string, unknown>) ?? {};
        if (!cancelled) {
          setPrefs({
            enabled: (p.bloodPressureReminderEnabled as boolean) ?? false,
            time: (p.bloodPressureReminderTime as string) || DEFAULT_TIME,
          });
        }
      } catch {
        // Keep defaults on failure.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  // Persist (read-merge-write) + (re)schedule/cancel the native notification.
  const persist = useCallback(
    async (next: BPReminderPrefs) => {
      if (!authUser) return;
      setPrefs(next);
      setIsSaving(true);
      try {
        const supabase = createUntypedClient();
        const { data: current } = await supabase
          .from('users')
          .select('preferences')
          .eq('id', authUser.id)
          .single();
        const merged = {
          ...((current?.preferences as Record<string, unknown>) ?? {}),
          bloodPressureReminderEnabled: next.enabled,
          bloodPressureReminderTime: next.time,
        };
        await supabase
          .from('users')
          .update({ preferences: merged })
          .eq('id', authUser.id);

        // Sync the native local notification.
        const notifications = await import('@/lib/integrations/notifications');
        if (next.enabled) {
          const { hour, minute } = parseTime(next.time);
          await notifications.scheduleBloodPressureReminder(hour, minute);
        } else {
          await notifications.cancelBloodPressureReminder();
        }
      } catch (err) {
        console.warn('Failed to save BP reminder preference:', err);
      } finally {
        setIsSaving(false);
      }
    },
    [authUser]
  );

  const handleToggle = (enabled: boolean) => {
    persist({ ...prefs, enabled });
  };

  const handleTimeChange = (time: string) => {
    persist({ ...prefs, time: time || DEFAULT_TIME });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <p className="text-sm font-medium text-surface-200">
            Daily blood pressure reminder
          </p>
          <p className="text-xs text-surface-500">
            A gentle nudge to log a reading. Off by default.
          </p>
        </div>
        <Toggle
          checked={prefs.enabled}
          onChange={handleToggle}
          disabled={!loaded || isSaving}
        />
      </div>

      {prefs.enabled && (
        <div className="flex items-center justify-between pl-1">
          <label htmlFor="bp-reminder-time" className="text-sm text-surface-300">
            Reminder time
          </label>
          <input
            id="bp-reminder-time"
            type="time"
            value={prefs.time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      )}

      {prefs.enabled && !isNativePlatform() && (
        <p className="text-xs text-surface-500">
          Reminders are delivered in the HyperTrack mobile app. Your preference is
          saved and will apply there.
        </p>
      )}
    </div>
  );
}
