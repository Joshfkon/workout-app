'use client';

/**
 * Explicit Start/Stop motion capture for the active set (replaces the old
 * automatic trigger — nothing records until the lifter taps Start).
 *
 *   needs-permission : iOS gates devicemotion behind a user gesture.
 *   waiting          : sensor not streaming, or the phone isn't still
 *                      (mounted) — Start is not offered.
 *   ready            : streaming and mounted — "Start capture" shows.
 *   recording        : capturing; `liveReps` updates for "Stop · n".
 *
 * The safety auto-stop (no motion for MOTION_SET_CONFIG.capture.
 * autoStopQuietMs after ≥ 1 rep) ends the capture on its own and reports
 * it through `onAutoStop`, with the end backdated to the last rep.
 *
 * Browser-only shell: every decision (mounted, auto-stop, trim, gating)
 * is in services/shared/motion/manualCapture.ts.
 *
 * Background: devicemotion is not delivered while the page is hidden or
 * the screen is locked (iOS Safari/PWA and the Capacitor WKWebView alike),
 * so a lock mid-set leaves a gap in the samples. The screen wake lock held
 * while recording prevents auto-lock; a manual lock shows up as a pause,
 * which the confidence gating splits on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImuSample } from '@/types/motion';
import {
  requestMotionPermission,
  startMotionRecorder,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { acquireScreenWakeLock, type WakeLockHandle } from '@/lib/motion/wakeLock';
import {
  finishManualCapture,
  isMountedNow,
  liveRepCount,
  ManualCaptureClock,
  MOTION_SET_CONFIG,
  type FinishedCapture,
} from '@/services/shared/motion';

export type SetCaptureStatus = 'off' | 'needs-permission' | 'waiting' | 'ready' | 'recording';

export interface StoppedCapture extends FinishedCapture {
  /** ms between the real end of the set and now (rest-timer backdating). */
  endedAgoMs: number;
  autoStopped: boolean;
}

export interface MotionSetCapture {
  status: SetCaptureStatus;
  liveReps: number;
  enableFromGesture: () => Promise<void>;
  start: () => void;
  /** Manual stop. Returns the processed capture (null when not recording). */
  stop: () => StoppedCapture | null;
  /** Abandon a recording without processing it. */
  cancel: () => void;
}

/** Samples kept before Start so rep 1's ramp isn't clipped. */
const BACKFILL_MS = 500;

let permissionGrantedThisPageLoad = false;

function permissionGateExists(): boolean {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  return (
    typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission ===
    'function'
  );
}

export function useMotionSetCapture(
  enabled: boolean,
  onAutoStop: (capture: StoppedCapture) => void
): MotionSetCapture {
  const cfg = MOTION_SET_CONFIG.capture;
  const [status, setStatus] = useState<SetCaptureStatus>('off');
  const [liveReps, setLiveReps] = useState(0);
  const statusRef = useRef<SetCaptureStatus>('off');
  const recorderRef = useRef<MotionRecorderHandle | null>(null);
  const recentRef = useRef<ImuSample[]>([]);
  const captureRef = useRef<ImuSample[]>([]);
  const clockRef = useRef<ManualCaptureClock | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onAutoStopRef = useRef(onAutoStop);
  onAutoStopRef.current = onAutoStop;

  const setStatusBoth = useCallback((s: SetCaptureStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const monitorStatus = useCallback((): SetCaptureStatus => {
    const recent = recentRef.current;
    const last = recent[recent.length - 1];
    const live = !!last && performance.now() - last.tMs < cfg.sensorStaleMs;
    return live && isMountedNow(recent) ? 'ready' : 'waiting';
  }, [cfg.sensorStaleMs]);

  const stopTicking = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  };

  const endRecording = useCallback(
    (auto: boolean): StoppedCapture | null => {
      if (statusRef.current !== 'recording') return null;
      stopTicking();
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
      const samples = captureRef.current;
      captureRef.current = [];
      const clock = clockRef.current;
      clockRef.current = null;
      setLiveReps(0);
      setStatusBoth(monitorStatus());
      const finished = finishManualCapture(samples, auto ? clock?.lastMotion() ?? null : null);
      return {
        ...finished,
        endedAgoMs: finished.endTMs !== null ? Math.max(0, performance.now() - finished.endTMs) : 0,
        autoStopped: auto,
      };
    },
    [monitorStatus, setStatusBoth]
  );

  // Monitor: streams while enabled so "mounted" and "connected" are live.
  const startMonitor = useCallback(() => {
    recorderRef.current?.stop();
    recentRef.current = [];
    recorderRef.current = startMotionRecorder(
      (s) => {
        if (statusRef.current === 'recording') {
          captureRef.current.push(s);
          clockRef.current?.feed(s);
          return;
        }
        const recent = recentRef.current;
        recent.push(s);
        const cutoff = s.tMs - Math.max(cfg.mountedHoldMs, BACKFILL_MS) - 200;
        while (recent.length > 0 && recent[0].tMs < cutoff) recent.shift();
      },
      { retainSamples: false }
    );
    setStatusBoth('waiting');
  }, [cfg.mountedHoldMs, setStatusBoth]);

  // Re-evaluate ready/waiting a few times a second (cheap: a 1 s window).
  useEffect(() => {
    if (status !== 'waiting' && status !== 'ready') return;
    const id = setInterval(() => {
      if (statusRef.current === 'recording') return;
      const next = monitorStatus();
      if (next !== statusRef.current) setStatusBoth(next);
    }, 250);
    return () => clearInterval(id);
  }, [status, monitorStatus, setStatusBoth]);

  useEffect(() => {
    if (!enabled) {
      setStatusBoth('off');
      return;
    }
    if (permissionGateExists() && !permissionGrantedThisPageLoad) {
      setStatusBoth('needs-permission');
      return;
    }
    startMonitor();
    return () => {
      stopTicking();
      recorderRef.current?.stop();
      recorderRef.current = null;
      wakeLockRef.current?.release();
      wakeLockRef.current = null;
      captureRef.current = [];
      statusRef.current = 'off';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const enableFromGesture = useCallback(async () => {
    const permission = await requestMotionPermission();
    if (permission !== 'granted') return;
    permissionGrantedThisPageLoad = true;
    startMonitor();
  }, [startMonitor]);

  const start = useCallback(() => {
    // 'waiting' is accepted too: the tap itself can jiggle a mounted phone
    // out of "still" between the render and the click. A live sensor is
    // still required.
    if (statusRef.current !== 'ready' && statusRef.current !== 'waiting') return;
    const lastT = recentRef.current[recentRef.current.length - 1]?.tMs;
    if (lastT === undefined || performance.now() - lastT >= cfg.sensorStaleMs) return;
    const backfillFrom = lastT - BACKFILL_MS;
    const clock = new ManualCaptureClock();
    captureRef.current = recentRef.current.filter((s) => s.tMs >= backfillFrom);
    for (const s of captureRef.current) clock.feed(s);
    clockRef.current = clock;
    wakeLockRef.current = acquireScreenWakeLock();
    setLiveReps(0);
    setStatusBoth('recording');
    tickRef.current = setInterval(() => {
      const reps = liveRepCount(captureRef.current);
      setLiveReps(reps);
      if (clockRef.current?.shouldAutoStop(reps)) {
        const result = endRecording(true);
        if (result) onAutoStopRef.current(result);
      }
    }, cfg.liveRepIntervalMs);
  }, [cfg.liveRepIntervalMs, cfg.sensorStaleMs, endRecording, setStatusBoth]);

  const stop = useCallback(() => endRecording(false), [endRecording]);

  const cancel = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    stopTicking();
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
    captureRef.current = [];
    clockRef.current = null;
    setLiveReps(0);
    setStatusBoth(monitorStatus());
  }, [monitorStatus, setStatusBoth]);

  return useMemo(
    () => ({ status, liveReps, enableFromGesture, start, stop, cancel }),
    [status, liveReps, enableFromGesture, start, stop, cancel]
  );
}
