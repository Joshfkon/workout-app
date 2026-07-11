'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const WORKOUT_TIMER_STORAGE_KEY = 'workout_timer_state';

/**
 * Persisted timer state — the robust model.
 *
 * - `startTime` is IMMUTABLE for the life of the session (never rewritten on
 *   resume). Elapsed is always derived from it.
 * - `pausedTotalMs` accumulates all completed pause spans.
 * - `pausedAt` is the wall-clock timestamp (epoch ms) of the CURRENT pause, or
 *   null when running.
 *
 * elapsed = now − startTime − pausedTotalMs − (pausedAt ? now − pausedAt : 0)
 *
 * Because every field is a timestamp/accumulator (never a snapshot of React
 * state), the elapsed value survives remounts, reloads, and app-kill/restore
 * mid-pause without discarding accumulated time.
 */
interface WorkoutTimerState {
  startTime: number;        // Immutable session start (epoch ms)
  pausedTotalMs: number;    // Accumulated completed-pause duration
  pausedAt: number | null;  // Timestamp of current pause, or null when running
}

/**
 * Legacy persisted shape (pre-fix). `pausedAt` here was elapsed SECONDS at the
 * moment of pause (not a timestamp), and `startTime` was rewritten on resume.
 * We migrate it forward so old sessions don't read a seconds value as an epoch
 * timestamp.
 */
interface LegacyTimerState {
  startTime: number;
  pausedAt: number | null; // elapsed seconds at pause
  isPaused: boolean;
}

interface UseWorkoutTimerOptions {
  sessionId: string;
  startedAt: string | null; // ISO date string from session
}

function isLegacyState(value: unknown): value is LegacyTimerState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isPaused' in value &&
    !('pausedTotalMs' in value)
  );
}

/**
 * Bring any persisted payload into the current shape. Legacy states are
 * converted so that the derived elapsed time is preserved exactly:
 * we pin `startTime` so that `now − startTime` equals the elapsed time the
 * legacy state represented, with pauses folded into `pausedTotalMs`/`pausedAt`.
 */
function normalizeState(raw: unknown, now: number): WorkoutTimerState | null {
  if (isLegacyState(raw)) {
    if (raw.isPaused && raw.pausedAt !== null) {
      // Was paused at `pausedAt` elapsed seconds. Reconstruct so elapsed reads
      // exactly that, and stays frozen (paused-now) until resume.
      const elapsedMs = Math.max(0, raw.pausedAt) * 1000;
      return {
        startTime: now - elapsedMs,
        pausedTotalMs: 0,
        pausedAt: now,
      };
    }
    // Was running: legacy `startTime` already had past pauses folded in via the
    // old resume-shifts-startTime scheme, so carry it forward directly.
    return {
      startTime: raw.startTime,
      pausedTotalMs: 0,
      pausedAt: null,
    };
  }

  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as WorkoutTimerState).startTime === 'number'
  ) {
    const state = raw as WorkoutTimerState;
    return {
      startTime: state.startTime,
      pausedTotalMs: typeof state.pausedTotalMs === 'number' ? state.pausedTotalMs : 0,
      pausedAt: typeof state.pausedAt === 'number' ? state.pausedAt : null,
    };
  }

  return null;
}

/** Elapsed seconds derived from the timer state — the single source of truth. */
function deriveElapsedSeconds(state: WorkoutTimerState, now: number): number {
  const pausedNow = state.pausedAt !== null ? now - state.pausedAt : 0;
  const elapsedMs = now - state.startTime - state.pausedTotalMs - pausedNow;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

export function useWorkoutTimer({ sessionId, startedAt }: UseWorkoutTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef<WorkoutTimerState | null>(null);

  // Generate storage key per session
  const storageKey = `${WORKOUT_TIMER_STORAGE_KEY}_${sessionId}`;

  const persist = useCallback(
    (state: WorkoutTimerState) => {
      stateRef.current = state;
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (e) {
        console.error('Failed to persist workout timer state:', e);
      }
    },
    [storageKey]
  );

  // Load saved state or initialize from startedAt
  useEffect(() => {
    if (!sessionId || !startedAt) return;

    const now = Date.now();
    try {
      const stored = localStorage.getItem(storageKey);
      const normalized = stored ? normalizeState(JSON.parse(stored), now) : null;

      if (normalized) {
        // Re-persist so any migrated/legacy shape is written back in the new
        // format (and so a migrated pause keeps its reconstructed startTime).
        persist(normalized);
        setElapsedSeconds(deriveElapsedSeconds(normalized, now));
        setIsPaused(normalized.pausedAt !== null);
      } else {
        // No saved state — initialize from the session's start timestamp.
        const startTime = new Date(startedAt).getTime();
        const initial: WorkoutTimerState = {
          startTime,
          pausedTotalMs: 0,
          pausedAt: null,
        };
        persist(initial);
        setElapsedSeconds(deriveElapsedSeconds(initial, now));
        setIsPaused(false);
      }
    } catch (e) {
      console.error('Failed to restore workout timer state:', e);
      // Fallback to startedAt
      const startTime = new Date(startedAt).getTime();
      const initial: WorkoutTimerState = { startTime, pausedTotalMs: 0, pausedAt: null };
      stateRef.current = initial;
      setElapsedSeconds(deriveElapsedSeconds(initial, now));
      setIsPaused(false);
    }
  }, [sessionId, startedAt, storageKey, persist]);

  // Tick every second while running. Elapsed is always recomputed from the
  // immutable timer state, so throttled/backgrounded intervals self-correct on
  // the next tick rather than drifting.
  useEffect(() => {
    if (isPaused || !startedAt) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!stateRef.current) return;

    intervalRef.current = setInterval(() => {
      const state = stateRef.current;
      if (!state || state.pausedAt !== null) return;
      setElapsedSeconds(deriveElapsedSeconds(state, Date.now()));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused, startedAt]);

  const pause = useCallback(() => {
    const state = stateRef.current;
    if (!state || state.pausedAt !== null) return;

    const now = Date.now();
    persist({ ...state, pausedAt: now });
    // Freeze the display at the exact elapsed value as of the pause.
    setElapsedSeconds(deriveElapsedSeconds(state, now));
    setIsPaused(true);
  }, [persist]);

  const resume = useCallback(() => {
    const state = stateRef.current;
    if (!state || state.pausedAt === null) return;

    const now = Date.now();
    // Fold the just-completed pause span into the accumulator; startTime is
    // never touched, so no elapsed time is discarded.
    const next: WorkoutTimerState = {
      startTime: state.startTime,
      pausedTotalMs: state.pausedTotalMs + (now - state.pausedAt),
      pausedAt: null,
    };
    persist(next);
    setElapsedSeconds(deriveElapsedSeconds(next, now));
    setIsPaused(false);
  }, [persist]);

  const toggle = useCallback(() => {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isPaused, pause, resume]);

  const reset = useCallback(() => {
    if (!startedAt) return;

    const now = Date.now();
    const initial: WorkoutTimerState = {
      startTime: new Date(startedAt).getTime(),
      pausedTotalMs: 0,
      pausedAt: null,
    };
    persist(initial);
    setElapsedSeconds(deriveElapsedSeconds(initial, now));
    setIsPaused(false);
  }, [startedAt, persist]);

  const clearStorage = useCallback(() => {
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Format elapsed time as HH:MM:SS or MM:SS
  const formatTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    elapsedSeconds,
    formattedTime: formatTime(elapsedSeconds),
    isPaused,
    pause,
    resume,
    toggle,
    reset,
    clearStorage,
  };
}
