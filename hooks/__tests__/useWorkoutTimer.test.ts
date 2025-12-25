/**
 * Tests for hooks/useWorkoutTimer.ts
 * Workout duration timer with pause/resume and persistence
 */

import { renderHook, act } from '@testing-library/react';
import { useWorkoutTimer } from '../useWorkoutTimer';

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

describe('useWorkoutTimer', () => {
  const mockSessionId = 'session-123';
  const mockStartedAt = new Date(Date.now() - 60000).toISOString(); // Started 1 minute ago

  beforeEach(() => {
    jest.useFakeTimers();
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('initializes with zero elapsed when no startedAt', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: null })
      );

      expect(result.current.elapsedSeconds).toBe(0);
      expect(result.current.isPaused).toBe(false);
    });

    it('calculates elapsed time from startedAt', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      // Should be approximately 60 seconds (started 1 minute ago)
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(60);
      expect(result.current.elapsedSeconds).toBeLessThanOrEqual(62);
    });

    it('restores paused state from localStorage', () => {
      const storedState = {
        startTime: Date.now() - 120000,
        pausedAt: 60,
        isPaused: true,
      };
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        JSON.stringify(storedState)
      );

      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      expect(result.current.elapsedSeconds).toBe(60);
      expect(result.current.isPaused).toBe(true);
    });

    it('restores running state from localStorage', () => {
      const startTime = Date.now() - 120000; // 2 minutes ago
      const storedState = {
        startTime,
        pausedAt: null,
        isPaused: false,
      };
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        JSON.stringify(storedState)
      );

      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      // Should be approximately 120 seconds
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(120);
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('counting', () => {
    it('counts up every second when running', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      const initialSeconds = result.current.elapsedSeconds;

      act(() => {
        jest.advanceTimersByTime(5000);
      });

      expect(result.current.elapsedSeconds).toBe(initialSeconds + 5);
    });

    it('does not count when paused', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

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
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);
    });

    it('saves paused state to localStorage', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      act(() => {
        result.current.pause();
      });

      expect(localStorageMock.setItem).toHaveBeenCalled();
      const savedState = JSON.parse(
        localStorageMock.setItem.mock.calls[
          localStorageMock.setItem.mock.calls.length - 1
        ][1]
      );
      expect(savedState.isPaused).toBe(true);
    });

    it('does nothing if already paused', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      act(() => {
        result.current.pause();
      });

      const callCount = localStorageMock.setItem.mock.calls.length;

      act(() => {
        result.current.pause();
      });

      expect(localStorageMock.setItem.mock.calls.length).toBe(callCount);
    });
  });

  describe('resume', () => {
    it('resumes the timer', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      act(() => {
        result.current.pause();
      });

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.resume();
      });

      expect(result.current.isPaused).toBe(false);
    });

    it('maintains elapsed time when resuming', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

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
    });

    it('does nothing if already running', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      const callCount = localStorageMock.setItem.mock.calls.length;

      act(() => {
        result.current.resume();
      });

      expect(localStorageMock.setItem.mock.calls.length).toBe(callCount);
    });
  });

  describe('toggle', () => {
    it('toggles between paused and running', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

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
    it('resets timer to startedAt time', () => {
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      // Advance time
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
      // Should be recalculated from startedAt
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
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

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
      // Mock startedAt to be exactly 1 minute 30 seconds ago
      const startedAt = new Date(Date.now() - 90000).toISOString();
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      expect(result.current.formattedTime).toMatch(/^\d+:\d{2}$/);
    });

    it('formats time as HH:MM:SS for more than an hour', () => {
      // Mock startedAt to be exactly 1 hour 5 minutes ago
      const startedAt = new Date(Date.now() - 3900000).toISOString();
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt })
      );

      expect(result.current.formattedTime).toMatch(/^\d+:\d{2}:\d{2}$/);
    });
  });

  describe('session-specific storage', () => {
    it('uses session-specific storage key', () => {
      renderHook(() =>
        useWorkoutTimer({ sessionId: 'session-abc', startedAt: mockStartedAt })
      );

      // Should use session-specific key
      const setItemCalls = localStorageMock.setItem.mock.calls;
      const hasSessionKey = setItemCalls.some(
        (call: string[]) => call[0] === 'workout_timer_state_session-abc'
      );
      expect(hasSessionKey).toBe(true);
    });

    it('isolates state between different sessions', () => {
      // Set state for session 1
      const session1State = {
        startTime: Date.now() - 120000,
        pausedAt: 60,
        isPaused: true,
      };
      localStorageMock.setItem(
        'workout_timer_state_session-1',
        JSON.stringify(session1State)
      );

      // Render hook for session 2 (should not get session 1's state)
      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: 'session-2', startedAt: mockStartedAt })
      );

      // Session 2 should not be paused (session 1 was paused)
      expect(result.current.isPaused).toBe(false);
    });
  });

  describe('error handling', () => {
    it('handles corrupted localStorage gracefully', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        'invalid-json'
      );

      // Should not throw
      expect(() => {
        renderHook(() =>
          useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
        );
      }).not.toThrow();
    });

    it('falls back to startedAt on localStorage error', () => {
      localStorageMock.setItem(
        `workout_timer_state_${mockSessionId}`,
        'invalid-json'
      );

      const { result } = renderHook(() =>
        useWorkoutTimer({ sessionId: mockSessionId, startedAt: mockStartedAt })
      );

      // Should still calculate elapsed from startedAt
      expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(60);
    });
  });
});
