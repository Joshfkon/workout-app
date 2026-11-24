/**
 * UX panel round 22 (Dre): the block builder opened on a skeleton. Home and
 * Train warm its inputs into the same React Query entry the builder reads.
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePrefetchBuilderInputs } from '../usePrefetchBuilderInputs';
import { BUILDER_INPUTS_QUERY_KEY } from '@/lib/training/fetchBuilderInputs';

const fetchBuilderInputs = jest.fn(() => Promise.resolve({ userId: 'u1' }));
jest.mock('@/lib/training/fetchBuilderInputs', () => ({
  BUILDER_INPUTS_QUERY_KEY: ['mesocycle-builder', 'inputs'],
  fetchBuilderInputs: () => fetchBuilderInputs(),
}));

function Entry({ enabled = true }: { enabled?: boolean }) {
  usePrefetchBuilderInputs(enabled);
  return null;
}

describe('usePrefetchBuilderInputs', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fetchBuilderInputs.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  it('fills the builder’s cache entry once, shortly after the entry renders', async () => {
    const client = new QueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Entry />
      </QueryClientProvider>
    );
    expect(fetchBuilderInputs).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(fetchBuilderInputs).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(BUILDER_INPUTS_QUERY_KEY)).toEqual({ userId: 'u1' });

    // A revisit while the copy is fresh fetches nothing.
    unmount();
    render(
      <QueryClientProvider client={client}>
        <Entry />
      </QueryClientProvider>
    );
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(fetchBuilderInputs).toHaveBeenCalledTimes(1);
  });

  it('does nothing while disabled (an active block hides the entry)', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Entry enabled={false} />
      </QueryClientProvider>
    );
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(fetchBuilderInputs).not.toHaveBeenCalled();
  });
});
