'use client';

/**
 * Machine calibration wizard (motion capture, experimental) — SWEEP flow.
 *
 * Exactly two taps, both with the phone in hand:
 *   START → set the phone on the mount → 3 slow full-ROM reps (unloaded or
 *   light) → retrieve the phone → STOP.
 *
 * No taps at ROM endpoints: the phone is unreachable and unreadable there.
 * Every sweep proceeds to a full analysis review (tier, PC1 share, chart,
 * reps/velocity — services/shared/motion/captureAnalysis.ts); the tiered
 * stillness classification only decides whether the sweep can additionally
 * be SAVED as a machine calibration (services/shared/motion/calibration.ts).
 * When it can't, the message says why — including "phone appears hand-held"
 * when still windows exist but are too unsteady, since holding still longer
 * doesn't fix that.
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  requestMotionPermission,
  startMotionRecorder,
  tapLatencyMs,
  TAP_LATENCY_WARN_MS,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { downloadTextFile, samplesToCsv } from '@/lib/motion/csv';
import { insertCalibration } from '@/lib/motion/calibrations';
import {
  analyzeCapture,
  deriveCalibrationFromAnalysis,
  type CalibrationEligibility,
  type CaptureAnalysis,
} from '@/services/shared/motion';
import { CaptureAnalysisView } from './CaptureAnalysisView';
import {
  CALIBRATION_SCHEMA_VERSION,
  MOUNT_ORIENTATIONS,
  type ImuSample,
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

type WizardStep = 'details' | 'sweep' | 'review';

/** Small 2.5-D indicator of the derived axis in the phone frame: arrow =
 *  screen-plane component, label = out-of-screen share. */
function AxisIndicator({ axis }: { axis: Vec3 }) {
  const planar = Math.hypot(axis.x, axis.y);
  const scaleFactor = planar > 1e-6 ? 34 / Math.max(planar, 0.35) : 0;
  // Screen coords: phone +x → right, phone +y → up (SVG y is flipped).
  const dx = axis.x * scaleFactor;
  const dy = -axis.y * scaleFactor;
  const zPct = Math.round(Math.abs(axis.z) * 100);
  return (
    <div className="flex items-center gap-3">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <rect x="24" y="8" width="40" height="72" rx="8" fill="none" strokeWidth="1.5" className="stroke-surface-600" />
        <circle cx="44" cy="44" r="3" className="fill-surface-500" />
        {planar > 0.05 && (
          <>
            <line x1="44" y1="44" x2={44 + dx} y2={44 + dy} strokeWidth="2.5" strokeLinecap="round" className="stroke-primary-400" />
            <circle cx={44 + dx} cy={44 + dy} r="3.5" className="fill-primary-400" />
          </>
        )}
      </svg>
      <div className="text-xs text-surface-400 space-y-0.5">
        <p>Rotation axis relative to the phone:</p>
        <p>
          in-screen {Math.round(planar * 100)}% · {axis.z >= 0 ? 'out of' : 'into'} screen {zPct}%
        </p>
        <p className="text-surface-500">
          For a side-mounted phone on a rotating arm this should point mostly {`"through"`} the
          phone, perpendicular to the arm&apos;s swing plane.
        </p>
      </div>
    </div>
  );
}

export function CalibrationWizard({ userId, exercises, onSaved, onClose }: CalibrationWizardProps) {
  const [step, setStep] = useState<WizardStep>('details');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sweeping, setSweeping] = useState(false);

  // Details
  const [exerciseId, setExerciseId] = useState('');
  const [label, setLabel] = useState('');
  const [seatSetting, setSeatSetting] = useState('');
  const [radiusMm, setRadiusMm] = useState('');
  const [orientation, setOrientation] = useState<MountOrientation>('top-edge');

  const [analysis, setAnalysis] = useState<CaptureAnalysis | null>(null);
  const [eligibility, setEligibility] = useState<CalibrationEligibility | null>(null);
  // Tap-to-sensor staleness measured at the STOP tap (debug visibility).
  const [stopLatencyMs, setStopLatencyMs] = useState<number | null>(null);

  const recorderRef = useRef<MotionRecorderHandle | null>(null);
  const sweepSamplesRef = useRef<ImuSample[]>([]);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      recorderRef.current?.stop();
      recorderRef.current = null;
    };
  }, []);

  const exerciseOptions = exercises.map((e) => ({ value: e.id, label: e.name }));

  const detailsValid =
    exerciseId !== '' &&
    label.trim() !== '' &&
    Number(radiusMm) > 0 &&
    Number(radiusMm) < 2000;

  const startSweep = async () => {
    setError(null);
    // iOS requires the permission request inside this tap's handler.
    const permission = await requestMotionPermission();
    if (!isMountedRef.current) return;
    if (permission !== 'granted') {
      setError(
        permission === 'unsupported'
          ? 'This device does not expose motion sensors to the browser.'
          : 'Motion permission denied — allow motion access to calibrate.'
      );
      return;
    }
    recorderRef.current = startMotionRecorder();
    setSweeping(true);
  };

  const stopSweep = () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setSweeping(false);
    if (!recorder) return;
    setStopLatencyMs(tapLatencyMs(recorder));
    const samples = recorder.stop();
    sweepSamplesRef.current = samples;
    // Every sweep proceeds to review: reps/velocity/chart always show, the
    // stillness tier only decides whether a calibration can be SAVED.
    const a = analyzeCapture(samples);
    setAnalysis(a);
    setEligibility(deriveCalibrationFromAnalysis(a, samples));
    setStep('review');
  };

  const downloadSweepCsv = () => {
    if (sweepSamplesRef.current.length === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`calibration-sweep-${stamp}.csv`, samplesToCsv(sweepSamplesRef.current));
  };

  const restart = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setSweeping(false);
    setAnalysis(null);
    setEligibility(null);
    setError(null);
    setStep('sweep');
  };

  const save = async () => {
    if (!eligibility?.eligible) return;
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
        gravityRefStart: eligibility.gravityRefBottom!,
        gravityRefEnd: eligibility.gravityRefTop!,
        derivedPivotAxis: eligibility.pivotAxis!,
        axisQuality: eligibility.axisQuality!,
        derivedRomDegrees: eligibility.romDegrees,
        schemaVersion: CALIBRATION_SCHEMA_VERSION,
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
                onClick={() => setStep('sweep')}
                disabled={!detailsValid}
                className="flex-1"
                data-testid="calibration-details-next"
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 'sweep' && (
          <div className="space-y-3">
            {!sweeping ? (
              <>
                <ol className="text-sm text-surface-300 space-y-1.5 list-decimal list-inside">
                  <li>
                    Tap <span className="font-medium text-surface-100">Start</span> (phone in hand).
                  </li>
                  <li>Set the phone on the machine mount and let it sit still for a moment.</li>
                  <li>
                    Do <span className="font-medium text-surface-100">3 slow, full-range reps</span>{' '}
                    — unloaded or light — pausing briefly at each end of the stroke.
                  </li>
                  <li>Let the arm rest, take the phone back, and tap Stop.</li>
                </ol>
                <Button onClick={startSweep} className="w-full" size="lg" data-testid="calibration-start-sweep">
                  Start
                </Button>
                <Button variant="secondary" onClick={onClose} className="w-full">
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-surface-300">
                  Recording… mount the phone, do 3 slow full-range reps, retrieve it, then stop.
                </p>
                <Button onClick={stopSweep} className="w-full" size="lg" data-testid="calibration-stop-sweep">
                  Stop
                </Button>
              </>
            )}
          </div>
        )}

        {step === 'review' && analysis && eligibility && (
          <div className="space-y-3" data-testid="calibration-review">
            {/* The sweep ALWAYS shows its analysis — reps, velocity, chart,
                tier — whether or not it qualifies as a calibration. */}
            <CaptureAnalysisView analysis={analysis} />

            {/* Debug strip: sensor staleness at the STOP tap + raw export —
                a rejection message alone can't explain a bad sweep. */}
            <div className="flex items-center justify-between gap-2 text-xs text-surface-500">
              <span data-testid="calibration-stop-latency">
                Sensor latency at Stop:{' '}
                {stopLatencyMs === null ? 'n/a' : `${Math.round(stopLatencyMs)} ms`}
                {stopLatencyMs !== null && stopLatencyMs > TAP_LATENCY_WARN_MS && (
                  <span className="text-warning-400">
                    {' '}
                    — stale (&gt;{TAP_LATENCY_WARN_MS} ms; sensor delivery is lagging taps)
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={downloadSweepCsv}
                className="text-primary-400 hover:text-primary-300 whitespace-nowrap"
                data-testid="calibration-download-csv"
              >
                Download raw sweep (CSV)
              </button>
            </div>

            {eligibility.eligible ? (
              <>
                <div className="p-3 rounded-lg bg-surface-900/60 space-y-2">
                  <div className="flex items-baseline gap-4">
                    <div>
                      <p className="text-xs text-surface-500">Calibration ROM</p>
                      <p className="text-xl font-semibold text-primary-400">
                        {eligibility.romDegrees!.toFixed(1)}°
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-surface-500">Axis quality</p>
                      <p className="text-xl font-semibold text-surface-100">
                        {eligibility.axisQuality! >= 1000 ? '999+' : eligibility.axisQuality!.toFixed(0)}
                      </p>
                    </div>
                  </div>
                  <AxisIndicator axis={eligibility.pivotAxis!} />
                  <p className="text-xs text-surface-400">
                    Sanity-check the ROM against the machine&apos;s real stroke. If it looks wrong,
                    redo the sweep — don&apos;t save a bad calibration.
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
                    Redo sweep
                  </Button>
                  <Button onClick={save} isLoading={busy} className="flex-1" data-testid="calibration-save">
                    Save calibration
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
                  <p className="text-sm text-warning-400" data-testid="calibration-ineligible-reason">
                    Can&apos;t save as a machine calibration: {eligibility.reason}
                  </p>
                </div>
                <Button variant="secondary" onClick={restart} className="w-full">
                  Redo sweep
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
