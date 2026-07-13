'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { getLocalDateString } from '@/lib/utils';
import { useSleepLog } from '@/hooks/useSleepLog';
import { SLEEP_QUALITIES, type SleepQuality } from '@/types/schema';

/**
 * SleepQuickLog — the two-field inline sheet behind the home Sleep card (and
 * the same fields the daily check-in embeds): hours slept (0.5-step stepper,
 * defaulting to the last entry) + poor/ok/good quality chips. Saving upserts
 * today's sleep_log row — one entry per local day, a second save edits it.
 */

const MIN_HOURS = 0;
const MAX_HOURS = 16;
const STEP = 0.5;
const FALLBACK_HOURS = 8;

export const SLEEP_QUALITY_LABELS: Record<SleepQuality, string> = {
  poor: 'Poor',
  ok: 'OK',
  good: 'Good',
};

/** Chip dot colors shared with the Sleep card's quality dot. */
export const SLEEP_QUALITY_DOT_CLASS: Record<SleepQuality, string> = {
  poor: 'bg-warning-400',
  ok: 'bg-surface-400',
  good: 'bg-success-400',
};

export function clampSleepHours(value: number): number {
  const snapped = Math.round(value / STEP) * STEP;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, snapped));
}

/** The bare stepper + chips pair, reused inside the daily check-in flow. */
export function SleepFields({
  hours,
  quality,
  onHoursChange,
  onQualityChange,
}: {
  hours: number;
  quality: SleepQuality;
  onHoursChange: (hours: number) => void;
  onQualityChange: (quality: SleepQuality) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-surface-500 mb-2">Hours slept</p>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Decrease hours"
            onClick={() => onHoursChange(clampSleepHours(hours - STEP))}
            className="w-11 h-11 rounded-full bg-surface-800 text-surface-200 text-xl font-medium hover:bg-surface-700 transition-colors"
          >
            −
          </button>
          <span
            data-testid="sleep-hours-value"
            className="text-2xl font-bold text-surface-100 min-w-[4.5rem] text-center tabular-nums"
          >
            {hours}h
          </span>
          <button
            type="button"
            aria-label="Increase hours"
            onClick={() => onHoursChange(clampSleepHours(hours + STEP))}
            className="w-11 h-11 rounded-full bg-surface-800 text-surface-200 text-xl font-medium hover:bg-surface-700 transition-colors"
          >
            +
          </button>
        </div>
      </div>

      <div>
        <p className="text-xs text-surface-500 mb-2">Quality</p>
        <div className="flex gap-2">
          {SLEEP_QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              data-testid={`sleep-quality-${q}`}
              onClick={() => onQualityChange(q)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                quality === q
                  ? 'bg-primary-500 text-white'
                  : 'bg-surface-800 text-surface-400 hover:bg-surface-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  quality === q ? 'bg-white/80' : SLEEP_QUALITY_DOT_CLASS[q]
                }`}
                aria-hidden="true"
              />
              {SLEEP_QUALITY_LABELS[q]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface SleepQuickLogProps {
  onSaved?: () => void;
}

export function SleepQuickLog({ onSaved }: SleepQuickLogProps) {
  const { entries, lastEntry, isLoading, logSleep } = useSleepLog();
  const [hours, setHours] = useState<number>(FALLBACK_HOURS);
  const [quality, setQuality] = useState<SleepQuality>('ok');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only seed defaults until the user touches a field — a slow fetch must
  // never stomp an in-progress edit.
  const touchedRef = useRef(false);

  const todayStr = getLocalDateString();
  const todaysEntry = entries.find((e) => e.localDay === todayStr) ?? null;

  useEffect(() => {
    if (touchedRef.current || isLoading) return;
    // Editing today's entry wins; otherwise default hours to the LAST entry.
    const seed = todaysEntry ?? lastEntry;
    if (seed) {
      setHours(clampSleepHours(seed.hours));
      setQuality(todaysEntry ? todaysEntry.quality : seed.quality);
    }
  }, [isLoading, todaysEntry, lastEntry]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await logSleep({ localDay: todayStr, hours, quality });
      onSaved?.();
    } catch (err) {
      console.error('Failed to save sleep entry:', err);
      setError('Could not save — try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SleepFields
        hours={hours}
        quality={quality}
        onHoursChange={(h) => {
          touchedRef.current = true;
          setHours(h);
        }}
        onQualityChange={(q) => {
          touchedRef.current = true;
          setQuality(q);
        }}
      />
      {error && <p className="text-xs text-danger-400">{error}</p>}
      <Button onClick={handleSave} isLoading={isSaving} className="w-full" data-testid="sleep-save">
        {todaysEntry ? 'Update sleep' : 'Save sleep'}
      </Button>
    </div>
  );
}
