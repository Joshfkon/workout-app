/**
 * hooks/useTextSize: localStorage cache (read pre-paint), the data-text-size
 * attribute, and users.preferences.textSize sync.
 */
import { act, renderHook, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
const mockSingle = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateEq = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getSession: mockGetSession },
    from: () => ({
      select: () => ({ eq: () => ({ single: mockSingle, maybeSingle: mockSingle }) }),
      update: mockUpdate,
    }),
  }),
}));

import { useTextSize, __resetTextSizeStateForTests } from '../useTextSize';

describe('useTextSize', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
    __resetTextSizeStateForTests();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSingle.mockResolvedValue({ data: { preferences: {} } });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });
  });

  it('starts from the stored size', () => {
    localStorage.setItem('textSize', 'large');
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe('large');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
  });

  it('applies, caches and saves a change, keeping other preferences', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { units: 'lb' } } });
    const { result } = renderHook(() => useTextSize());
    act(() => result.current.setTextSize('larger'));

    expect(result.current.textSize).toBe('larger');
    expect(document.documentElement.getAttribute('data-text-size')).toBe('larger');
    expect(localStorage.getItem('textSize')).toBe('larger');
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({ preferences: { units: 'lb', textSize: 'larger' } })
    );

    act(() => result.current.setTextSize('default'));
    expect(document.documentElement.hasAttribute('data-text-size')).toBe(false);
  });

  it('takes a size saved on another device', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { textSize: 'large' } } });
    const { result } = renderHook(() => useTextSize());
    await waitFor(() => expect(result.current.textSize).toBe('large'));
    expect(localStorage.getItem('textSize')).toBe('large');
  });

  it('shares one value across mounted controls', () => {
    const a = renderHook(() => useTextSize());
    const b = renderHook(() => useTextSize());
    act(() => a.result.current.setTextSize('large'));
    expect(b.result.current.textSize).toBe('large');
  });

  it('leaves stored preferences untouched when the read fails', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useTextSize());
    act(() => result.current.setTextSize('larger'));
    // Applied locally, but never written over the whole preferences object.
    expect(localStorage.getItem('textSize')).toBe('larger');
    await new Promise((r) => setTimeout(r, 20));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("loads the next account's saved size after switching accounts without a reload", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { textSize: 'large' } } });
    const first = renderHook(() => useTextSize());
    await waitFor(() => expect(first.result.current.textSize).toBe('large'));
    first.unmount();

    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { textSize: 'larger' } } });
    const second = renderHook(() => useTextSize());
    await waitFor(() => expect(second.result.current.textSize).toBe('larger'));
  });
});
