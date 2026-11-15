import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSleepLog } from '../useSleepLog';
import { HEALTHKIT_SYNCED_EVENT } from '@/lib/integrations/healthkitEvents';
import { HEALTHKIT_SYNCED_EVENT as SYNC_MODULE_EVENT } from '@/lib/integrations/healthkit-sync';
import { getLocalDateString } from '@/lib/utils';

const mockFetchRecentSleep = jest.fn();
jest.mock('@/lib/sleep/sleepLog', () => ({
  fetchRecentSleep: (...args: unknown[]) => mockFetchRecentSleep(...args),
  upsertSleepEntry: jest.fn(),
}));
jest.mock('@/lib/supabase/client', () => ({ createUntypedClient: () => ({}) }));
jest.mock('@/stores', () => ({ useUserStore: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useAuthUser', () => ({ useAuthUser: () => ({ user: null }) }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useSleepLog after a HealthKit sync', () => {
  it('listens for the event the sync module fires', () => {
    expect(SYNC_MODULE_EVENT).toBe(HEALTHKIT_SYNCED_EVENT);
  });

  it("refetches so last night's synced sleep shows without waiting for the cache", async () => {
    const today = getLocalDateString();
    // Loaded before the sync stored last night, then the sync lands.
    mockFetchRecentSleep
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ localDay: today, hours: 7.7, quality: 'ok', source: 'healthkit' }]);

    const { result } = renderHook(() => useSleepLog(), { wrapper });
    await waitFor(() => expect(mockFetchRecentSleep).toHaveBeenCalledTimes(1));
    expect(result.current.lastNight).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent(HEALTHKIT_SYNCED_EVENT));
    });

    await waitFor(() => expect(result.current.lastNight?.hours).toBe(7.7));
    expect(mockFetchRecentSleep).toHaveBeenCalledTimes(2);
  });
});
