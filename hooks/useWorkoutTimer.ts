'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

const WORKOUT_TIMER_STORAGE_KEY = 'workout_timer_state';

/**
 * Persisted pause bookkeeping — the ONLY timer state that is ever written.
 *
 * The timer's start is NOT stored here: it is derived from the first logged
 * set's `loggedAt` (see `firstLoggedSetTime`), which lives with the set data
 * itself and survives navigation, backgrounding, and app kills. Because
 * elapsed time is recomputed from that durable anchor, losing or corrupting
 * this record can never reset the timer — at worst it forgets pause credit.
 */
interface WorkoutTimerState {
  /** Total ms spent in completed pauses (excluded from elapsed). */
  pausedTotalMs: number;
  /** Epoch ms when the current pause began, or null while running. */
  pausedAt: number | null;
}

/**
 * The single source of truth for "how long has this workout been active".
 *
 * Running: `now - anchor - pausedTotalMs`. Paused: the same formula frozen at
 * `pausedAt`. Both the live header timer AND the duration snapshotted at
 * finish go through this one function, so the summary/history can never
 * disagree with the timer the user watched.
 */
export function elapsedFromAnchor(
  anchorMs: number,
  state: WorkoutTimerState,
  nowMs: number
): number {
  const end = state.pausedAt ?? nowMs;
  return Math.max(0, Math.floor((end - anchorMs - state.pausedTotalMs) / 1000));
}

/**
 * The timer anchor for a session: the `loggedAt` of the FIRST logged set, or
 * null when nothing has been logged yet.
 *
 * A session with zero logged sets has no meaningful elapsed time — it may have
 * been created hours ago and left open. So the header timer (and the duration
 * snapshotted at finish) count from the first set, NOT from session creation.
 * Pass the result as `startedAt`: null keeps the timer at 0:00 until the user
 * actually logs something.
 */
export function firstLoggedSetTime(
  sets: ReadonlyArray<{ loggedAt?: string | null }>
): string | null {
  let earliestMs = Infinity;
  let earliest: string | null = null;
  for (const s of sets) {
    if (!s.loggedAt) continue;
    const ms = new Date(s.loggedAt).getTime();
    if (Number.isNaN(ms) || ms >= earliestMs) continue;
    earliestMs = ms;
    earliest = s.loggedAt;
  }
  return earliest;
}

/**
 * Interpret whatever is in storage as pause bookkeeping. Read-time only —
 * this never writes back; a legacy record is re-persisted in the new shape
 * the next time pause/resume runs.
 *
 * - Current shape (`pausedTotalMs` present): fields default ONLY when
 *   absent — an existing 0 or a real pausedAt passes through untouched.
 * - Legacy shape ({startTime, pausedAt-in-seconds, isPaused}): the old code
 *   rewound `startTime` forward on every resume, so `startTime - anchor` is
 *   exactly the accumulated pause credit. A legacy paused record froze the
 *   display at `pausedAt` seconds; reproduce that frozen value against the
 *   anchor.
 * - Anything unreadable: no pause credit (elapsed still correct via anchor).
 */
export function normalizeStoredState(
  parsed: unknown,
  anchorMs: number,
  nowMs: number
): WorkoutTimerState {
  const fresh: WorkoutTimerState = { pausedTotalMs: 0, pausedAt: null };
  if (typeof parsed !== 'object' || parsed === null) return fresh;
  const raw = parsed as Record<string, unknown>;

  if (raw.pausedTotalMs !== undefined) {
    // Current shape. Default a field only when it is absent.
    const pausedTotalMs =
      typeof raw.pausedTotalMs === 'number' && raw.pausedTotalMs >= 0
        ? raw.pausedTotalMs
        : 0;
    const pausedAt =
      typeof raw.pausedAt === 'number'
        ? Math.min(raw.pausedAt, nowMs) // clock skew: a future pause start clamps to now
        : null;
    return { pausedTotalMs, pausedAt };
  }

  if (typeof raw.startTime === 'number') {
    // Legacy shape (pausedAt was elapsed SECONDS at the moment of pause).
    if (raw.isPaused === true && typeof raw.pausedAt === 'number') {
      return {
        pausedTotalMs: Math.max(0, nowMs - anchorMs - raw.pausedAt * 1000),
        pausedAt: nowMs,
      };
    }
    return {
      pausedTotalMs: Math.max(0, raw.startTime - anchorMs),
      pausedAt: null,
    };
  }

  return fresh;
}

interface UseWorkoutTimerOptions {
  sessionId: string;
  startedAt: string | null; // loggedAt of the first logged set
}

export function useWorkoutTimer({ sessionId, startedAt }: UseWorkoutTimerOptions) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const stateRef = useRef<WorkoutTimerState | null>(null);

  // Generate storage key per session
  const storageKey = `${WORKOUT_TIMER_STORAGE_KEY}_${sessionId}`;

  // The derived timer start. Never persisted, never written by an effect —
  // it IS the first logged set's timestamp.
  const anchorMs = useMemo(() => {
    if (!startedAt) return null;
    const ms = new Date(startedAt).getTime();
    return Number.isNaN(ms) ? null : ms;
  }, [startedAt]);
  const anchorRef = useRef<number | null>(anchorMs);
  anchorRef.current = anchorMs;

  // Mount/return/rehydrate: READ pause bookkeeping and render. This effect
  // must never write timer state — a mount-time write is exactly the
  // "correct on first open, destructive on every return" trap.
  useEffect(() => {
    if (!sessionId || anchorMs === null) {
      stateRef.current = null;
      setElapsedSeconds(0);
      setIsPaused(false);
      return;
    }

    let state: WorkoutTimerState = { pausedTotalMs: 0, pausedAt: null };
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        state = normalizeStoredState(JSON.parse(stored), anchorMs, Date.now());
      }
    } catch (e) {
      // Unreadable storage forfeits pause credit only; elapsed stays anchored.
      console.error('Failed to restore workout timer pause state:', e);
    }

    stateRef.current = state;
    setElapsedSeconds(elapsedFromAnchor(anchorMs, state, Date.now()));
    setIsPaused(state.pausedAt !== null);
  }, [sessionId, anchorMs, storageKey]);

  // Tick while running. Recomputes from the anchor each second, so a frozen
  // interval (backgrounded app) catches up on the next tick.
  useEffect(() => {
    if (isPaused || anchorMs === null) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    if (!stateRef.current) return;

    intervalRef.current = setInterval(() => {
      const state = stateRef.current;
      const anchor = anchorRef.current;
      if (!state || state.pausedAt !== null || anchor === null) return;

      setElapsedSeconds(elapsedFromAnchor(anchor, state, Date.now()));
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPaused, anchorMs]);

  const persist = useCallback(
    (state: WorkoutTimerState) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (e) {
        console.error('Failed to persist workout timer pause state:', e);
      }
    },
    [storageKey]
  );

  const pause = useCallback(() => {
    const anchor = anchorRef.current;
    const state = stateRef.current;
    if (anchor === null || !state || state.pausedAt !== null) return;

    const newState: WorkoutTimerState = { ...state, pausedAt: Date.now() };
    stateRef.current = newState;
    setIsPaused(true);
    setElapsedSeconds(elapsedFromAnchor(anchor, newState, Date.now()));
    persist(newState);
  }, [persist]);

  const resume = useCallback(() => {
    const anchor = anchorRef.current;
    const state = stateRef.current;
    if (anchor === null || !state || state.pausedAt === null) return;

    const newState: WorkoutTimerState = {
      pausedTotalMs: state.pausedTotalMs + Math.max(0, Date.now() - state.pausedAt),
      pausedAt: null,
    };
    stateRef.current = newState;
    setIsPaused(false);
    setElapsedSeconds(elapsedFromAnchor(anchor, newState, Date.now()));
    persist(newState);
  }, [persist]);

  const toggle = useCallback(() => {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
  }, [isPaused, pause, resume]);

  const reset = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;

    const newState: WorkoutTimerState = { pausedTotalMs: 0, pausedAt: null };
    stateRef.current = newState;
    setElapsedSeconds(elapsedFromAnchor(anchor, newState, Date.now()));
    setIsPaused(false);
    persist(newState);
  }, [persist]);

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
