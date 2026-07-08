/**
 * Tests for hooks/useKeyboardOpen.ts
 * Boolean on-screen-keyboard detection for fixed bottom bars
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useKeyboardOpen } from '../useKeyboardOpen';
import { isNativePlatform } from '@/lib/integrations/capacitor-stub';

jest.mock('@/lib/integrations/capacitor-stub', () => ({
  isNativePlatform: jest.fn(() => false),
}));

const mockIsNative = isNativePlatform as jest.Mock;

/** Minimal visualViewport stand-in jsdom doesn't provide. */
function installVisualViewport(height: number, offsetTop = 0) {
  const listeners: Record<string, Set<EventListener>> = { resize: new Set(), scroll: new Set() };
  const viewport = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: EventListener) => listeners[type]?.add(fn),
    removeEventListener: (type: string, fn: EventListener) => listeners[type]?.delete(fn),
    dispatch(type: 'resize' | 'scroll') {
      listeners[type].forEach((fn) => fn(new Event(type)));
    },
  };
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  return viewport;
}

describe('useKeyboardOpen', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    mockIsNative.mockReturnValue(false);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
  });

  describe('web (visualViewport)', () => {
    it('is false while the visual viewport matches the layout viewport', async () => {
      installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());
      // Initial measurement runs through requestAnimationFrame
      await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      expect(result.current).toBe(false);
    });

    it('flips true when the keyboard occludes the viewport, false when dismissed', async () => {
      const viewport = installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());

      act(() => {
        viewport.height = 500; // 300px keyboard
        viewport.dispatch('resize');
      });
      await waitFor(() => expect(result.current).toBe(true));

      act(() => {
        viewport.height = 800;
        viewport.dispatch('resize');
      });
      await waitFor(() => expect(result.current).toBe(false));
    });

    it('ignores occlusion too small to be a keyboard (browser chrome)', async () => {
      const viewport = installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());

      act(() => {
        viewport.height = 750; // 50px — accessory bar / chrome, not a keyboard
        viewport.dispatch('resize');
      });
      await act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));
      expect(result.current).toBe(false);
    });

    it('tracks visual viewport scroll offset while the keyboard is up', async () => {
      const viewport = installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());

      act(() => {
        // iOS scrolled the visual viewport down while the keyboard is open
        viewport.height = 500;
        viewport.offsetTop = 100;
        viewport.dispatch('scroll');
      });
      await waitFor(() => expect(result.current).toBe(true));
    });
  });

  describe('native (Capacitor keyboard events)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
    });

    it('follows keyboardWillShow / keyboardWillHide window events', () => {
      const { result } = renderHook(() => useKeyboardOpen());
      expect(result.current).toBe(false);

      act(() => {
        window.dispatchEvent(new Event('keyboardWillShow'));
      });
      expect(result.current).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('keyboardWillHide'));
      });
      expect(result.current).toBe(false);
    });

    it('stops listening after unmount', () => {
      const { result, unmount } = renderHook(() => useKeyboardOpen());
      unmount();
      window.dispatchEvent(new Event('keyboardWillShow'));
      expect(result.current).toBe(false);
    });
  });
});
