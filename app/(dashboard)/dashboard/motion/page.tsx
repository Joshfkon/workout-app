'use client';

/**
 * Motion Capture (experimental) — capture + calibration management page.
 * Fully gated behind users.motion_capture_enabled (off by default); when the
 * flag is off this page only points at the settings toggle.
 *
 * v1 scope: single-DOF rotating-arm machines, display-only telemetry.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent, CardHeader, CardTitle, LoadingAnimation } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { CalibrationWizard } from '@/components/motion/CalibrationWizard';
import { MotionCaptureFlow } from '@/components/motion/MotionCaptureFlow';
import { deleteCalibration, listCalibrations } from '@/lib/motion/calibrations';
import type { MachineCalibration } from '@/types/motion';

interface ExerciseOption {
  id: string;
  name: string;
}

export default function MotionPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [rawRetention, setRawRetention] = useState(false);
  const [calibrations, setCalibrations] = useState<MachineCalibration[]>([]);
  const [exercises, setExercises] = useState<ExerciseOption[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [rawStorage, setRawStorage] = useState<{ buffers: number; samples: number } | null>(null);

  const load = useCallback(async () => {
    const supabase = createUntypedClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const [{ data: userRow }, calibrationRows, { data: exerciseRows }, { data: rawRows }] =
      await Promise.all([
        supabase
          .from('users')
          .select('motion_capture_enabled, motion_capture_raw_retention')
          .eq('id', user.id)
          .single(),
        listCalibrations(supabase, user.id).catch(() => [] as MachineCalibration[]),
        supabase.from('exercises').select('id, name, equipment_required').order('name'),
        supabase.from('motion_capture_raw_buffers').select('sample_count').eq('user_id', user.id),
      ]);

    const rawList = (rawRows ?? []) as Array<{ sample_count: number }>;
    setRawStorage({
      buffers: rawList.length,
      samples: rawList.reduce((a, r) => a + (r.sample_count || 0), 0),
    });

    setEnabled(userRow?.motion_capture_enabled === true);
    setRawRetention(userRow?.motion_capture_raw_retention === true);
    setCalibrations(calibrationRows);

    // v1 targets machines only; fall back to the full list if the equipment
    // metadata filters everything out (custom exercises may lack it).
    const all = (exerciseRows ?? []) as Array<ExerciseOption & { equipment_required?: string[] }>;
    const machines = all.filter((e) => (e.equipment_required ?? []).includes('machine'));
    setExercises((machines.length > 0 ? machines : all).map(({ id, name }) => ({ id, name })));
  }, []);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  const handleDelete = async (calibrationId: string) => {
    if (!userId) return;
    setNotice(null);
    try {
      const supabase = createUntypedClient();
      const result = await deleteCalibration(supabase, userId, calibrationId);
      if (result === 'in-use') {
        setNotice('That calibration has saved captures referencing it, so it can’t be deleted.');
        return;
      }
      setCalibrations((prev) => prev.filter((c) => c.id !== calibrationId));
    } catch (err) {
      console.error('[MotionPage] delete calibration failed:', err);
      setNotice('Failed to delete the calibration.');
    }
  };

  const exerciseNames = Object.fromEntries(exercises.map((e) => [e.id, e.name]));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingAnimation type="dots" size="md" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="max-w-lg mx-auto space-y-4">
        <h1 className="text-2xl font-bold text-surface-100">Motion Capture</h1>
        <Card>
          <CardContent className="py-6 space-y-3">
            <p className="text-sm text-surface-300">
              Motion capture is an experimental feature and is turned off. Enable it in Settings to
            record per-rep tempo, ROM, and handle speed on calibrated machines.
            </p>
            <Link href="/dashboard/settings" className="inline-block text-sm text-primary-400 hover:text-primary-300">
              Go to Settings →
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">
          Motion Capture{' '}
          <span className="ml-1 align-middle text-xs font-normal uppercase tracking-wide text-warning-400">
            Experimental
          </span>
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          Single-DOF machine telemetry — display-only, never feeds your progression.
        </p>
      </div>

      {userId && (
        <MotionCaptureFlow
          userId={userId}
          rawRetentionEnabled={rawRetention}
          calibrations={calibrations}
          exerciseNames={exerciseNames}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Machine calibrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {calibrations.length === 0 && (
            <p className="text-sm text-surface-400">
              None yet. A calibration ties captures to one machine, seat setting, and phone-mount
              position.
            </p>
          )}
          {calibrations.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-900/60"
            >
              <div className="min-w-0">
                <p className="text-sm text-surface-200 truncate">{c.label}</p>
                <p className="text-xs text-surface-500">
                  {exerciseNames[c.exerciseId] ?? 'Unknown exercise'}
                  {c.seatSetting ? ` · seat ${c.seatSetting}` : ''} · r={c.mountRadius_mm} mm
                  {c.derivedRomDegrees != null ? ` · ${Math.round(c.derivedRomDegrees)}° ROM` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(c.id)}>
                Delete
              </Button>
            </div>
          ))}

          {notice && <p className="text-xs text-warning-400">{notice}</p>}

          {showWizard && userId ? (
            <CalibrationWizard
              userId={userId}
              exercises={exercises}
              onSaved={(calibration) => {
                setCalibrations((prev) => [calibration, ...prev]);
                setShowWizard(false);
              }}
              onClose={() => setShowWizard(false)}
            />
          ) : (
            <Button variant="outline" onClick={() => setShowWizard(true)} className="w-full">
              New calibration
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Debug-data readout: raw retention is default-on while experimental,
          so the storage cost stays visible instead of accumulating silently. */}
      <Card>
        <CardHeader>
          <CardTitle>Raw IMU storage</CardTitle>
        </CardHeader>
        <CardContent>
          {rawStorage === null ? (
            <p className="text-sm text-surface-400">Unavailable.</p>
          ) : (
            <p className="text-sm text-surface-300" data-testid="motion-raw-storage">
              {rawStorage.buffers} buffer{rawStorage.buffers === 1 ? '' : 's'} ·{' '}
              {rawStorage.samples.toLocaleString()} samples · ~
              {(rawStorage.samples * 75 / 1_000_000).toFixed(1)} MB
            </p>
          )}
          <p className="mt-1 text-xs text-surface-500">
            Raw buffers are kept for debugging ({'≤'}3 per workout) while raw retention is on —
            toggle it in Settings → Motion Capture.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
