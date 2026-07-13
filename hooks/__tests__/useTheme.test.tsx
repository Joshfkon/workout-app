/**
 * Tests for hooks/useTheme.ts
 * Theme preference: localStorage cache, data-theme application, system
 * resolution, and Supabase preference sync.
 */

import { renderHook, act, waitFor } from '@testing-library/react';

const mockGetSession = jest.fn();
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockSelectEq = jest.fn();
const mockSingle = jest.fn();
const mockUpdateEq = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getSession: mockGetSession },
    from: () => ({ select: mockSelect, update: mockUpdate }),
  }),
}));

// Import after mocking
import { useTheme, resolveTheme, __resetThemeStateForTests } from '../useTheme';

/** Install a matchMedia stub; `light` controls (prefers-color-scheme: light). */
function stubMatchMedia(light: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: light,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
}

describe('useTheme', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    __resetThemeStateForTests();
    stubMatchMedia(false);

    // Default: logged out, so no server reconcile/push happens.
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSelect.mockReturnValue({ eq: mockSelectEq });
    mockSelectEq.mockReturnValue({ single: mockSingle });
    mockSingle.mockResolvedValue({ data: { preferences: {} } });
    mockUpdate.mockReturnValue({ eq: mockUpdateEq });
    mockUpdateEq.mockResolvedValue({ error: null });
  });

  describe('resolveTheme', () => {
    it('passes explicit preferences through', () => {
      expect(resolveTheme('dark')).toBe('dark');
      expect(resolveTheme('light')).toBe('light');
    });

    it('resolves system from prefers-color-scheme', () => {
      stubMatchMedia(true);
      expect(resolveTheme('system')).toBe('light');
      stubMatchMedia(false);
      expect(resolveTheme('system')).toBe('dark');
    });
  });

  it('defaults to dark and stamps data-theme on mount', async () => {
    const { result } = renderHook(() => useTheme());
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(result.current.theme).toBe('dark');
  });

  it('initializes from a stored light preference', async () => {
    localStorage.setItem('theme', 'light');
    const { result } = renderHook(() => useTheme());
    await waitFor(() => {
      expect(result.current.theme).toBe('light');
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('treats an unknown stored value as dark', async () => {
    localStorage.setItem('theme', 'sepia');
    const { result } = renderHook(() => useTheme());
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme applies, persists locally, and skips server write when logged out', async () => {
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      result.current.setTheme('light');
    });

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled();
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('setTheme("system") resolves via the OS preference', async () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      result.current.setTheme('system');
    });

    expect(result.current.theme).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBe('system');
  });

  it('setTheme merges the theme into users.preferences when logged in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { units: 'lb' } } });

    const { result } = renderHook(() => useTheme());
    await act(async () => {
      result.current.setTheme('light');
    });

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        preferences: { units: 'lb', theme: 'light' },
      });
    });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'u1');
  });

  it('adopts the server preference over stale localStorage on boot', async () => {
    localStorage.setItem('theme', 'dark');
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSingle.mockResolvedValue({ data: { preferences: { theme: 'light' } } });

    const { result } = renderHook(() => useTheme());

    await waitFor(() => {
      expect(result.current.theme).toBe('light');
    });
    expect(localStorage.getItem('theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('keeps multiple mounted hooks in sync', async () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());

    await act(async () => {
      first.result.current.setTheme('light');
    });

    expect(second.result.current.theme).toBe('light');
  });
});
