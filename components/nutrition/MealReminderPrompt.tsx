'use client';

/**
 * One-tap "remind me to log meals" card on Eat, shown in the iPhone app until
 * reminders are on or the card is dismissed.
 */

import { useEffect, useState } from 'react';
import { IconBell, IconX } from '@tabler/icons-react';
import { createUntypedClient } from '@/lib/supabase/client';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';
import { readMealReminderSettings } from '@/services/mealReminders';

const DISMISS_KEY = 'ht-meal-reminder-prompt-dismissed';

export function MealReminderPrompt() {
  const [visible, setVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isNativePlatform()) return;
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // ignore
    }
    let cancelled = false;
    (async () => {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('users').select('preferences').eq('id', user.id).maybeSingle();
      if (!cancelled && !readMealReminderSettings(data?.preferences).enabled) setVisible(true);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
  };

  const turnOn = async () => {
    setIsSaving(true);
    try {
      const supabase = createUntypedClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('users').select('preferences').eq('id', user.id).maybeSingle();
      const current = readMealReminderSettings(data?.preferences);
      const { saveMealReminderSettings } = await import('@/lib/nutrition/mealReminderSync');
      const scheduled = await saveMealReminderSettings({ ...current, enabled: true });
      if (scheduled) setVisible(false);
      else setNotice('Notifications are off for HyperTrack. Turn them on in iPhone Settings → HyperTrack.');
    } catch {
      setNotice("Couldn't turn reminders on. Try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl border border-primary-500/20 bg-primary-500/10 p-3" data-testid="meal-reminder-prompt">
      <IconBell size={18} className="mt-0.5 shrink-0 text-primary-400" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-100">Remind me to log meals</p>
        <p className="text-xs text-surface-400 mt-0.5">
          A nudge at breakfast, lunch and dinner — only if you haven&apos;t logged that meal. Times can be changed in Settings.
        </p>
        {notice && <p className="text-xs text-warning-400 mt-1">{notice}</p>}
        <button
          type="button"
          onClick={() => void turnOn()}
          disabled={isSaving}
          className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary-500 hover:bg-primary-400 disabled:opacity-60"
        >
          {isSaving ? 'Turning on…' : 'Turn on'}
        </button>
      </div>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="text-surface-500 hover:text-surface-300">
        <IconX size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
