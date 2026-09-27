import { act, renderHook } from '@testing-library/react';

jest.mock('@/lib/actions/workoutPlanReview', () => ({ reviewWorkoutPlan: jest.fn() }));

import { usePlanReview, type ReviewRequester } from '../usePlanReview';
import {
  REVIEW_PREFETCH_DEBOUNCE_MS,
  REVIEW_TIMEOUT_MS,
  type ReviewPayload,
} from '@/services/workoutSetup/aiReview';

const payload: ReviewPayload = {
  plan: [
    {
      itemId: 'item-1', exerciseId: 'row', name: 'Row', order: 1, sets: 4, repRange: [6, 10],
      primaryMuscles: ['back'], secondaryMuscles: [], movementPattern: 'horizontal_pull', equipment: 'barbell',
      swapCandidates: [{ exerciseId: 'csrow', name: 'Chest Supported Row' }],
    },
  ],
  selectedGroups: ['back'],
  readiness: {},
  stabilizerLoad: {},
  constraints: { timeBudgetMin: null, estimatedDurationMin: 20 },
  recentSessions: [],
};
const okReview: ReviewRequester = async () => ({
  ok: true,
  review: { summary: 'ok', suggestions: [{ id: 'a', type: 'flag', itemId: 'item-1', reason: 'r', severity: 'info' }] },
});

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('usePlanReview', () => {
  it('prefetches once the plan is unchanged for ~2s, then shows instantly on Review', async () => {
    const requester = jest.fn(okReview);
    const { result } = renderHook(() => usePlanReview('h1', () => payload, { enabled: true, requester }));
    act(() => jest.advanceTimersByTime(REVIEW_PREFETCH_DEBOUNCE_MS - 1));
    expect(requester).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(requester).toHaveBeenCalledTimes(1);
    await flush();
    // Nothing is shown until the user asks.
    expect(result.current.status).toBe('idle');
    await act(async () => result.current.review());
    expect(result.current.status).toBe('ready');
    expect(requester).toHaveBeenCalledTimes(1); // served from cache
  });

  it('restarts the debounce on every change and discards a stale result', async () => {
    let resolveFirst: (v: Awaited<ReturnType<ReviewRequester>>) => void = () => {};
    const requester = jest.fn<ReturnType<ReviewRequester>, Parameters<ReviewRequester>>(
      () => new Promise((r) => (resolveFirst = r))
    );
    const { result, rerender } = renderHook(({ hash }) => usePlanReview(hash, () => payload, { enabled: true, requester }), {
      initialProps: { hash: 'h1' },
    });
    act(() => jest.advanceTimersByTime(1000));
    rerender({ hash: 'h2' });
    act(() => jest.advanceTimersByTime(1500));
    expect(requester).not.toHaveBeenCalled();

    // Manual review on h2, then the plan changes before it resolves.
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.review();
    });
    expect(result.current.status).toBe('loading');
    rerender({ hash: 'h3' });
    await act(async () => {
      resolveFirst(await okReview(payload));
      await pending;
    });
    expect(result.current.shown).toBeNull();
  });

  it('shows "unavailable" after the 10s timeout', async () => {
    const requester: ReviewRequester = () => new Promise(() => {});
    const { result } = renderHook(() => usePlanReview('h1', () => payload, { enabled: false, requester }));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.review();
    });
    await act(async () => {
      jest.advanceTimersByTime(REVIEW_TIMEOUT_MS);
      await pending;
    });
    expect(result.current.status).toBe('unavailable');
  });

  it('fails gracefully (no throw) on a server error or invalid payload answer', async () => {
    const bad: ReviewRequester = async () => ({
      ok: true,
      // Swap target outside swapCandidates → client-side validation strips it.
      review: { summary: '', suggestions: [{ id: 'x', type: 'swap', itemId: 'item-1', replacementExerciseId: 'invented', reason: 'r', severity: 'info' }] },
    });
    const { result } = renderHook(() => usePlanReview('h1', () => payload, { enabled: false, requester: bad }));
    await act(async () => result.current.review());
    expect(result.current.status).toBe('ready');
    expect(result.current.shown?.review.suggestions).toEqual([]);

    const failing: ReviewRequester = async () => ({ ok: false, error: 'no key' });
    const r2 = renderHook(() => usePlanReview('h9', () => payload, { enabled: false, requester: failing }));
    await act(async () => r2.result.current.review());
    expect(r2.result.current.status).toBe('unavailable');
  });

  it('offline: no prefetch, and Review reports unavailable immediately', async () => {
    const onLine = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const requester = jest.fn(okReview);
    const { result } = renderHook(() => usePlanReview('h1', () => payload, { enabled: true, requester }));
    act(() => jest.advanceTimersByTime(REVIEW_PREFETCH_DEBOUNCE_MS * 2));
    await act(async () => result.current.review());
    expect(requester).not.toHaveBeenCalled();
    expect(result.current.status).toBe('unavailable');
    onLine.mockRestore();
  });

  it('does not re-review after an accepted suggestion, but does after a user edit', () => {
    const requester = jest.fn(okReview);
    const { result, rerender } = renderHook(({ hash }) => usePlanReview(hash, () => payload, { enabled: true, requester }), {
      initialProps: { hash: 'h1' },
    });
    act(() => jest.advanceTimersByTime(REVIEW_PREFETCH_DEBOUNCE_MS));
    expect(requester).toHaveBeenCalledTimes(1);

    act(() => result.current.noteAcceptedEdit());
    rerender({ hash: 'h2' }); // the accept changed the plan
    act(() => jest.advanceTimersByTime(REVIEW_PREFETCH_DEBOUNCE_MS * 2));
    expect(requester).toHaveBeenCalledTimes(1);

    rerender({ hash: 'h3' }); // a user edit
    act(() => jest.advanceTimersByTime(REVIEW_PREFETCH_DEBOUNCE_MS));
    expect(requester).toHaveBeenCalledTimes(2);
  });
});
