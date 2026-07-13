/**
 * Tests for hooks/useWorkoutTimer.ts
 * Workout duration timer with pause/resume and persistence.
 *
 * Invariants under test (workout-timer-reset bug):
 * - Elapsed time is DERIVED from the first-set anchor; storage holds only
 *   pause bookkeeping. Losing storage can never reset the timer.
 * - Mount/return/rehydrate effects READ timer state; they never write it.
 * - Stored fields default only when absent, never overwritten on rehydrate.
 */

import { renderHook, act } from '@testing-library/react';
import {
  useWorkoutTimer,
  elapsedFromAnchor,
  firstLoggedSetTime,
  normalizeStoredState,
} from '../useWorkoutTimer';

describe('firstLoggedSetTime', () => {
  it('returns null for an empty session (no sets)', () => {
    expect(firstLoggedSetTime([])).toBeNull();
  });

  it('returns null when no set carries a loggedAt', () => {
    expect(firstLoggedSetTime([{ loggedAt: null }, {}])).toBeNull();
  });

  it('returns the earliest loggedAt regardless of array order', () => {
    const early = '2026-01-01T10:00:00.000Z';
    const late = '2026-01-01T11:30:00.000Z';
    expect(firstLoggedSetTime([{ loggedAt: late }, { loggedAt: early }])).toBe(early);
  });

  it('ignores unparseable timestamps', () => {
    const valid = '2026-01-01T10:00:00.000Z';
    expect(firstLoggedSetTime([{ loggedAt: 'nonsense' }, { loggedAt: valid }])).toBe(valid);
  });
});

describe('elapsedFromAnchor', () => {
  it('computes now - anchor - pausedTotal while running', () => {
    const state = { pausedTotalMs: 30_000, pausedAt: null };
    expect(elapsedFromAnchor(1_000_000, state, 1_000_000 + 120_000)).toBe(90);
  });

  it('freezes at pausedAt while paused, regardless of wall clock', () => {
    const state = { pausedTotalMs: 0, pausedAt: 1_000_000 + 1215_000 };
    // Wall clock says ~2h but the display is frozen at the pause moment.
    expect(elapsedFromAnchor(1_000_000, state, 1_000_000 + 7200_000)).toBe(1215);
  });

  it('never returns a negative elapsed', () => {
    const state = { pausedTotalMs: 0, pausedAt: null };
    expect(elapsedFromAnchor(5_000_000, state, 4_000_000)).toBe(0);
  });
});

describe('normalizeStoredState (rehydrate defaults & legacy migration)', () => {
  const anchor = 1_000_000;
  const now = anchor + 600_000; // 10 minutes in

  it('defaults only when fields are absent — a stored 0 passes through', () => {
    expect(normalizeStoredState({ pausedTotalMs: 0, pausedAt: null }, anchor, now))
      .toEqual({ pausedTotalMs: 0, pausedAt: null });
  });

  it('preserves accumulated pause credit on every rehydrate', () => {
    const stored = { pausedTotalMs: 120_000, pausedAt: null };
    // Rehydrating repeatedly must not zero pausedTotalMs.
    expect(normalizeStoredState(stored, anchor, now)).toEqual(stored);
    expect(normalizeStoredState(stored, anchor, now + 5000)).toEqual(stored);
  });

  it('preserves an in-flight pause (pausedAt) across rehydrate', () => {
    const stored = { pausedTotalMs: 60_000, pausedAt: anchor + 300_000 };
    expect(normalizeStoredState(stored, anchor, now)).toEqual(stored);
  });

  it('clamps a future pausedAt (clock skew) to now', () => {
    const stored = { pausedTotalMs: 0, pausedAt: now + 60_000 };
    expect(normalizeStoredState(stored, anchor, now).pausedAt).toBe(now);
  });

  it('migrates a legacy RUNNING record: startTime rewind becomes pause credit', () => {
    // Old code rewound startTime forward on resume; the rewind IS the total pause.
    const legacy = { startTime: anchor + 45_000, pausedAt: null, isPaused: false };
    expect(normalizeStoredState(legacy, anchor, now))
      .toEqual({ pausedTotalMs: 45_000, pausedAt: null });
  });

  it('migrates a legacy PAUSED record: display stays frozen at the same value', () => {
    // Legacy pausedAt was elapsed SECONDS at the pause moment.
    const legacy = { startTime: anchor, pausedAt: 60, isPaused: true };
    const migrated = normalizeStoredState(legacy, anchor, now);
    expect(migrated.pausedAt).not.toBeNull();
    expect(elapsedFromAnchor(anchor, migrated, now)).toBe(60);
  });

  it('clamps a legacy pre-anchor startTime (old session-creation regime) to zero credit', () => {
    const legacy = { startTime: anchor - 3_600_000, pausedAt: null, isPaused: false };
    expect(normalizeStoredState(legacy, anchor, now))
      .toEqual({ pausedTotalMs: 0, pausedAt: null });
  });

  it('falls back to no pause credit for garbage', () => {
    expect(normalizeStoredState(null, anchor, now)).toEqual({ pausedTotalMs: 0, pausedAt: null });
    expect(normalizeStoredState('junk', anchor, now)).toEqual({ pausedTotalMs: 0, pausedAt: null });
    expect(normalizeStoredState({ what: true }, anchor, now)).toEqual({ pausedTotalMs: 0, pausedAt: null });
  });
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: jest.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const timerWrites = () =>
  localStorageMock.setItem.mock.calls.filter((call: string[]) =>
    call[0].startsWith('workout_timer_state')
  );

describe('useWorkoutTimer', () => {
  const mockSessionId = 'session-123';

  beforeEach(() => {
    jest.useFakeTimers();
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const startedOneMinuteAgo = () => new Date(Date.now() - 60000).toISOString();

  // Anchor computed once per mount (default parameter), so it stays stable
  // across re-renders — matching the page, which passes a memoized ISO string.
  const mountTimer = (
    sessionId: string,
    startedAt: string | null = startedOneMinuteAgo()
  ) => renderHook(() => useWorkoutTimer({ sessionId, startedAt }));

  describe('initialization', () => {
    it('initializes with zero elapsed when no startedAt', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: null })
      );

      expect(result.current.elapsedSeconds).toBe(0);
      expect(result.current.isPaused).toBe(false);
    });

    it('calculates elapsed time from the first-set anchor', () => {
      const { result } = mountTimer(mockSessionId);

      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(60);
      expect(result.current.elapsedSeconds).toBeLessThanOrEqual(62);
    });

    it('restores a paused timer from a legacy localStorage record', () => {
      const startedAt = startedOneMinuteAgo();
      // Legacy shape: pausedAt was elapsed seconds at the pause moment.
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        JSON.stringify({ startTime: Date.now() - 120000, pausedAt: 60, isPaused: true })
      );

      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      expect(result.current.elapsedSeconds).toBe(60);
      expect(result.current.isPaused).toBe(true);
    });

    it('restores accumulated pause credit from a current-shape record', () => {
      const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        JSON.stringify({ pausedTotalMs: 2 * 60 * 1000, pausedAt: null })
      );

      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      // 10 minutes since first set minus 2 minutes paused.
      expect(result.current.elapsedSeconds).toBe(8 * 60);
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('mount is read-only', () => {
    it('does NOT write any timer field on a fresh session mount (no sets yet)', () => {
      renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: null })
      );

      expect(timerWrites()).toHaveLength(0);
    });

    it('does NOT write when the first set logs — the anchor lives with the set', () => {
      const { rerender } = renderHook(
        ({ startedAt }: { startedAt: string | null }) =>
          useWorkoutTimer({ sessionId: mockSessionId, startedAt }),
        { initialProps: { startedAt: null as string | null } }
      );

      rerender({ startedAt: new Date().toISOString() });
      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(timerWrites()).toHaveLength(0);
    });

    it('does NOT write on a return with existing stored state (rehydrate reads only)', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        JSON.stringify({ pausedTotalMs: 30_000, pausedAt: null })
      );
      jest.clearAllMocks();

      mountTimer(mockSessionId);

      expect(timerWrites()).toHaveLength(0);
    });
  });

  describe('return paths', () => {
    it('(a) in-app navigation: unmount, 10 minutes away, remount → prior elapsed + away time', () => {
      // First visit: page mounts before sets load, then set 1 logs.
      const first = renderHook(
        ({ startedAt }: { startedAt: string | null }) =>
          useWorkoutTimer({ sessionId: mockSessionId, startedAt }),
        { initialProps: { startedAt: null as string | null } }
      );
      const firstSetAt = new Date().toISOString();
      first.rerender({ startedAt: firstSetAt });

      act(() => {
        jest.advanceTimersByTime(30 * 60 * 1000); // train 30 minutes
      });
      expect(first.result.current.elapsedSeconds).toBe(30 * 60);
      first.unmount(); // navigate to Home

      act(() => {
        jest.advanceTimersByTime(10 * 60 * 1000); // away 10 minutes
      });

      // Return: fresh mount, sets load a moment later with the original anchor.
      const second = renderHook(
        ({ startedAt }: { startedAt: string | null }) =>
          useWorkoutTimer({ sessionId: mockSessionId, startedAt }),
        { initialProps: { startedAt: null as string | null } }
      );
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      second.rerender({ startedAt: firstSetAt });

      expect(second.result.current.elapsedSeconds).toBe(40 * 60 + 2);
      expect(second.result.current.isPaused).toBe(false);
    });

    it('(a2) remount preserves elapsed even when localStorage was wiped', () => {
      const firstSetAt = new Date().toISOString();
      const first = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: firstSetAt })
      );
      act(() => {
        jest.advanceTimersByTime(20 * 60 * 1000);
      });
      first.unmount();

      localStorageMock.clear(); // storage evicted while away

      const second = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: firstSetAt })
      );
      // Elapsed derives from the durable anchor, not from storage.
      expect(second.result.current.elapsedSeconds).toBe(20 * 60);
    });

    it('(b) background → foreground round trip preserves elapsed', () => {
      const firstSetAt = new Date().toISOString();
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: firstSetAt })
      );

      act(() => {
        jest.advanceTimersByTime(20 * 60 * 1000);
      });
      expect(result.current.elapsedSeconds).toBe(20 * 60);

      // Backgrounding freezes JS timers: wall clock advances 10 minutes with
      // no ticks, then the first foreground tick fires.
      jest.setSystemTime(Date.now() + 10 * 60 * 1000);
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(30 * 60);
      expect(result.current.isPaused).toBe(false);
    });

    it('(c) kill + rehydrate mid-pause: pausedAt persisted, elapsed correct on resume', () => {
      const firstSetAt = new Date().toISOString();
      const first = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: firstSetAt })
      );
      act(() => {
        jest.advanceTimersByTime(15 * 60 * 1000);
      });
      act(() => {
        first.result.current.pause();
      });
      expect(first.result.current.elapsedSeconds).toBe(15 * 60);

      // pausedAt must be in the persisted record so a kill can't lose the pause.
      const persisted = JSON.parse(
        localStorageMock.getItem(`workout_timer_state_${mockSessionId}`) as string
      );
      expect(typeof persisted.pausedAt).toBe('number');

      first.unmount(); // app killed

      act(() => {
        jest.advanceTimersByTime(30 * 60 * 1000); // relaunch 30 minutes later
      });
      const second = renderHook(
        ({ startedAt }: { startedAt: string | null }) =>
          useWorkoutTimer({ sessionId: mockSessionId, startedAt }),
        { initialProps: { startedAt: null as string | null } }
      );
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      second.rerender({ startedAt: firstSetAt });

      expect(second.result.current.isPaused).toBe(true);
      expect(second.result.current.elapsedSeconds).toBe(15 * 60);

      act(() => {
        second.result.current.resume();
      });
      act(() => {
        jest.advanceTimersByTime(60 * 1000);
      });
      expect(second.result.current.elapsedSeconds).toBe(16 * 60);
    });
  });

  describe('empty-session anchoring', () => {
    it('counts elapsed from the first logged set, not session creation', () => {
      // Empty session: no set logged yet, so no anchor.
      const { result, rerender } = renderHook(
        ({ startedAt }: { startedAt: string | null }) =>
          useWorkoutTimer({ sessionId: 'anchor-session', startedAt }),
        { initialProps: { startedAt: null as string | null } }
      );

      expect(result.current.elapsedSeconds).toBe(0);

      // 90 minutes pass with nothing logged — an idle, open session.
      act(() => {
        jest.advanceTimersByTime(90 * 60 * 1000);
      });
      expect(result.current.elapsedSeconds).toBe(0);

      // First set lands now → the timer anchors here.
      const firstSetAt = new Date(Date.now()).toISOString();
      rerender({ startedAt: firstSetAt });

      // Elapsed reflects the set, not the 90-minutes-ago session start.
      expect(result.current.elapsedSeconds).toBeLessThanOrEqual(1);

      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(5);
      expect(result.current.elapsedSeconds).toBeLessThanOrEqual(6);
    });
  });

  describe('counting', () => {
    it('counts up every second when running', () => {
      const { result } = mountTimer(mockSessionId);

      const initialSeconds = result.current.elapsedSeconds;

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.elapsedSeconds).toBe(initialSeconds + 5);
    });

    it('does not count when paused', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        result.current.pause();
      });

      const pausedSeconds = result.current.elapsedSeconds;

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.elapsedSeconds).toBe(pausedSeconds);
    });
  });

  describe('pause', () => {
    it('pauses the timer', () => {
      const { result } = mountTimer(mockSessionId);

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);
    });

    it('persists the pause start (epoch ms) to localStorage', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        result.current.pause();
      });

      const writes = timerWrites();
      expect(writes.length).toBeGreaterThan(0);
      const savedState = JSON.parse(writes[writes.length - 1][1]);
      expect(savedState.pausedAt).toBe(Date.now());
      expect(savedState.pausedTotalMs).toBe(0);
    });

    it('does nothing if already paused', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        result.current.pause();
      });

      const callCount = localStorageMock.setItem.mock.calls.length;

      act(() => {
        result.current.pause();
      });

      expect(localStorageMock.setItem.mock.calls.length).toBe(callCount);
    });

    it('does nothing before the first set logs (no anchor)', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: null })
      );

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(false);
      expect(timerWrites()).toHaveLength(0);
    });
  });

  describe('resume', () => {
    it('resumes the timer', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.resume();
      });

      expect(result.current.isPaused).toBe(false);
    });

    it('maintains elapsed time when resuming (paused time excluded)', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      const beforePause = result.current.elapsedSeconds;

      act(() => {
        result.current.pause();
      });

      act(() => {
        jest.advanceTimersByTime(5000); // Wait while paused
      });

      act(() => {
        result.current.resume();
      });

      // Should still have the same elapsed time (not counting paused time)
      expect(result.current.elapsedSeconds).toBe(beforePause);

      // The pause credit is persisted, never a rewritten start time.
      const writes = timerWrites();
      const savedState = JSON.parse(writes[writes.length - 1][1]);
      expect(savedState.pausedTotalMs).toBe(5000);
      expect(savedState.pausedAt).toBeNull();
    });

    it('does nothing if already running', () => {
      const { result } = mountTimer(mockSessionId);

      const callCount = localStorageMock.setItem.mock.calls.length;

      act(() => {
        result.current.resume();
      });

      expect(localStorageMock.setItem.mock.calls.length).toBe(callCount);
    });
  });

  describe('toggle', () => {
    it('toggles between paused and running', () => {
      const { result } = mountTimer(mockSessionId);

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.toggle();
      });

      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets pause bookkeeping so elapsed counts from the anchor again', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        jest.advanceTimersByTime(30000);
      });

      act(() => {
        result.current.pause();
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.isPaused).toBe(false);
      // Recalculated from the anchor (~90s ago by now).
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(60);
    });

    it('does nothing if no startedAt', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: null })
      );

      act(() => {
        result.current.reset();
      });

      expect(result.current.elapsedSeconds).toBe(0);
    });
  });

  describe('clearStorage', () => {
    it('removes timer state from localStorage', () => {
      const { result } = mountTimer(mockSessionId);

      act(() => {
        result.current.clearStorage();
      });

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        `workout_timer_state_${mockSessionId}`
      );
    });
  });

  describe('formattedTime', () => {
    it('formats time as MM:SS for less than an hour', () => {
      const startedAt = new Date(Date.now() - 90000).toISOString();
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      expect(result.current.formattedTime).toMatch(/^\d+:\d{2}$/);
    });

    it('formats time as HH:MM:SS for more than an hour', () => {
      const startedAt = new Date(Date.now() - 3900000).toISOString();
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      expect(result.current.formattedTime).toMatch(/^\d+:\d{2}:\d{2}$/);
    });
  });

  describe('session-specific storage', () => {
    it('writes pause state under a session-specific key', () => {
      const { result } = mountTimer('session-abc');

      act(() => {
        result.current.pause();
      });

      const setItemCalls = localStorageMock.setItem.mock.calls;
      const hasSessionKey = setItemCalls.some(
        (call: string[]) => call[0] === 'workout_timer_state_session-abc'
      );
      expect(hasSessionKey).toBe(true);
    });

    it('isolates state between different sessions', () => {
      // Session 1 was paused.
      localStorageMock.setItem(
        'workout_timer_state_session-1',
        JSON.stringify({ pausedTotalMs: 0, pausedAt: Date.now() - 60000 })
      );

      // Render hook for session 2 (should not get session 1's state)
      const { result } = mountTimer('session-2');

      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('error handling', () => {
    it('handles corrupted localStorage gracefully', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        'invalid-json'
      );

      expect(() => {
        mountTimer(mockSessionId);
      }).not.toThrow();
    });

    it('still derives elapsed from the anchor on localStorage error', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        'invalid-json'
      );

      const { result } = mountTimer(mockSessionId);

      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(60);
    });

    it('ticks after a corrupted-storage restore (timer must not freeze)', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        'invalid-json'
      );

      const { result } = mountTimer(mockSessionId);

      const before = result.current.elapsedSeconds;
      act(() => {
        jest.advanceTimersByTime(5000);
      });
      expect(result.current.elapsedSeconds).toBe(before + 5);
    });
  });
});
