'use client';

/**
 * Meal reminders: nudges to log breakfast, lunch and dinner — only for meals
 * not logged yet that day. Saved to users.preferences.mealReminders; the
 * native app schedules them (lib/nutrition/mealReminderSync).
 */

import { useEffect, useState } from 'react';
import { Toggle } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';
import {
  readMealReminderSettings,
  type MealReminderSettings as Settings,
  type ReminderMeal,
} from '@/services/mealReminders';

const MEALS: { meal: ReminderMeal; label: string }[] = [
  { meal: 'breakfast', label: 'Breakfast' },
  { meal: 'lunch', label: 'Lunch' },
  { meal: 'dinner', label: 'Dinner' },
];

export function MealReminderSettings() {
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
      if (!cancelled) setSettings(readMealReminderSettings(data?.preferences));
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
      const { saveMealReminderSettings } = await import('@/lib/nutrition/mealReminderSync');
      const scheduled = await saveMealReminderSettings(next);
      if (next.enabled && isNativePlatform() && !scheduled) {
        setNotice('Notifications are off for HyperTrack. Turn them on in iPhone Settings → HyperTrack.');
      }
    } catch {
      setNotice("Couldn't save. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="meal-reminder-settings">
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <p className="text-sm font-medium text-surface-200">Meal reminders</p>
          <p className="text-xs text-surface-500">
            A nudge for any meal you haven&apos;t logged yet. A rough estimate is better than nothing.
          </p>
        </div>
        <Toggle
          checked={!!settings?.enabled}
          onChange={(enabled) => settings && void persist({ ...settings, enabled })}
          disabled={!settings || isSaving}
        />
      </div>

      {settings?.enabled && (
        <div className="space-y-2 pl-1">
          {MEALS.map(({ meal, label }) => (
            <div key={meal} className="flex items-center justify-between">
              <label htmlFor={`meal-reminder-${meal}`} className="text-sm text-surface-300">
                {label}
              </label>
              <input
                id={`meal-reminder-${meal}`}
                type="time"
                value={settings.times[meal] ?? ''}
                onChange={(e) =>
                  void persist({ ...settings, times: { ...settings.times, [meal]: e.target.value } })
                }
                className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-sm text-surface-100 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          ))}
        </div>
      )}

      {notice && <p className="text-xs text-warning-400">{notice}</p>}
      {settings?.enabled && !isNativePlatform() && (
        <p className="text-xs text-surface-500">
          Reminders are delivered in the HyperTrack iPhone app.
        </p>
      )}
    </div>
  );
}
