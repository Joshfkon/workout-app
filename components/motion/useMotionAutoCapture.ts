'use client';

/**
 * Automatic in-workout motion capture — no manual ARM/stop taps.
 *
 *   - ARMS while the workout page is open (IMU → rolling 3 s buffer, no
 *     capture object exists until motion qualifies).
 *   - STARTS when |gyro| holds above the enter threshold ≥ 200 ms,
 *     backfilled 500 ms before the crossing (AutoCaptureGate, pure).
 *   - DISARMS after 3 minutes without qualifying motion; `rearm()` (wired
 *     to card interactions) revives it.
 *   - STOPS externally: the "Log set" tap (or the manual fallback control)
 *     calls `stopAndCollect()`.
 *
 * iOS requires DeviceMotionEvent.requestPermission inside a user gesture,
 * so when permission has not been granted this page-load the hook reports
 * 'needs-permission' and arming waits for `enableFromGesture()` (a tap).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImuSample } from '@/types/motion';
import {
  requestMotionPermission,
  startMotionRecorder,
  type MotionRecorderHandle,
} from '@/lib/motion/deviceMotionRecorder';
import { acquireScreenWakeLock, type WakeLockHandle } from '@/lib/motion/wakeLock';
import { AutoCaptureGate, type AutoGateState } from '@/services/shared/motion';

export type AutoCaptureStatus = 'off' | 'needs-permission' | AutoGateState;

/** Once granted this page-load, auto-arm needs no further gesture. */
let permissionGrantedThisPageLoad = false;

function permissionGateExists(): boolean {
  if (typeof DeviceMotionEvent === 'undefined') return false;
  return (
    typeof (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission ===
    'function'
  );
}

export interface MotionAutoCapture {
  status: AutoCaptureStatus;
  /** Call from a tap when status is 'needs-permission'. */
  enableFromGesture: () => Promise<void>;
  /** Reset the disarm clock / revive from 'disarmed'. Cheap; call freely. */
  rearm: () => void;
  /** End the current capture and return its samples (null when none). */
  stopAndCollect: () => ImuSample[] | null;
}

export function useMotionAutoCapture(enabled: boolean): MotionAutoCapture {
  const [status, setStatus] = useState<AutoCaptureStatus>('off');
  const recorderRef = useRef<MotionRecorderHandle | null>(null);
  const gateRef = useRef<AutoCaptureGate | null>(null);
  const wakeLockRef = useRef<WakeLockHandle | null>(null);
  const statusRef = useRef<AutoCaptureStatus>('off');

  const setStatusBoth = (s: AutoCaptureStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const teardown = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    gateRef.current = null;
    wakeLockRef.current?.release();
    wakeLockRef.current = null;
  }, []);

  const startArm = useCallback(() => {
    teardown();
    const gate = new AutoCaptureGate();
    gateRef.current = gate;
    wakeLockRef.current = acquireScreenWakeLock();
    recorderRef.current = startMotionRecorder((s) => {
      const state = gate.feed(s);
      if (state !== statusRef.current) {
        if (state === 'disarmed') {
          // Stop burning battery; a rearm() revives everything.
          teardown();
        }
        setStatusBoth(state);
      }
    });
    setStatusBoth('armed');
  }, [teardown]);

  useEffect(() => {
    if (!enabled) {
      teardown();
      setStatusBoth('off');
      return;
    }
    if (permissionGateExists() && !permissionGrantedThisPageLoad) {
      setStatusBoth('needs-permission');
      return;
    }
    startArm();
    return teardown;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const enableFromGesture = useCallback(async () => {
    const permission = await requestMotionPermission();
    if (permission !== 'granted') return;
    permissionGrantedThisPageLoad = true;
    startArm();
  }, [startArm]);

  const rearm = useCallback(() => {
    if (!enabled || statusRef.current === 'off' || statusRef.current === 'needs-permission') return;
    if (statusRef.current === 'disarmed' || !recorderRef.current) {
      startArm();
    } else {
      gateRef.current?.rearm();
    }
  }, [enabled, startArm]);

  const stopAndCollect = useCallback((): ImuSample[] | null => {
    const gate = gateRef.current;
    if (!gate || gate.current() !== 'capturing') return null;
    const samples = gate.collect();
    // Immediately re-arm for the next set.
    startArm();
    return samples;
  }, [startArm]);

  return useMemo(
    () => ({ status, enableFromGesture, rearm, stopAndCollect }),
    [status, enableFromGesture, rearm, stopAndCollect]
  );
}
