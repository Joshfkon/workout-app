'use client';

/**
 * Training style setting: Automatic / Plan (mesocycles) / Freestyle
 * (lib/training/trainingStyle). Saves on tap into users.preferences
 * (read-merge-write, like the other instantly-saved preference cards);
 * Automatic removes the key so the style is inferred again.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  fetchTrainingStyle,
  type TrainingStyle,
  type TrainingStylePreference,
} from '@/lib/training/trainingStyle';

const OPTIONS: { value: TrainingStylePreference; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'plan', label: 'Plan' },
  { value: 'freestyle', label: 'Freestyle' },
];

const STYLE_NAMES: Record<TrainingStyle, string> = {
  plan: 'Plan',
  freestyle: 'Freestyle',
};

export function TrainingStyleCard({ userId }: { userId: string | null }) {
  const [preference, setPreference] = useState<TrainingStylePreference>('auto');
  const [effective, setEffective] = useState<TrainingStyle | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchTrainingStyle(createUntypedClient(), userId)
      .then(({ style, preference: stored }) => {
        if (cancelled) return;
        setPreference(stored);
        setEffective(style);
      })
      .catch((err) => console.warn('Failed to load training style:', err));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const choose = async (next: TrainingStylePreference) => {
    if (!userId || isSaving || next === preference) return;
    setIsSaving(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const { data, error: readError } = await supabase
        .from('users')
        .select('preferences')
        .eq('id', userId)
        .single();
      if (readError) throw readError;
      const preferences = { ...((data?.preferences as Record<string, unknown>) ?? {}) };
      if (next === 'auto') delete preferences.trainingStyle;
      else preferences.trainingStyle = next;
      const { error: writeError } = await supabase
        .from('users')
        .update({ preferences })
        .eq('id', userId);
      if (writeError) throw writeError;
      const { style } = await fetchTrainingStyle(supabase, userId);
      setPreference(next);
      setEffective(style);
    } catch (err) {
      console.error('Failed to save training style:', err);
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card data-testid="training-style-card">
      <CardHeader>
        <CardTitle>Training Style</CardTitle>
        <p className="text-sm text-surface-400 mt-1">
          Plan follows a mesocycle (a multi-week training block). Freestyle hides mesocycles: start
          workouts as you go, and Home shows today&apos;s workout instead of a plan.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="inline-flex rounded-lg bg-surface-800 p-1 gap-1" role="group" aria-label="Training style">
          {OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => void choose(value)}
              disabled={isSaving || !userId}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                preference === value
                  ? 'bg-surface-600 text-surface-50'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
              aria-pressed={preference === value}
            >
              {label}
            </button>
          ))}
        </div>
        {preference === 'auto' && effective && (
          <p className="text-xs text-surface-500">
            Using <span className="text-surface-300">{STYLE_NAMES[effective]}</span>, based on how
            your recent workouts were started.
          </p>
        )}
        {error && <p className="text-xs text-danger-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
