'use client';

/**
 * Eating-window preference card (Settings → Preferences). The window drives
 * the intake pacing verdicts on the Home Nutrition tile and the Log page's
 * Today So Far grid: "expected by now" = daily target × elapsed fraction of
 * this window. Self-contained (loads and saves itself), like the other
 * settings cards.
 */

import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { getLocalUserId } from '@/lib/supabase/authState';
import {
  fetchEatingWindow,
  saveEatingWindow,
  minutesToTimeValue,
  timeValueToMinutes,
} from '@/lib/nutrition/eatingWindow';
import { DEFAULT_EATING_WINDOW } from '@/services/intakePacing';

const inputClass =
  'w-full px-3 py-2 rounded-lg bg-surface-800 border border-surface-700 text-surface-100 text-sm focus:outline-none focus:border-primary-500';

export function EatingWindowSettings() {
  const supabase = createUntypedClient();
  const [startValue, setStartValue] = useState(
    minutesToTimeValue(DEFAULT_EATING_WINDOW.startMinutes)
  );
  const [endValue, setEndValue] = useState(minutesToTimeValue(DEFAULT_EATING_WINDOW.endMinutes));
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      const userId = await getLocalUserId(supabase);
      if (!userId) return;
      const window = await fetchEatingWindow(supabase, userId);
      setStartValue(minutesToTimeValue(window.startMinutes));
      setEndValue(minutesToTimeValue(window.endMinutes));
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (isSaving) return;
    setMessage(null);
    const startMinutes = timeValueToMinutes(startValue);
    const endMinutes = timeValueToMinutes(endValue);
    if (startMinutes == null || endMinutes == null) {
      setMessage({ type: 'error', text: 'Enter valid times.' });
      return;
    }
    // Matches the DB constraint: at least 2 hours, so pacing math stays sane.
    if (endMinutes - startMinutes < 120) {
      setMessage({ type: 'error', text: 'The window must be at least 2 hours long.' });
      return;
    }
    setIsSaving(true);
    try {
      // Local session read — getUser() hits the network and reads a blip as
      // "logged out"; RLS still verifies the token on the write itself.
      const userId = await getLocalUserId(supabase);
      if (!userId) throw new Error('Not signed in');
      await saveEatingWindow(supabase, userId, { startMinutes, endMinutes });
      setMessage({ type: 'success', text: 'Eating window saved.' });
    } catch (err) {
      console.error('Failed to save eating window:', err);
      setMessage({ type: 'error', text: 'Failed to save. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Eating Window</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-surface-500">
          Nutrition pacing (&ldquo;on pace / behind / ahead&rdquo;) judges your intake against how
          much of this window has passed. Nothing is flagged before the window or in its first hour.
        </p>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-surface-400 mb-1" htmlFor="eating-window-start">
              First meal
            </label>
            <input
              id="eating-window-start"
              type="time"
              value={startValue}
              onChange={(e) => setStartValue(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-surface-400 mb-1" htmlFor="eating-window-end">
              Last meal
            </label>
            <input
              id="eating-window-end"
              type="time"
              value={endValue}
              onChange={(e) => setEndValue(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {message && (
          <p className={`text-xs ${message.type === 'success' ? 'text-success-400' : 'text-danger-400'}`}>
            {message.text}
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={handleSave} isLoading={isSaving} size="sm">
            Save window
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
