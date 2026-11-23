'use client';

import { useCallback, useEffect, useState } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_STORAGE_KEY,
  applyTextSizeToDocument,
  isTextSize,
  type TextSize,
} from '@/lib/textSize';

/**
 * Text size source of truth (same shape as hooks/useTheme.ts).
 *
 * - localStorage 'textSize' is read pre-paint by TEXT_SIZE_BOOT_SCRIPT in
 *   app/layout.tsx, so the saved size is on <html> before anything renders.
 * - users.preferences.textSize (Supabase JSONB) carries it across devices
 *   and survives localStorage eviction. On boot a signed-in user's server
 *   value wins, unless the user changed the size while that read was in
 *   flight; every change is pushed to the server.
 *
 * All mounted hooks share one module-level value, so the Settings control,
 * the onboarding preview and the dashboard's sync never disagree.
 */

let globalSize: TextSize | null = null;
const listeners = new Set<(size: TextSize) => void>();
let localWriteSeq = 0;
let serverSyncStarted = false;

function readStoredSize(): TextSize {
  try {
    const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    return isTextSize(stored) ? stored : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

function setGlobalSize(size: TextSize, persistLocal: boolean) {
  globalSize = size;
  applyTextSizeToDocument(size);
  if (persistLocal) {
    try {
      localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
    } catch {
      // Private mode / quota: the attribute still applies for this page.
    }
  }
  listeners.forEach((listener) => listener(size));
}

function ensureInitialized(): TextSize {
  if (globalSize !== null) return globalSize;
  const initial = readStoredSize();
  setGlobalSize(initial, false);
  // Another tab changed it: mirror without re-persisting.
  window.addEventListener('storage', (event) => {
    if (event.key === TEXT_SIZE_STORAGE_KEY && isTextSize(event.newValue)) {
      setGlobalSize(event.newValue, false);
    }
  });
  return initial;
}

/** Merge textSize into users.preferences without dropping other keys. */
async function pushSizeToServer(size: TextSize) {
  try {
    const supabase = createUntypedClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('users')
      .select('preferences')
      .eq('id', session.user.id)
      .single();
    const current = (data?.preferences as Record<string, unknown>) || {};
    await supabase
      .from('users')
      .update({ preferences: { ...current, textSize: size } })
      .eq('id', session.user.id);
  } catch {
    // Offline: localStorage keeps the choice; the next change re-syncs.
  }
}

async function reconcileFromServer() {
  const seqAtStart = localWriteSeq;
  try {
    const supabase = createUntypedClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    const { data } = await supabase
      .from('users')
      .select('preferences')
      .eq('id', session.user.id)
      .single();
    const serverSize = (data?.preferences as Record<string, unknown> | null)?.textSize;
    if (!isTextSize(serverSize)) return;
    if (localWriteSeq !== seqAtStart) return; // Changed meanwhile: the user wins.
    if (serverSize !== globalSize) setGlobalSize(serverSize, true);
  } catch {
    // Can't reach the server: keep what localStorage said.
  }
}

export function useTextSize() {
  // Default for the server render and first client render; the real value
  // lands in the effect. (The page itself is already at the right size: the
  // boot script set the attribute before paint.)
  const [textSize, setTextSizeState] = useState<TextSize>(DEFAULT_TEXT_SIZE);

  useEffect(() => {
    setTextSizeState(ensureInitialized());
    const listener = (size: TextSize) => setTextSizeState(size);
    listeners.add(listener);
    if (!serverSyncStarted) {
      serverSyncStarted = true;
      void reconcileFromServer();
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setTextSize = useCallback((size: TextSize) => {
    localWriteSeq += 1;
    setGlobalSize(size, true);
    void pushSizeToServer(size);
  }, []);

  return { textSize, setTextSize };
}

/**
 * Mounted once in the dashboard shell: pulls a size saved on another device
 * (users.preferences.textSize) even when no text-size control is on screen.
 */
export function TextSizeSync() {
  useTextSize();
  return null;
}

/** Test-only: reset module state between test cases. */
export function __resetTextSizeStateForTests() {
  globalSize = null;
  listeners.clear();
  localWriteSeq = 0;
  serverSyncStarted = false;
}
