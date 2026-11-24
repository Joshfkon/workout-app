import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let mockNative = false;
jest.mock('@/lib/integrations/capacitor-stub', () => ({ isNativePlatform: () => mockNative }));
const mockSync = jest.fn(async () => true);
jest.mock('@/lib/reminders/trackingReminderSync', () => ({ syncTrackingReminders: () => mockSync() }));

import { TRACKING_REMINDERS_QUERY_PREFIX, useInvalidateTrackingReminders } from '../useTrackingReminders';

function setup() {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useInvalidateTrackingReminders(), { wrapper });
  return { invalidate, refresh: result.current };
}

describe('useInvalidateTrackingReminders', () => {
  beforeEach(() => mockSync.mockClear());

  it('refetches the Home nudge and re-plans native notifications right away', async () => {
    mockNative = true;
    const { invalidate, refresh } = setup();
    refresh();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [TRACKING_REMINDERS_QUERY_PREFIX] });
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it('on the web only refetches', async () => {
    mockNative = false;
    const { invalidate, refresh } = setup();
    refresh();
    expect(invalidate).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 0));
    expect(mockSync).not.toHaveBeenCalled();
  });
});
