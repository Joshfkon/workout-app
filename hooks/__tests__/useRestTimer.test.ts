/**
 * Tests for hooks/useRestTimer.ts
 * Rest timer hook with countdown, pause/resume, and persistence
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useRestTimer } from '../useRestTimer';

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

// Mock AudioContext
const mockAudioContext = {
  createOscillator: jest.fn(() => ({
    connect: jest.fn(),
    frequency: { value: 0 },
    type: '',
    start: jest.fn(),
    stop: jest.fn(),
  })),
  createGain: jest.fn(() => ({
    connect: jest.fn(),
    gain: { value: 0 },
  })),
  destination: {},
  close: jest.fn(),
};

(window as any).AudioContext = jest.fn(() => mockAudioContext);

// Mock navigator.vibrate
Object.defineProperty(navigator, 'vibrate', {
  value: jest.fn(),
  writable: true,
});

describe('useRestTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('initializes with default seconds', () => {
      const { result } = renderHook(() => useRestTimer());

      expect(result.current.seconds).toBe(180); // default
      expect(result.current.isRunning).toBe(false);
      expect(result.current.isFinished).toBe(false);
    });

    it('initializes with custom default seconds', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      expect(result.current.seconds).toBe(60);
    });

    it('auto-starts when autoStart is true', () => {
      const { result } = renderHook(() =>
        useRestTimer({ defaultSeconds: 60, autoStart: true })
      );

      // Should be running after autoStart
      expect(result.current.isRunning).toBe(true);
      expect(result.current.seconds).toBe(60);
    });
  });

  describe('start', () => {
    it('starts the timer', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.seconds).toBe(60);
    });

    it('starts with custom duration', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start(120);
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.seconds).toBe(120);
    });

    it('saves timer state to localStorage', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });

      expect(localStorageMock.setItem).toHaveBeenCalled();
    });

    it('resets skipped state when starting', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      // Skip first
      act(() => {
        result.current.start();
      });
      act(() => {
        result.current.skip();
      });
      expect(result.current.isSkipped).toBe(true);

      // Start again
      act(() => {
        result.current.start();
      });
      expect(result.current.isSkipped).toBe(false);
    });
  });

  describe('countdown', () => {
    it('counts down every second', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 5 }));

      act(() => {
        result.current.start();
      });

      expect(result.current.seconds).toBe(5);

      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(result.current.seconds).toBe(4);

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.seconds).toBe(2);
    });

    it('finishes when countdown reaches zero', () => {
      const onComplete = jest.fn();
      const { result } = renderHook(() =>
        useRestTimer({ defaultSeconds: 2, onComplete })
      );

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(result.current.seconds).toBe(0);
      expect(result.current.isRunning).toBe(false);
      expect(result.current.isFinished).toBe(true);
      expect(onComplete).toHaveBeenCalled();
    });

    it('plays alarm when timer finishes', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 1 }));

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(window.AudioContext).toHaveBeenCalled();
    });
  });

  describe('toggle', () => {
    it('toggles between running and paused', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });
      expect(result.current.isRunning).toBe(true);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isRunning).toBe(false);

      act(() => {
        result.current.toggle();
      });
      expect(result.current.isRunning).toBe(true);
    });
  });

  describe('reset', () => {
    it('resets the timer to initial seconds', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      act(() => {
        result.current.reset();
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.isFinished).toBe(false);
      expect(result.current.seconds).toBe(60);
    });

    it('clears localStorage when reset', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });

      act(() => {
        result.current.reset();
      });

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('workout_rest_timer');
    });
  });

  describe('addTime', () => {
    it('adds time when running', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(10000);
      });

      const currentSeconds = result.current.seconds;

      act(() => {
        result.current.addTime(30);
      });

      // Should have approximately 30 more seconds
      expect(result.current.seconds).toBeGreaterThan(currentSeconds);
    });

    it('adds time when not running', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.addTime(30);
      });

      expect(result.current.seconds).toBe(90);
    });

    it('subtracts time correctly', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      act(() => {
        result.current.addTime(-30);
      });

      expect(result.current.seconds).toBe(30);
    });

    it('does not go below zero', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 30 }));

      act(() => {
        result.current.addTime(-60);
      });

      expect(result.current.seconds).toBe(0);
    });
  });

  describe('skip', () => {
    it('skips the timer and tracks rested seconds', () => {
      const onComplete = jest.fn();
      const { result } = renderHook(() =>
        useRestTimer({ defaultSeconds: 60, onComplete })
      );

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(20000);
      });

      act(() => {
        result.current.skip();
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.isSkipped).toBe(true);
      expect(result.current.restedSeconds).toBeGreaterThan(0);
      expect(onComplete).toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('dismisses the finished state', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 1 }));

      act(() => {
        result.current.start();
      });

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(result.current.isFinished).toBe(true);

      act(() => {
        result.current.dismiss();
      });

      expect(result.current.isFinished).toBe(false);
      expect(result.current.isRunning).toBe(false);
    });
  });

  describe('computed properties', () => {
    it('calculates progressPercent correctly', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 100 }));

      act(() => {
        result.current.start();
      });

      expect(result.current.progressPercent).toBe(0);

      act(() => {
        jest.advanceTimersByTime(50000);
      });

      expect(result.current.progressPercent).toBe(50);
    });

    it('sets isUrgent when seconds <= 10', () => {
      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 15 }));

      act(() => {
        result.current.start();
      });

      expect(result.current.isUrgent).toBe(false);

      act(() => {
        jest.advanceTimersByTime(6000);
      });

      expect(result.current.isUrgent).toBe(true);
      expect(result.current.seconds).toBeLessThanOrEqual(10);
    });
  });

  describe('persistence', () => {
    it('restores timer state from localStorage on mount', () => {
      const endTime = Date.now() + 30000; // 30 seconds from now
      const storedState = {
        endTime,
        duration: 60,
        isRunning: true,
      };
      localStorageMock.setItem('workout_rest_timer', JSON.stringify(storedState));

      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      // Should restore running state
      expect(result.current.isRunning).toBe(true);
      expect(result.current.seconds).toBeGreaterThan(0);
    });

    it('handles expired timer from localStorage', () => {
      const endTime = Date.now() - 5000; // 5 seconds ago (expired)
      const storedState = {
        endTime,
        duration: 60,
        isRunning: true,
      };
      localStorageMock.setItem('workout_rest_timer', JSON.stringify(storedState));

      const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));

      // Should be finished
      expect(result.current.seconds).toBe(0);
      expect(result.current.isFinished).toBe(true);
    });
  });
});
