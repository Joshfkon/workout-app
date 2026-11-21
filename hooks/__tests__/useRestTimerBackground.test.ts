/**
 * When the countdown reaches zero while the app is backgrounded (iOS keeps the
 * web view's JS alive for a while), the native notification must NOT be
 * cancelled: it is the only alert the user can see or hear.
 */
import { renderHook, act } from '@testing-library/react';

const mockCancel = jest.fn().mockResolvedValue(undefined);
const mockSchedule = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/integrations/notifications', () => ({
  scheduleRestCompleteNotification: (...a: unknown[]) => mockSchedule(...a),
  cancelRestCompleteNotification: () => mockCancel(),
  restCompleteHaptic: jest.fn(),
}));

import { useRestTimer } from '../useRestTimer';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  setVisibility('visible');
  jest.useRealTimers();
});

it('keeps the native notification when the rest ends with the app in the background', () => {
  const onComplete = jest.fn();
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 5, onComplete }));
  act(() => result.current.start(5));
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  mockCancel.mockClear();

  setVisibility('hidden');
  act(() => {
    jest.advanceTimersByTime(6000);
  });

  expect(result.current.isFinished).toBe(true);
  expect(onComplete).toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});

it('cancels the native notification when the rest ends on screen (in-app alarm instead)', () => {
  const { result } = renderHook(() => useRestTimer({ defaultSeconds: 5 }));
  act(() => result.current.start(5));
  mockCancel.mockClear();

  setVisibility('visible');
  act(() => {
    jest.advanceTimersByTime(6000);
  });

  expect(result.current.isFinished).toBe(true);
  expect(mockCancel).toHaveBeenCalled();
});
