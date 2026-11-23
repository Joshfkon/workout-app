/**
 * hooks/useTrackingFocus: the one read point for food-only mode.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockMetadata: Record<string, unknown> = {};
let mockCompleted: { id: string }[] = [];
const mockGt = jest.fn();
const mockSavePatch = jest.fn();

jest.mock('@/lib/settings/savePreferencesPatch', () => ({
  savePreferencesPatch: (...args: unknown[]) => mockSavePatch(...args),
}));
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1', user_metadata: mockMetadata } } } }),
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        gt: (...args: unknown[]) => {
          mockGt(...args);
          return q;
        },
        limit: async () => ({ data: mockCompleted, error: null }),
      };
      return q;
    },
  }),
}));

import { useUserStore, userFromRow } from '@/stores/userStore';
import { __resetTrackingFocusForTests, useTrackingFocus } from '../useTrackingFocus';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function signIn(preferences: Record<string, unknown> = {}) {
  useUserStore.getState().setUser(userFromRow({ id: 'u1', preferences }));
}

describe('useTrackingFocus', () => {
  beforeEach(() => {
    __resetTrackingFocusForTests();
    mockMetadata = {};
    mockCompleted = [];
    mockGt.mockReset();
    mockSavePatch.mockReset().mockResolvedValue({});
    signIn();
  });

  it('a lifter is never food-only', async () => {
    const { result } = renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(result.current.statedFood).toBe(false));
    expect(result.current.foodOnly).toBe(false);
  });

  it('a food tracker with no workouts is food-only', async () => {
    mockMetadata = { tracking_focus: 'food' };
    const { result } = renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(result.current.foodOnly).toBe(true));
    expect(result.current.statedFood).toBe(true);
  });

  it('a first completed workout turns lifting on, and saves it', async () => {
    mockMetadata = { tracking_focus: 'food' };
    mockCompleted = [{ id: 's1' }];
    const { result } = renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(mockSavePatch).toHaveBeenCalledWith(expect.anything(), 'u1', { alsoLifts: true }));
    expect(result.current.foodOnly).toBe(false);
    expect(useUserStore.getState().user?.preferences.alsoLifts).toBe(true);
  });

  it('a failing automatic save is tried once, not in a loop', async () => {
    mockMetadata = { tracking_focus: 'food' };
    mockCompleted = [{ id: 's1' }];
    mockSavePatch.mockRejectedValue(new Error('offline'));
    renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(mockSavePatch).toHaveBeenCalledTimes(1));
    // The rollback re-render must not fire another save straight away.
    await new Promise((r) => setTimeout(r, 100));
    expect(mockSavePatch).toHaveBeenCalledTimes(1);
    expect(useUserStore.getState().user?.preferences.alsoLifts).not.toBe(true);
  });

  it('"I also lift weights" switches it on and off', async () => {
    mockMetadata = { tracking_focus: 'food' };
    const { result } = renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(result.current.foodOnly).toBe(true));

    await act(() => result.current.setLiftingOn(true));
    expect(result.current.foodOnly).toBe(false);

    await act(() => result.current.setLiftingOn(false));
    const offAt = useUserStore.getState().user?.preferences.liftingOffAt;
    expect(typeof offAt).toBe('string');
    // Only a workout completed AFTER switching off turns it back on.
    await waitFor(() => expect(mockGt).toHaveBeenCalledWith('completed_at', offAt));
    await waitFor(() => expect(result.current.foodOnly).toBe(true));
  });

  it('reverts the switch when the save fails', async () => {
    mockMetadata = { tracking_focus: 'food' };
    mockSavePatch.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useTrackingFocus(), { wrapper });
    await waitFor(() => expect(result.current.foodOnly).toBe(true));
    await act(async () => {
      await expect(result.current.setLiftingOn(true)).rejects.toThrow('offline');
    });
    expect(result.current.foodOnly).toBe(true);
  });
});
