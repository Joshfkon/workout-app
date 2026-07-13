'use client';

import { useEffect, useState, useCallback } from 'react';
import { createUntypedClient } from '@/lib/supabase/client';

/**
 * Theme system source of truth.
 *
 * The user picks a ThemePreference (dark / light / system); "system" follows
 * the OS via prefers-color-scheme. The resolved theme is written to the
 * `data-theme` attribute on <html> ("dark" or "light" — always explicit, the
 * Tailwind darkMode selector and globals.css both key off it).
 *
 * Persistence is two-layer:
 * - localStorage 'theme' — read pre-paint by the no-FOUC script in
 *   app/layout.tsx, so there is never a flash of the wrong theme.
 * - users.preferences.theme (Supabase JSONB) — so the choice survives
 *   localStorage eviction (iOS WebKit clears it after ~7 days) and syncs
 *   across browser / PWA / native app. On boot, a signed-in user's server
 *   value wins over localStorage; every toggle pushes to the server, so any
 *   divergence means the local copy is stale.
 *
 * All mounted toggles share one module-level state (same pattern as
 * useUserPreferences), so the settings control, the dashboard header, and
 * the homepage nav never disagree.
 */

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
const DEFAULT_PREFERENCE: ThemePreference = 'dark';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'dark' || value === 'light' || value === 'system';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyToDocument(preference: ThemePreference) {
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_PREFERENCE;
  } catch {
    return DEFAULT_PREFERENCE;
  }
}

// ---- Module-level shared state (one theme for all mounted hooks) ----
let globalPreference: ThemePreference | null = null;
const listeners = new Set<(pref: ThemePreference) => void>();
// Bumped on every user-initiated change; lets the async server reconcile
// detect that it lost the race and must not clobber a fresh local choice.
let localWriteSeq = 0;
let serverSyncStarted = false;

function setGlobalPreference(preference: ThemePreference, persistLocal: boolean) {
  globalPreference = preference;
  applyToDocument(preference);
  if (persistLocal) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Private mode / quota — in-memory + data-theme still work for this page.
    }
  }
  listeners.forEach((listener) => listener(preference));
}

function ensureInitialized(): ThemePreference {
  if (globalPreference !== null) return globalPreference;
  const initial = readStoredPreference();
  setGlobalPreference(initial, false);

  // In system mode, re-resolve when the OS theme flips (e.g. sunset).
  try {
    window
      .matchMedia('(prefers-color-scheme: light)')
      .addEventListener('change', () => {
        if (globalPreference === 'system') applyToDocument('system');
      });
  } catch {
    // matchMedia unavailable (old WebView) — system mode degrades to dark.
  }

  // Another tab changed the preference — mirror it without re-persisting.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && isThemePreference(event.newValue)) {
      setGlobalPreference(event.newValue, false);
    }
  });

  return initial;
}

/** Merge the theme into users.preferences without dropping other keys. */
async function pushPreferenceToServer(preference: ThemePreference) {
  try {
    const supabase = createUntypedClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return; // Logged out (e.g. marketing page): local only.

    const { data } = await supabase
      .from('users')
      .select('preferences')
      .eq('id', session.user.id)
      .single();
    const currentPrefs = (data?.preferences as Record<string, unknown>) || {};
    await supabase
      .from('users')
      .update({ preferences: { ...currentPrefs, theme: preference } })
      .eq('id', session.user.id);
  } catch {
    // Offline or transient failure: localStorage still holds the choice and
    // the next successful toggle re-syncs the server.
  }
}

/**
 * One-shot reconcile on boot: a signed-in user's server preference wins over
 * localStorage (which may have been evicted or belong to a stale device),
 * unless the user toggled while this fetch was in flight.
 */
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
    const serverTheme = (data?.preferences as Record<string, unknown> | null)?.theme;
    if (!isThemePreference(serverTheme)) return;
    if (localWriteSeq !== seqAtStart) return; // User toggled meanwhile — they win.
    if (serverTheme !== globalPreference) {
      setGlobalPreference(serverTheme, true);
    }
  } catch {
    // Can't reach the server — keep whatever localStorage said.
  }
}

export function useTheme() {
  // Start from the default so the server render and first client render
  // match; the real preference lands in the mount effect below.
  const [theme, setThemeState] = useState<ThemePreference>(DEFAULT_PREFERENCE);

  useEffect(() => {
    setThemeState(ensureInitialized());
    const listener = (pref: ThemePreference) => setThemeState(pref);
    listeners.add(listener);

    if (!serverSyncStarted) {
      serverSyncStarted = true;
      void reconcileFromServer();
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  const setTheme = useCallback((preference: ThemePreference) => {
    localWriteSeq += 1;
    setGlobalPreference(preference, true);
    void pushPreferenceToServer(preference);
  }, []);

  return { theme, setTheme };
}

/** Test-only: reset module state between test cases. */
export function __resetThemeStateForTests() {
  globalPreference = null;
  listeners.clear();
  localWriteSeq = 0;
  serverSyncStarted = false;
}
