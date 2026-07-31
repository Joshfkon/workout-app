'use client';

/**
 * Motion capture flow (experimental): setup → ARM → record → review.
 * Mirrors the nutrition label-scan pattern: an explicit stage machine,
 * permissions requested inside the user gesture, and NOTHING is ever saved
 * without an explicit user action on the review screen.
 *
 * Recording UX: the phone is strapped to the machine arm, so once armed the
 * screen dims to near-black (can't be read anyway; saves battery) while a
 * wake lock keeps the sensors alive. Recording starts on motion onset and
 * auto-terminates after 5 s below the rest threshold.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore, useWorkoutStore } from '@/stores';
import { formatWeight } from '@/lib/utils';
import {
  requestMotionPermission,
  startMotionRecorder,
  tapLatencyMs,
  TAP_LATENCY_WARN_MS,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { acquireScreenWakeLock, type WakeLockHandle } from '@/lib/motion/wakeLock';
import {
  RAW_BUFFER_SESSION_CAP,
  saveMotionCapture,
  saveRawBufferIfAllowed,
} from '@/lib/motion/motionPersistence';
import {
  clearPendingCapture,
  getPendingCapture,
  setPendingCapture,
} from '@/lib/motion/pendingCapture';
import {
  LiveCaptureGate,
  dot,
  processMotionSamples,
  type MotionPipelineResult,
} from '@/services/shared/motion';
import {
  MOTION_PROVENANCE,
  MOTION_SCHEMA_VERSION,
  type CaptureSide,
  type ImuSample,
  type MachineCalibration,
  type MotionCapture,
} from '@/types/motion';

interface MotionCaptureFlowProps {
  userId: string;
  rawRetentionEnabled: boolean;
  calibrations: MachineCalibration[];
  /** Exercise names for labeling (id → name). */
  exerciseNames: Record<string, string>;
  /**
   * In-workout mode: restrict calibrations to this exercise (auto-selecting
   * a sole match) so the sheet launched from an exercise card is one tap
   * from ARM.
   */
  lockedExerciseId?: string;
  /** Prefer this block's most recent set when defaulting the attach picker. */
  defaultAttachBlockId?: string;
}

type Stage = 'setup' | 'armed' | 'review';

interface FinishedCapture {
  samples: ImuSample[];
  startedAtIso: string;
  result: MotionPipelineResult;
}

export function MotionCaptureFlow({
  userId,
  rawRetentionEnabled,
  calibrations,
  exerciseNames,
  lockedExerciseId,
  defaultAttachBlockId,
}: MotionCaptureFlowProps) {
  const [stage, setStage] = useState<Stage>('setup');
  const [error, setError] = useState<string | null>(null);
  const [calibrationId, setCalibrationId] = useState('');
  const [side, setSide] = useState<CaptureSide>('right');
  const [recordingLive, setRecordingLive] = useState(false); // armed → motion seen
  const [finished, setFinished] = useState<FinishedCapture | null>(null);
  const [attachSetId, setAttachSetId] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'synced' | 'queued'>('idle');
  const [rawNote, setRawNote] = useState<string | null>(null);
  // Tap-to-sensor staleness when the recording was stopped by a tap (null
  // for auto-stop, which consumes no tap).
  const [stopTapLatencyMs, setStopTapLatencyMs] = useState<number | null>(null);

  const recorderRef = useRef<MotionRecorderHandle | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const gateRef = useRef<LiveCaptureGate | null>(null);
  const startedAtIsoRef = useRef<string>('');
  // Ref mirror so the high-rate sensor callback avoids per-sample setState.
  const recordingLiveRef = useRef(false);

  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');
  const activeSession = useWorkoutStore((state) => state.activeSession);
  const exerciseBlocks = useWorkoutStore((state) => state.exerciseBlocks);
  const setLogs = useWorkoutStore((state) => state.setLogs);

  // In-workout mode locks the calibration choices to the launching exercise.
  const usableCalibrations = useMemo(
    () =>
      lockedExerciseId
        ? calibrations.filter((c) => c.exerciseId === lockedExerciseId)
        : calibrations,
    [calibrations, lockedExerciseId]
  );

  const calibration = usableCalibrations.find((c) => c.id === calibrationId) ?? null;

  // One usable calibration → select it so the sheet is one tap from ARM.
  useEffect(() => {
    if (calibrationId === '' && usableCalibrations.length === 1) {
      setCalibrationId(usableCalibrations[0].id);
    }
  }, [calibrationId, usableCalibrations]);

  // Sets loggable against: this session's sets for the calibrated exercise,
  // newest first (the set the user just logged), with the launching block's
  // sets preferred over other blocks of the same exercise.
  const attachableSets = useMemo(() => {
    if (!calibration) return [];
    return exerciseBlocks
      .filter((b) => b.exerciseId === calibration.exerciseId)
      .flatMap((b) => (setLogs[b.id] ?? []).map((s) => ({ set: s, blockId: b.id })))
      .sort((a, b) => {
        const aPreferred = a.blockId === defaultAttachBlockId ? 1 : 0;
        const bPreferred = b.blockId === defaultAttachBlockId ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return (b.set.loggedAt ?? '').localeCompare(a.set.loggedAt ?? '');
      })
      .map(({ set: s }) => ({
        value: s.id,
        label: `Set ${s.setNumber} — ${formatWeight(s.weightKg, units)} × ${s.reps}`,
      }));
  }, [calibration, exerciseBlocks, setLogs, units, defaultAttachBlockId]);

  // Default the attach picker to the most recent set once reviewing (the
  // user can still change it; saving stays an explicit action).
  useEffect(() => {
    if (stage === 'review' && saveState === 'idle' && attachSetId === '' && attachableSets.length > 0) {
      setAttachSetId(attachableSets[0].value);
    }
  }, [stage, saveState, attachSetId, attachableSets]);

  const isMountedRef = useRef(true);

  const teardownSensors = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
    gateRef.current = null;
  };

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      teardownSensors();
    };
  }, []);

  // Restore a finished-but-unsaved capture (e.g. the user hopped to the
  // workout tab to log the set before saving). Mount-only by design.
  useEffect(() => {
    const p = getPendingCapture();
    if (!p) return;
    if (lockedExerciseId && p.exerciseId !== lockedExerciseId) return;
    if (!calibrations.some((c) => c.id === p.calibrationId)) return;
    setCalibrationId(p.calibrationId);
    setSide(p.side);
    startedAtIsoRef.current = p.startedAtIso;
    setFinished({ samples: p.samples, startedAtIso: p.startedAtIso, result: p.result });
    setAttachSetId('');
    setSaveState('idle');
    setRawNote(null);
    setStage('review');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const arm = async () => {
    if (!calibration) return;
    setError(null);
    // iOS: DeviceMotionEvent.requestPermission MUST run inside this tap.
    const permission = await requestMotionPermission();
    // Navigated away while the permission dialog was up: starting sensors or
    // a wake lock now would leak them past unmount.
    if (!isMountedRef.current) return;
    if (permission !== 'granted') {
      setError(
        permission === 'unsupported'
          ? 'This device does not expose motion sensors to the browser.'
          : 'Motion permission denied — allow motion access to record.'
      );
      return;
    }

    wakeLockRef.current = acquireScreenWakeLock();
    startedAtIsoRef.current = new Date().toISOString();
    const gate = new LiveCaptureGate();
    gateRef.current = gate;
    const pivotAxis = calibration.derivedPivotAxis;

    recorderRef.current = startMotionRecorder((s) => {
      const state = gate.feed(s.tMs, dot(s.gyro, pivotAxis));
      if (state === 'recording' && !recordingLiveRef.current) {
        recordingLiveRef.current = true;
        setRecordingLive(true);
      }
      if (state === 'done') finishRecording(false);
    });
    recordingLiveRef.current = false;
    setRecordingLive(false);
    setStage('armed');
  };

  const finishRecording = (fromTap: boolean) => {
    const recorder = recorderRef.current;
    if (!recorder || !calibration) return;
    setStopTapLatencyMs(fromTap ? tapLatencyMs(recorder) : null);
    const samples = recorder.stop();
    teardownSensors();

    const result = processMotionSamples({
      samples,
      pivotAxis: calibration.derivedPivotAxis,
      gravityRefBottom: calibration.gravityRefStart,
      mountRadiusMm: calibration.mountRadius_mm,
    });
    // Held in module memory so navigating away before Save doesn't destroy
    // the capture (review still never auto-commits).
    setPendingCapture({
      calibrationId: calibration.id,
      exerciseId: calibration.exerciseId,
      side,
      startedAtIso: startedAtIsoRef.current,
      samples,
      result,
    });
    setFinished({ samples, startedAtIso: startedAtIsoRef.current, result });
    setAttachSetId('');
    setSaveState('idle');
    setRawNote(null);
    setStage('review');
  };

  const discard = () => {
    teardownSensors();
    clearPendingCapture();
    setFinished(null);
    setStage('setup');
  };

  const save = async () => {
    if (!finished || !calibration || !attachSetId) return;
    setSaveState('saving');
    setError(null);
    try {
      const capture: MotionCapture = {
        id: crypto.randomUUID(),
        setId: attachSetId,
        calibrationId: calibration.id,
        side,
        startedAt: finished.startedAtIso,
        durationMs: finished.result.durationMs,
        sampleRateHz_mean: finished.result.sampleRateHzMean,
        sampleRateHz_stddev: finished.result.sampleRateHzStddev,
        droppedSampleCount: finished.result.droppedSampleCount,
        clipDetected: finished.result.clipDetected,
        reps: finished.result.reps,
        qualityFlags: finished.result.qualityFlags,
        provenance: MOTION_PROVENANCE,
        schemaVersion: MOTION_SCHEMA_VERSION,
      };
      const supabase = createUntypedClient();
      const saveResult = await saveMotionCapture(supabase, capture, userId);

      // Raw buffers need the row to exist server-side (FK + ownership check),
      // so only attempt when the metrics actually synced.
      if (rawRetentionEnabled && activeSession && saveResult === 'synced') {
        const rawResult = await saveRawBufferIfAllowed(supabase, {
          captureId: capture.id,
          userId,
          workoutSessionId: activeSession.id,
          samples: finished.samples,
        });
        if (rawResult.status === 'session-cap-reached') {
          setRawNote(
            `Raw buffer not kept — session cap of ${RAW_BUFFER_SESSION_CAP} reached (metrics saved).`
          );
        } else if (rawResult.status === 'failed') {
          setRawNote('Raw buffer upload failed (metrics saved — raw is best-effort).');
        } else {
          setRawNote(
            `Raw buffer kept (${rawResult.usedThisSession}/${RAW_BUFFER_SESSION_CAP} this session).`
          );
        }
      } else if (rawRetentionEnabled && saveResult === 'queued') {
        setRawNote('Raw buffer skipped — metrics are queued offline; raw is online-only.');
      }
      clearPendingCapture();
      if (!isMountedRef.current) return;
      setSaveState(saveResult);
    } catch (err) {
      console.error('[MotionCaptureFlow] save failed:', err);
      if (!isMountedRef.current) return;
      setError(
        err instanceof Error && /rejected/.test(err.message)
          ? err.message
          : 'Failed to save the capture.'
      );
      setSaveState('idle');
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------

  if (stage === 'armed') {
    // Near-black screen: the phone is on the machine arm, unreadable, and
    // burning battery for nobody. A giant tap target stops the recording.
    return (
      <button
        type="button"
        onClick={() => finishRecording(true)}
        className="fixed inset-0 z-[60] bg-black flex flex-col items-center justify-center gap-6"
        data-testid="motion-armed-overlay"
        aria-label="Stop recording"
      >
        <div
          className={`w-3 h-3 rounded-full ${recordingLive ? 'bg-danger-500/60 animate-pulse' : 'bg-surface-700'}`}
        />
        <p className="text-surface-700 text-sm">
          {recordingLive ? 'Recording — auto-stops after 5 s of rest' : 'Armed — start your set'}
        </p>
        <p className="text-surface-800 text-xs">Tap anywhere to stop</p>
      </button>
    );
  }

  if (stage === 'review' && finished) {
    const { result } = finished;
    const accepted = result.reps.filter((r) => !r.rejected);
    const rejected = result.reps.filter((r) => r.rejected);
    return (
      <Card data-testid="motion-review">
        <CardHeader>
          <CardTitle>Review capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold text-surface-100">{accepted.length}</span>
            <span className="text-sm text-surface-400">
              rep{accepted.length === 1 ? '' : 's'} measured
              {rejected.length > 0 && (
                <span className="text-danger-400"> · {rejected.length} rejected</span>
              )}
            </span>
          </div>

          {result.qualityFlags.length > 0 && (
            <div className="p-3 rounded-lg bg-warning-500/10 border border-warning-500/20">
              <p className="text-xs font-medium text-warning-400 mb-1">Quality flags</p>
              <p className="text-xs text-warning-400/90">{result.qualityFlags.join(', ')}</p>
            </div>
          )}

          {stopTapLatencyMs !== null && (
            <p className="text-xs text-surface-500" data-testid="motion-stop-latency">
              Sensor latency at stop tap: {Math.round(stopTapLatencyMs)} ms
              {stopTapLatencyMs > TAP_LATENCY_WARN_MS && (
                <span className="text-warning-400">
                  {' '}
                  — stale (&gt;{TAP_LATENCY_WARN_MS} ms; sensor delivery is lagging taps)
                </span>
              )}
            </p>
          )}

          {/* Per-rep metrics; rejected reps are marked loudly, not hidden. */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="motion-rep-table">
              <thead>
                <tr className="text-surface-500 text-left">
                  <th className="py-1 pr-2 font-medium">Rep</th>
                  <th className="py-1 pr-2 font-medium">Tempo (s)</th>
                  <th className="py-1 pr-2 font-medium">ROM</th>
                  <th className="py-1 pr-2 font-medium">Mean vel</th>
                  <th className="py-1 pr-2 font-medium">Peak ω</th>
                  <th className="py-1 font-medium">Gyro↔gravity</th>
                </tr>
              </thead>
              <tbody>
                {result.reps.map((rep) => (
                  <tr
                    key={rep.index}
                    className={
                      rep.rejected
                        ? 'text-danger-400 bg-danger-500/10'
                        : 'text-surface-300'
                    }
                  >
                    <td className="py-1.5 pr-2">{rep.index + 1}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {(rep.concentricMs / 1000).toFixed(1)} / {(rep.pauseMs / 1000).toFixed(1)} /{' '}
                      {(rep.eccentricMs / 1000).toFixed(1)}
                    </td>
                    <td className="py-1.5 pr-2">{rep.romDegrees.toFixed(0)}°</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {rep.meanHandleVelocity_mps.toFixed(2)} m/s
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {rep.peakAngularVelocity_radps.toFixed(2)} rad/s
                    </td>
                    <td className="py-1.5">
                      {rep.gyroAngle_vs_gravityAngle_errorDeg === null
                        ? '—'
                        : `${rep.gyroAngle_vs_gravityAngle_errorDeg.toFixed(1)}°`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rejected.length > 0 && (
            <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20 space-y-1">
              <p className="text-xs font-medium text-danger-400">Rejected reps</p>
              {rejected.map((rep) => (
                <p key={rep.index} className="text-xs text-danger-400/90">
                  Rep {rep.index + 1}: {rep.rejectReason}
                </p>
              ))}
            </div>
          )}

          {saveState === 'idle' || saveState === 'saving' ? (
            <>
              {attachableSets.length > 0 ? (
                <Select
                  label="Attach to set"
                  options={attachableSets}
                  placeholder="Select the set this capture belongs to"
                  value={attachSetId}
                  onChange={(e) => setAttachSetId(e.target.value)}
                />
              ) : (
                <div className="p-3 rounded-lg bg-surface-700/50">
                  <p className="text-xs text-surface-300">
                    No logged sets for this exercise in the active workout. Log the set first, then
                    save the capture — captures always attach to a set.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={discard} className="flex-1" data-testid="motion-discard">
                  Discard
                </Button>
                <Button
                  onClick={save}
                  isLoading={saveState === 'saving'}
                  disabled={!attachSetId || result.reps.length === 0}
                  className="flex-1"
                  data-testid="motion-save"
                >
                  Save
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-success-500/10 border border-success-500/20">
                <p className="text-sm text-success-400">
                  {saveState === 'synced'
                    ? 'Capture saved.'
                    : 'Capture queued — it will sync when you’re back online.'}
                </p>
                {rawNote && <p className="text-xs text-surface-400 mt-1">{rawNote}</p>}
              </div>
              <Button variant="secondary" onClick={discard} className="w-full">
                New capture
              </Button>
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

  // setup
  return (
    <Card data-testid="motion-capture-setup">
      <CardHeader>
        <CardTitle>Record a set</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {usableCalibrations.length === 0 ? (
          <p className="text-sm text-surface-400">
            {lockedExerciseId
              ? 'No calibration for this exercise yet — create one on the Motion Capture page first.'
              : 'No machine calibrations yet — create one below before recording.'}
          </p>
        ) : (
          <>
            <Select
              label="Machine calibration"
              options={usableCalibrations.map((c) => ({
                value: c.id,
                label: `${c.label} — ${exerciseNames[c.exerciseId] ?? 'Unknown exercise'}${
                  c.derivedRomDegrees != null ? ` (${Math.round(c.derivedRomDegrees)}° ROM)` : ''
                }`,
              }))}
              placeholder="Select calibration"
              value={calibrationId}
              onChange={(e) => setCalibrationId(e.target.value)}
            />
            <div>
              <p className="text-sm font-medium text-surface-300 mb-1.5">Side</p>
              <div className="flex gap-2">
                {(['left', 'right'] as CaptureSide[]).map((s) => (
                  <Button
                    key={s}
                    variant={side === s ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => setSide(s)}
                    className="flex-1 capitalize"
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>
            <p className="text-xs text-surface-500">
              Mount the phone exactly as it was calibrated, then arm. The screen goes dark; recording
              starts when the arm moves and stops after 5 s of stillness. You&apos;ll review before
              anything is saved.
            </p>
            <Button
              onClick={arm}
              disabled={!calibration}
              className="w-full"
              size="lg"
              data-testid="motion-arm"
            >
              ARM
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
