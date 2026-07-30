'use client';

/**
 * Motion Capture (experimental) settings card. Follows the
 * EnhancedAthleteModeCard pattern: the flags are per-user profile facts on
 * the users row (motion_capture_enabled / motion_capture_raw_retention),
 * both default OFF, persisted on toggle.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Toggle } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { RAW_BUFFER_SESSION_CAP } from '@/lib/motion/motionPersistence';

export function MotionCaptureLabCard() {
  const [enabled, setEnabled] = useState(false);
  const [rawRetention, setRawRetention] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const supabase = createUntypedClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || cancelled) return;
        setUserId(user.id);
        const { data } = await supabase
          .from('users')
          .select('motion_capture_enabled, motion_capture_raw_retention')
          .eq('id', user.id)
          .single();
        if (!cancelled) {
          setEnabled(data?.motion_capture_enabled === true);
          setRawRetention(data?.motion_capture_raw_retention === true);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = async (patch: {
    motion_capture_enabled?: boolean;
    motion_capture_raw_retention?: boolean;
  }) => {
    if (!userId || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const { error: updateError } = await supabase.from('users').update(patch).eq('id', userId);
      if (updateError) throw updateError;
      if (patch.motion_capture_enabled !== undefined) setEnabled(patch.motion_capture_enabled);
      if (patch.motion_capture_raw_retention !== undefined) {
        setRawRetention(patch.motion_capture_raw_retention);
      }
    } catch (err) {
      console.error('Failed to update motion capture settings:', err);
      setError('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card data-testid="motion-capture-lab-card">
      <CardHeader>
        <CardTitle>
          Motion Capture{' '}
          <span className="ml-1 text-xs font-normal uppercase tracking-wide text-warning-400">
            Experimental
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-surface-300">
              Strap your phone to a single-DOF machine arm (e.g. iso-lateral incline press) and
              record per-rep tempo, ROM, and handle speed from the IMU.
            </p>
            <p className="mt-1 text-xs text-surface-500">
              Display-only telemetry — never feeds progression, prescriptions, or volume.
            </p>
          </div>
          <Toggle
            checked={enabled}
            onChange={(value) => persist({ motion_capture_enabled: value })}
            disabled={isLoading || isSaving || !userId}
          />
        </div>

        {enabled && (
          <>
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-surface-700">
              <div>
                <p className="text-sm text-surface-300 mt-3">Keep raw sample buffers</p>
                <p className="mt-1 text-xs text-surface-500">
                  Off: only derived per-rep metrics are stored. On: raw IMU streams are also kept
                  (max {RAW_BUFFER_SESSION_CAP} per workout) — for offline analysis; bloats storage.
                </p>
              </div>
              <Toggle
                checked={rawRetention}
                onChange={(value) => persist({ motion_capture_raw_retention: value })}
                disabled={isLoading || isSaving || !userId}
              />
            </div>
            <Link
              href="/dashboard/motion"
              className="inline-block text-sm text-primary-400 hover:text-primary-300"
            >
              Open Motion Capture →
            </Link>
          </>
        )}

        {error && <p className="text-xs text-danger-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
