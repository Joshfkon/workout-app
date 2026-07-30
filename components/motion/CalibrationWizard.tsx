'use client';

/**
 * Machine calibration wizard (motion capture, experimental).
 *
 * Flow: details → hold at BOTTOM of ROM (capture gravity) → move to TOP,
 * recording the transit gyro on the way → hold at TOP (capture gravity) →
 * review the derived ROM/axis → save.
 *
 * The pivot axis is derived from the transit-gyro integral and cross-checked
 * against the gravity references (services/shared/motion/calibration.ts) —
 * never assumed from the mount orientation, which is stored as descriptive
 * metadata only. The derived ROM is shown so the user can sanity-check it
 * against the machine's real stroke before saving.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  recordForDuration,
  requestMotionPermission,
  startMotionRecorder,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { insertCalibration } from '@/lib/motion/calibrations';
import { deriveCalibration, type CalibrationDerivation, type TransitSample } from '@/services/shared/motion';
import {
  MOTION_SCHEMA_VERSION,
  MOUNT_ORIENTATIONS,
  type MachineCalibration,
  type MountOrientation,
  type Vec3,
} from '@/types/motion';

interface ExerciseOption {
  id: string;
  name: string;
}

interface CalibrationWizardProps {
  userId: string;
  exercises: ExerciseOption[];
  onSaved: (calibration: MachineCalibration) => void;
  onClose: () => void;
}

type WizardStep = 'details' | 'bottom' | 'top' | 'review';

const HOLD_CAPTURE_MS = 1500;

/** Mean vector of a still-hold accel capture. */
function meanAccel(samples: Array<{ accel: Vec3 }>): Vec3 {
  const n = Math.max(1, samples.length);
  return {
    x: samples.reduce((a, s) => a + s.accel.x, 0) / n,
    y: samples.reduce((a, s) => a + s.accel.y, 0) / n,
    z: samples.reduce((a, s) => a + s.accel.z, 0) / n,
  };
}

export function CalibrationWizard({ userId, exercises, onSaved, onClose }: CalibrationWizardProps) {
  const [step, setStep] = useState<WizardStep>('details');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Details
  const [exerciseId, setExerciseId] = useState('');
  const [label, setLabel] = useState('');
  const [seatSetting, setSeatSetting] = useState('');
  const [radiusMm, setRadiusMm] = useState('');
  const [orientation, setOrientation] = useState<MountOrientation>('top-edge');

  // Captured signals
  const [gravityBottom, setGravityBottom] = useState<Vec3 | null>(null);
  const [gravityTop, setGravityTop] = useState<Vec3 | null>(null);
  const transitRef = useRef<TransitSample[]>([]);
  const transitRecorderRef = useRef<MotionRecorderHandle | null>(null);
  const lastTransitTRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // The transit recorder runs between the bottom and top captures; if the
  // user navigates away mid-wizard it must not keep a devicemotion listener
  // (and this component's closure) alive.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      transitRecorderRef.current?.stop();
      transitRecorderRef.current = null;
    };
  }, []);

  const derivation: CalibrationDerivation | null = useMemo(() => {
    if (!gravityBottom || !gravityTop) return null;
    return deriveCalibration(gravityBottom, gravityTop, transitRef.current);
  }, [gravityBottom, gravityTop]);

  const exerciseOptions = exercises.map((e) => ({ value: e.id, label: e.name }));

  const detailsValid =
    exerciseId !== '' &&
    label.trim() !== '' &&
    Number(radiusMm) > 0 &&
    Number(radiusMm) < 2000;

  const captureBottom = async () => {
    setError(null);
    setBusy(true);
    try {
      // iOS requires the permission request inside this tap's handler.
      const permission = await requestMotionPermission();
      if (permission !== 'granted') {
        setError(
          permission === 'unsupported'
            ? 'This device does not expose motion sensors to the browser.'
            : 'Motion permission denied — allow motion access to calibrate.'
        );
        return;
      }
      const samples = await recordForDuration(HOLD_CAPTURE_MS);
      // Unmounted during the hold: starting the transit recorder now would
      // leak a devicemotion listener with nothing left to stop it.
      if (!isMountedRef.current) return;
      if (samples.length < 10) {
        setError('Too few sensor readings — try again.');
        return;
      }
      setGravityBottom(meanAccel(samples));
      // From here until the top capture, record the transit gyro: it is what
      // pins down the pivot axis (gravity refs alone cannot).
      transitRef.current = [];
      lastTransitTRef.current = null;
      transitRecorderRef.current = startMotionRecorder((s) => {
        const last = lastTransitTRef.current;
        lastTransitTRef.current = s.tMs;
        if (last !== null) transitRef.current.push({ gyro: s.gyro, dtMs: s.tMs - last });
      });
      setStep('top');
    } finally {
      setBusy(false);
    }
  };

  const captureTop = async () => {
    setError(null);
    setBusy(true);
    try {
      const samples = await recordForDuration(HOLD_CAPTURE_MS);
      transitRecorderRef.current?.stop();
      transitRecorderRef.current = null;
      if (!isMountedRef.current) return;
      if (samples.length < 10) {
        setError('Too few sensor readings — try again.');
        return;
      }
      setGravityTop(meanAccel(samples));
      setStep('review');
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    transitRecorderRef.current?.stop();
    transitRecorderRef.current = null;
    transitRef.current = [];
    setGravityBottom(null);
    setGravityTop(null);
    setError(null);
    setStep('bottom');
  };

  const save = async () => {
    if (!derivation?.valid || !gravityBottom || !gravityTop) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createUntypedClient();
      const saved = await insertCalibration(supabase, userId, {
        exerciseId,
        label: label.trim(),
        seatSetting: seatSetting.trim(),
        mountRadius_mm: Number(radiusMm),
        mountOrientation: orientation,
        gravityRefStart: gravityBottom,
        gravityRefEnd: gravityTop,
        derivedPivotAxis: derivation.pivotAxis!,
        derivedRomDegrees: derivation.romDegrees,
        schemaVersion: MOTION_SCHEMA_VERSION,
      });
      onSaved(saved);
    } catch (err) {
      console.error('[CalibrationWizard] save failed:', err);
      setError('Failed to save the calibration. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="calibration-wizard">
      <CardHeader>
        <CardTitle>New machine calibration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {step === 'details' && (
          <div className="space-y-3">
            <Select
              label="Exercise"
              options={exerciseOptions}
              placeholder="Select exercise"
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
            />
            <Input
              label="Label"
              placeholder='e.g. "Home gym HS incline"'
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Input
              label="Seat setting"
              placeholder="e.g. pin 4"
              hint="Your seat pin position — changing it later invalidates this calibration."
              value={seatSetting}
              onChange={(e) => setSeatSetting(e.target.value)}
            />
            <Input
              label="Pivot → phone distance (mm)"
              type="number"
              inputMode="numeric"
              placeholder="e.g. 320"
              hint="Measure from the machine arm's pivot axis to the middle of the phone (where the sensors are), along the arm. A tape measure to the nearest 5 mm is fine — this scales handle-speed numbers."
              value={radiusMm}
              onChange={(e) => setRadiusMm(e.target.value)}
            />
            <Select
              label="Phone mount orientation"
              hint="Which edge of the phone points along the arm toward the pivot (descriptive only — the rotation axis is measured, not assumed)."
              options={MOUNT_ORIENTATIONS.map((o) => ({ value: o, label: o.replace('-', ' ') }))}
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as MountOrientation)}
            />
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={() => setStep('bottom')}
                disabled={!detailsValid}
                className="flex-1"
                data-testid="calibration-details-next"
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'bottom' && (
          <div className="space-y-3">
            <p className="text-sm text-surface-300">
              Mount the phone on the machine arm. Move the arm to the{' '}
              <span className="font-medium text-surface-100">BOTTOM of the range of motion</span> and
              hold it completely still, then tap capture. Keep holding still for ~2 seconds.
            </p>
            <Button onClick={captureBottom} isLoading={busy} className="w-full" size="lg" data-testid="calibration-capture-bottom">
              Capture bottom position
            </Button>
            <Button variant="secondary" onClick={onClose} className="w-full">
              Cancel
            </Button>
          </div>
        )}

        {step === 'top' && (
          <div className="space-y-3">
            <p className="text-sm text-surface-300">
              Bottom captured. Now move the arm{' '}
              <span className="font-medium text-surface-100">smoothly to the TOP of the range of
              motion</span> (the movement itself is being measured), hold it completely still, then
              tap capture.
            </p>
            <Button onClick={captureTop} isLoading={busy} className="w-full" size="lg" data-testid="calibration-capture-top">
              Capture top position
            </Button>
            <Button variant="secondary" onClick={restart} className="w-full">
              Start over
            </Button>
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-3" data-testid="calibration-review">
            {derivation?.valid ? (
              <>
                <div className="p-3 rounded-lg bg-surface-900/60 space-y-1">
                  <p className="text-sm text-surface-300">
                    Derived range of motion:{' '}
                    <span className="text-lg font-semibold text-primary-400">
                      {derivation.romDegrees!.toFixed(1)}°
                    </span>
                  </p>
                  {derivation.romFromGyroDegrees !== null && (
                    <p className="text-xs text-surface-500">
                      Gyro transit measured {derivation.romFromGyroDegrees.toFixed(1)}° — the two
                      agree, which means the mount held steady.
                    </p>
                  )}
                  <p className="text-xs text-surface-400">
                    Sanity-check this number against the machine&apos;s real stroke. If it looks
                    wrong, start over — don&apos;t save a bad calibration.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
                  <p className="text-xs text-warning-400">
                    This calibration is only valid for this exact setup. Changing the seat height or
                    moving the phone mount invalidates it — you&apos;ll need to calibrate again.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={restart} className="flex-1">
                    Redo captures
                  </Button>
                  <Button onClick={save} isLoading={busy} className="flex-1" data-testid="calibration-save">
                    Save calibration
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
                  <p className="text-sm text-danger-400">
                    {derivation?.reason ?? 'Calibration captures are unusable.'}
                  </p>
                </div>
                <Button variant="secondary" onClick={restart} className="w-full">
                  Start over
                </Button>
              </>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
            <p className="text-sm text-danger-400">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
