/**
 * The rest timer drives the iOS Live Activity from the same points that
 * schedule / cancel the native rest notification.
 */
import { renderHook, act } from '@testing-library/react';

jest.mock('@/lib/integrations/notifications', () => ({
  scheduleRestCompleteNotification: jest.fn().mockResolvedValue(undefined),
  cancelRestCompleteNotification: jest.fn().mockResolvedValue(undefined),
  restCompleteHaptic: jest.fn(),
}));

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockUpdate = jest.fn().mockResolvedValue(undefined);
const mockEnd = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/integrations/liveActivity', () => ({
  startRestLiveActivity: (...a: unknown[]) => mockStart(...a),
  updateRestLiveActivity: (...a: unknown[]) => mockUpdate(...a),
  endRestLiveActivity: () => mockEnd(),
}));

import { useRestTimer, clearPersistedRestTimer } from '../useRestTimer';

const ctx = { exerciseName: 'Bench Press', nextSet: 'Set 2 of 3' };

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  jest.clearAllMocks();
  localStorage.clear();
});
afterEach(() => jest.useRealTimers());

it('starts the Live Activity with the end time, allotment and labels', () => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 90, activityContext: ctx }));
  act(() => result.current.start(90));
  expect(mockStart).toHaveBeenCalledWith(Date.now() + 90_000, 90, ctx);
});

it('moves the end time on +15 / -15', () => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 90, activityContext: ctx }));
  act(() => result.current.start(90));
  const end = Date.now() + 90_000;
  act(() => result.current.addTime(15));
  expect(mockUpdate).toHaveBeenLastCalledWith(end + 15_000, 105, ctx);
  act(() => result.current.addTime(-15));
  expect(mockUpdate).toHaveBeenLastCalledWith(end, 90, ctx);
});

it('ends it when -15 runs the clock out', () => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 10 }));
  act(() => result.current.start(10));
  act(() => result.current.addTime(-15));
  expect(mockEnd).toHaveBeenCalled();
});

it.each(['skip', 'dismiss', 'reset', 'markComplete', 'toggle'] as const)('ends it on %s', (action) => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 60 }));
  act(() => result.current.start(60));
  mockEnd.mockClear();
  act(() => result.current[action]());
  expect(mockEnd).toHaveBeenCalled();
});

it('ends it when the countdown completes', () => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 5 }));
  act(() => result.current.start(5));
  mockEnd.mockClear();
  act(() => {
    jest.advanceTimersByTime(6000);
  });
  expect(result.current.isFinished).toBe(true);
  expect(mockEnd).toHaveBeenCalled();
});

it('ends it when a workout is discarded without the page mounted', () => {
  clearPersistedRestTimer();
  expect(mockEnd).toHaveBeenCalled();
});

it('refreshes the labels when the next set changes mid-rest', () => {
  const { result, rerender } = renderHook(
    ({ c }) => useRestTimer({ defaultSeconds: 90, activityContext: c }),
    { initialProps: { c: { exerciseName: 'Bench Press', nextSet: 'Set 1 of 3' } } }
  );
  act(() => result.current.start(90));
  const end = Date.now() + 90_000;
  rerender({ c: { exerciseName: 'Bench Press', nextSet: 'Set 2 of 3' } });
  expect(mockUpdate).toHaveBeenCalledWith(end, 90, { exerciseName: 'Bench Press', nextSet: 'Set 2 of 3' });
});

it('does not touch the Live Activity for label changes while idle', () => {
  const { rerender } = renderHook(
    ({ c }) => useRestTimer({ defaultSeconds: 90, activityContext: c }),
    { initialProps: { c: { exerciseName: 'A' } } }
  );
  rerender({ c: { exerciseName: 'B' } });
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
});
