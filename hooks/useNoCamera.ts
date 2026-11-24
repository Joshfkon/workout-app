'use client';

import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { precheckWebCamera } from '@/lib/nutrition/cameraPrecheck';

/**
 * True when this (web) device lists its media devices and none is a camera,
 * so a Scan button should say up front that it will ask for the typed
 * barcode number instead. False on the server, on the first client render
 * (no hydration mismatch), on native, and whenever the browser can't tell.
 *
 * `enabled` lets a closed sheet skip the device listing.
 */
export function useNoCamera(enabled: boolean = true): boolean {
  const [noCamera, setNoCamera] = useState(false);
  useEffect(() => {
    if (!enabled || Capacitor.isNativePlatform()) return undefined;
    let cancelled = false;
    void precheckWebCamera(typeof navigator !== 'undefined' ? navigator : undefined).then((issue) => {
      if (!cancelled) setNoCamera(issue === 'missing');
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return noCamera;
}
