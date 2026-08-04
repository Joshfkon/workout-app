'use client';

/**
 * Motion capture flow (experimental): setup → ARM → record → review.
 *
 * Calibration is OPTIONAL: a quick capture needs nothing — recording is
 * analyzed by the calibration-free pipeline (services/shared/motion/
 * captureAnalysis) and reviewed as a chart + per-rep table + header strip,
 * with a raw CSV export. Selecting a machine calibration additionally
 * enables SAVING the capture against a logged set (the persisted metrics
 * come from the calibrated pipeline, which is what the stored schema and
 * its integrity checks were built around).
 *
 * Display-only telemetry: nothing here feeds prescription, progression, or
 * logged set data. Review never auto-commits.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Select } from '@/components/ui';
import { createUntypedClient } from '@/lib/supabase/client';
import { useUserStore, useWorkoutStore } from '@/stores';
import { formatWeight } from '@/lib/utils';
import { getSetDuration, getSetReps } from '@/services/shared/setModality';
import {
  requestMotionPermission,
  startMotionRecorder,
  tapLatencyMs,
  TAP_LATENCY_WARN_MS,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { captureToCsv, downloadTextFile } from '@/lib/motion/csv';
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
import { observationsViewedThisSession } from '@/lib/motion/observationsViewed';
import {
  LiveCaptureGate,
  analyzeCapture,
  dot,
  norm,
  processMotionSamples,
} from '@/services/shared/motion';
import {
  MOTION_PROVENANCE,
  MOTION_SCHEMA_VERSION,
  type CaptureSide,
  type ImuSample,
  type MachineCalibration,
  type MotionCapture,
} from '@/types/motion';
import { CaptureAnalysisView } from './CaptureAnalysisView';

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

/** Sentinel option value for a calibration-free quick capture. */
const QUICK_CAPTURE = '';

interface FinishedCapture {
  samples: ImuSample[];
  startedAtIso: string;
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
  const [calibrationId, setCalibrationId] = useState(QUICK_CAPTURE);
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
  const isMountedRef = useRef(true);

  const units = useUserStore((state) => state.user?.preferences.units ?? 'kg');
  const activeSession = useWorkoutStore((state) => state.activeSession);
  const exerciseBlocks = useWorkoutStore((state) => state.exerciseBlocks);
  const setLogs = useWorkoutStore((state) => state.setLogs);
  const sessionExercises = useWorkoutStore((state) => state.exercises);

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
    if (calibrationId === QUICK_CAPTURE && usableCalibrations.length === 1) {
      setCalibrationId(usableCalibrations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usableCalibrations]);

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
    if (lockedExerciseId && p.exerciseId !== null && p.exerciseId !== lockedExerciseId) return;
    setCalibrationId(
      p.calibrationId && calibrations.some((c) => c.id === p.calibrationId)
        ? p.calibrationId
        : QUICK_CAPTURE
    );
    setSide(p.side);
    startedAtIsoRef.current = p.startedAtIso;
    setFinished({ samples: p.samples, startedAtIso: p.startedAtIso });
    setAttachSetId('');
    setSaveState('idle');
    setRawNote(null);
    setStopTapLatencyMs(null);
    setStage('review');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calibration-free analysis: what the review screen displays.
  const analysis = useMemo(
    () => (finished ? analyzeCapture(finished.samples) : null),
    [finished]
  );

  // Calibrated pipeline output: what a SAVE persists (needs a calibration).
  const persistResult = useMemo(() => {
    if (!finished || !calibration) return null;
    return processMotionSamples({
      samples: finished.samples,
      pivotAxis: calibration.derivedPivotAxis,
      gravityRefBottom: calibration.gravityRefStart,
      mountRadiusMm: calibration.mountRadius_mm,
    });
  }, [finished, calibration]);

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
      .map(({ set: s }) => {
        // Modality-aware label: duration exercises store seconds in the reps
        // field (motion targets machines, but never render seconds as reps).
        const exercise = sessionExercises[calibration.exerciseId];
        const duration = getSetDuration(s, exercise);
        const amount = duration !== null ? `${duration}s` : `× ${getSetReps(s, exercise)}`;
        return {
          value: s.id,
          label: `Set ${s.setNumber} — ${formatWeight(s.weightKg, units)} ${amount}`,
        };
      });
  }, [calibration, exerciseBlocks, setLogs, units, defaultAttachBlockId, sessionExercises]);

  // Default the attach picker to the most recent set once reviewing (the
  // user can still change it; saving stays an explicit action).
  useEffect(() => {
    if (stage === 'review' && saveState === 'idle' && attachSetId === '' && attachableSets.length > 0) {
      setAttachSetId(attachableSets[0].value);
    }
  }, [stage, saveState, attachSetId, attachableSets]);

  const arm = async () => {
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
    // With a calibration the gate watches rotation about the known pivot;
    // without one, plain gyro magnitude works for onset/auto-stop.
    const pivotAxis = calibration?.derivedPivotAxis ?? null;

    recorderRef.current = startMotionRecorder((s) => {
      const rate = pivotAxis ? dot(s.gyro, pivotAxis) : norm(s.gyro);
      const state = gate.feed(s.tMs, rate);
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
    if (!recorder) return;
    setStopTapLatencyMs(fromTap ? tapLatencyMs(recorder) : null);
    const samples = recorder.stop();
    teardownSensors();

    // Held in module memory so navigating away before Save doesn't destroy
    // the capture (review still never auto-commits).
    setPendingCapture({
      calibrationId: calibration?.id ?? null,
      exerciseId: calibration?.exerciseId ?? lockedExerciseId ?? null,
      side,
      startedAtIso: startedAtIsoRef.current,
      samples,
    });
    setFinished({ samples, startedAtIso: startedAtIsoRef.current });
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

  const downloadCsv = () => {
    if (!finished) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`motion-capture-${stamp}.csv`, captureToCsv(finished.samples, analysis));
  };

  const save = async () => {
    if (!finished || !calibration || !attachSetId || !persistResult || !analysis) return;
    setSaveState('saving');
    setError(null);
    try {
      const capture: MotionCapture = {
        id: crypto.randomUUID(),
        setId: attachSetId,
        calibrationId: calibration.id,
        side,
        startedAt: finished.startedAtIso,
        durationMs: persistResult.durationMs,
        sampleRateHz_mean: persistResult.sampleRateHzMean,
        sampleRateHz_stddev: persistResult.sampleRateHzStddev,
        droppedSampleCount: persistResult.droppedSampleCount,
        clipDetected: persistResult.clipDetected,
        reps: persistResult.reps,
        qualityFlags: persistResult.qualityFlags,
        // Descriptive analysis metrics — the feature set for a future
        // velocity-loss → RIR fit; read by nothing today.
        analysisMetrics: {
          pc1VarianceShare: analysis.pc1VarianceShare,
          pc1GravityAngleDeg: analysis.pc1GravityAngleDeg,
          reps: analysis.reps.map((r) => ({
            index: r.index,
            romDeg: r.romConcentricDeg,
            meanConcentricW_radps: r.meanWConcentric,
            peakConcentricW_radps: r.peakW,
            bottomDwellMs: r.bottomDwellMs,
            turnaroundPeakAccel_radps2: r.turnaroundPeakAccelRadps2,
          })),
        },
        // Label-contamination flag for the future RIR fit — the manual path
        // must record it too, or manually saved captures all read as clean.
        priorObservationsViewedThisSession: activeSession
          ? observationsViewedThisSession(activeSession.id)
          : false,
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

  if (stage === 'review' && finished && analysis) {
    return (
      <Card data-testid="motion-review">
        <CardHeader>
          <CardTitle>Review capture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CaptureAnalysisView analysis={analysis} />

          <div className="flex items-center justify-between gap-2 text-xs text-surface-500">
            <span data-testid="motion-stop-latency">
              {stopTapLatencyMs !== null ? (
                <>
                  Sensor latency at stop tap: {Math.round(stopTapLatencyMs)} ms
                  {stopTapLatencyMs > TAP_LATENCY_WARN_MS && (
                    <span className="text-warning-400">
                      {' '}
                      — stale (&gt;{TAP_LATENCY_WARN_MS} ms; sensor delivery is lagging taps)
                    </span>
                  )}
                </>
              ) : (
                'Auto-stopped after rest'
              )}
            </span>
            <button
              type="button"
              onClick={downloadCsv}
              className="text-primary-400 hover:text-primary-300 whitespace-nowrap"
              data-testid="motion-download-csv"
            >
              Download raw capture (CSV)
            </button>
          </div>

          {saveState === 'idle' || saveState === 'saving' ? (
            <>
              {/* Save persists the CALIBRATED pipeline's metrics, which apply
                  stricter integrity checks than the display analysis above —
                  disclose exactly what will be stored so the explicit Save
                  never commits data the user was not shown. */}
              {calibration && persistResult && (
                <div
                  className={`p-3 rounded-lg ${
                    persistResult.reps.filter((r) => !r.rejected).length !== analysis.reps.length
                      ? 'bg-warning-500/10 border border-warning-500/20'
                      : 'bg-surface-700/50'
                  }`}
                  data-testid="motion-persist-summary"
                >
                  <p className="text-xs text-surface-300">
                    Save stores the calibrated pipeline&apos;s metrics:{' '}
                    <span className="font-medium">
                      {persistResult.reps.filter((r) => !r.rejected).length} rep
                      {persistResult.reps.filter((r) => !r.rejected).length === 1 ? '' : 's'}
                    </span>
                    {persistResult.reps.some((r) => r.rejected) &&
                      ` (${persistResult.reps.filter((r) => r.rejected).length} rejected: ${persistResult.reps
                        .filter((r) => r.rejected)
                        .map((r) => r.rejectReason)
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join('; ')})`}
                    .
                  </p>
                  {persistResult.reps.filter((r) => !r.rejected).length !== analysis.reps.length && (
                    <p className="mt-1 text-xs text-warning-400">
                      This differs from the {analysis.reps.length} rep
                      {analysis.reps.length === 1 ? '' : 's'} displayed above — the calibrated
                      pipeline applies stricter gravity-integrity checks before persisting.
                    </p>
                  )}
                </div>
              )}
              {calibration ? (
                attachableSets.length > 0 ? (
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
                      No logged sets for this exercise in the active workout. Log the set first,
                      then save the capture — captures always attach to a set.
                    </p>
                  </div>
                )
              ) : (
                <div className="p-3 rounded-lg bg-surface-700/50">
                  <p className="text-xs text-surface-300">
                    Quick capture — display only. Export the CSV to keep the data, or select a
                    machine calibration before recording to save captures against a set.
                  </p>
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={discard} className="flex-1" data-testid="motion-discard">
                  Discard
                </Button>
                {calibration && (
                  <Button
                    onClick={save}
                    isLoading={saveState === 'saving'}
                    disabled={!attachSetId || !persistResult || persistResult.reps.length === 0}
                    className="flex-1"
                    data-testid="motion-save"
                  >
                    Save
                  </Button>
                )}
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
        <Select
          label="Machine calibration"
          hint="Optional — a quick capture shows reps, velocity, and the chart without one. A calibration adds saved-to-set history and handle speed."
          options={[
            { value: QUICK_CAPTURE, label: 'Quick capture — no calibration (display only)' },
            ...usableCalibrations.map((c) => ({
              value: c.id,
              label: `${c.label} — ${exerciseNames[c.exerciseId] ?? 'Unknown exercise'}${
                c.derivedRomDegrees != null ? ` (${Math.round(c.derivedRomDegrees)}° ROM)` : ''
              }`,
            })),
          ]}
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
          Mount or hold the phone, then arm. The screen goes dark; recording starts when movement
          begins and stops after 5 s of stillness. You&apos;ll review before anything is saved.
        </p>
        <Button onClick={arm} className="w-full" size="lg" data-testid="motion-arm">
          ARM
        </Button>
        {error && (
          <div className="p-3 rounded-lg bg-danger-500/10 border border-danger-500/20">
            <p className="text-sm text-danger-400">{error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
