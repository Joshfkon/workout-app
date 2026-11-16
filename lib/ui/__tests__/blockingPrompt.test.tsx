import { act, renderHook } from '@testing-library/react';
import { setBlockingPromptOpen, useBlockingPromptOpen } from '../blockingPrompt';

describe('blockingPrompt — one pop-up at a time', () => {
  afterEach(() => act(() => setBlockingPromptOpen(false)));

  it('tells waiting overlays when a blocking prompt opens and closes', () => {
    const { result } = renderHook(() => useBlockingPromptOpen());
    expect(result.current).toBe(false);

    act(() => setBlockingPromptOpen(true));
    expect(result.current).toBe(true);

    act(() => setBlockingPromptOpen(false));
    expect(result.current).toBe(false);
  });
});
