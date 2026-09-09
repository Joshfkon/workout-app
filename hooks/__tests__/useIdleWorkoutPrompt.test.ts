/**
 * useIdleWorkoutPrompt.test.ts — Tests for idle workout detection
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useIdleWorkoutPrompt } from '../useIdleWorkoutPrompt';
import { ABANDONED_SESSION_THRESHOLD_MINUTES } from '@/lib/workout/constants';

// Helper to create timestamps relative to now
const minutesAgo = (minutes: number): string => {
  const date = new Date(Date.now() - minutes * 60 * 1000);
  return date.toISOString();
};

describe('useIdleWorkoutPrompt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('does not show prompt when no sets are logged', () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(null, true)
    );

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('does not show prompt when workout is not active', () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(25), false)
    );

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('does not show prompt when last set is recent (< threshold)', () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(10), true)
    );

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('shows prompt when idle for >= threshold minutes', async () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(ABANDONED_SESSION_THRESHOLD_MINUTES), true)
    );

    // Wait for the idle check to run
    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });
  });

  it('shows prompt when idle for > threshold minutes', async () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(25), true)
    );

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });
  });

  it('dismisses prompt when dismissPrompt is called', async () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(25), true)
    );

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });

    act(() => {
      result.current.dismissPrompt();
    });

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('does not show prompt again after dismissal for the same idle streak', async () => {
    const { result } = renderHook(() =>
      useIdleWorkoutPrompt(minutesAgo(25), true)
    );

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });

    act(() => {
      result.current.dismissPrompt();
    });

    expect(result.current.shouldShowPrompt).toBe(false);

    // Advance time and check again - should still not show
    act(() => {
      jest.advanceTimersByTime(30 * 1000); // 30 seconds
    });

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('resets idle detection when a new set is logged', async () => {
    const lastSet = minutesAgo(25);
    const { result, rerender } = renderHook(
      ({ timestamp, active }) => useIdleWorkoutPrompt(timestamp, active),
      { initialProps: { timestamp: lastSet, active: true } }
    );

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });

    // Log a new set (change timestamp)
    const newSet = new Date().toISOString();
    rerender({ timestamp: newSet, active: true });

    // Prompt should be dismissed
    expect(result.current.shouldShowPrompt).toBe(false);

    // After threshold passes again with the new set, prompt can show again
    const anotherOldSet = minutesAgo(25);
    rerender({ timestamp: anotherOldSet, active: true });

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });
  });

  it('stops monitoring when workout becomes inactive', async () => {
    const { result, rerender } = renderHook(
      ({ active }) => useIdleWorkoutPrompt(minutesAgo(25), active),
      { initialProps: { active: true } }
    );

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });

    // Workout becomes inactive (e.g., finish modal opens)
    rerender({ active: false });

    expect(result.current.shouldShowPrompt).toBe(false);
  });

  it('checks idle state every 30 seconds', async () => {
    // Start with a recent set
    const recentSet = minutesAgo(5);
    const { result, rerender } = renderHook(
      ({ timestamp }) => useIdleWorkoutPrompt(timestamp, true),
      { initialProps: { timestamp: recentSet } }
    );

    expect(result.current.shouldShowPrompt).toBe(false);

    // Simulate time passing to cross the threshold
    // The timestamp stays the same, but "now" advances
    const oldSet = minutesAgo(ABANDONED_SESSION_THRESHOLD_MINUTES + 1);
    rerender({ timestamp: oldSet });

    // Advance timers to trigger the interval check
    act(() => {
      jest.advanceTimersByTime(30 * 1000);
    });

    await waitFor(() => {
      expect(result.current.shouldShowPrompt).toBe(true);
    });
  });
});
