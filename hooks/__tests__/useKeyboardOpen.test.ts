/**
 * Tests for hooks/useKeyboardOpen.ts
 * Boolean on-screen-keyboard detection for fixed bottom bars
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useKeyboardOpen, isKeyboardTarget } from '../useKeyboardOpen';
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

/** Focus a text input, as tapping the weight/reps field would. */
function focusTextInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  document.body.appendChild(input);
  act(() => input.focus());
  return input;
}

const nextFrame = () =>
  act(async () => new Promise((r) => requestAnimationFrame(() => r(undefined))));

describe('useKeyboardOpen', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    mockIsNative.mockReturnValue(false);
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true });
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.innerHTML = '';
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
      focusTextInput();

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
      focusTextInput();

      act(() => {
        // iOS scrolled the visual viewport down while the keyboard is open
        viewport.height = 500;
        viewport.offsetTop = 100;
        viewport.dispatch('scroll');
      });
      await waitFor(() => expect(result.current).toBe(true));
    });

    it('ignores occlusion when no text field is focused (pinch-zoom, stale viewport)', async () => {
      // The "rest timer disappears" bug: geometry alone read as a keyboard
      // and unmounted the bar with nothing on screen.
      const viewport = installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());

      act(() => {
        viewport.height = 400;
        viewport.dispatch('resize');
      });
      await nextFrame();
      expect(result.current).toBe(false);
    });

    it('closes once focus leaves the field even if the viewport stays shrunk', async () => {
      const viewport = installVisualViewport(800);
      const { result } = renderHook(() => useKeyboardOpen());
      const input = focusTextInput();

      act(() => {
        viewport.height = 450;
        viewport.dispatch('resize');
      });
      await waitFor(() => expect(result.current).toBe(true));

      // iOS never fires the restoring resize — blur alone must bring the bar back.
      act(() => input.blur());
      await waitFor(() => expect(result.current).toBe(false));
    });

    it('waits for the viewport to settle before reporting closed', async () => {
      jest.useFakeTimers();
      try {
        const viewport = installVisualViewport(800);
        const { result } = renderHook(() => useKeyboardOpen());
        focusTextInput();

        act(() => {
          viewport.height = 500;
          viewport.dispatch('resize');
          jest.advanceTimersByTime(20); // rAF
        });
        expect(result.current).toBe(true);

        act(() => {
          viewport.height = 800;
          viewport.dispatch('resize');
          jest.advanceTimersByTime(20);
        });
        // Still mid-dismiss: remounting now would anchor to stale geometry.
        expect(result.current).toBe(true);

        act(() => {
          jest.advanceTimersByTime(400);
        });
        expect(result.current).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('isKeyboardTarget', () => {
    it('accepts text-entry fields and rejects everything else', () => {
      const make = (html: string) => {
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        return wrap.firstElementChild;
      };
      expect(isKeyboardTarget(make('<input type="number">'))).toBe(true);
      expect(isKeyboardTarget(make('<input>'))).toBe(true);
      expect(isKeyboardTarget(make('<textarea></textarea>'))).toBe(true);
      expect(isKeyboardTarget(make('<input type="checkbox">'))).toBe(false);
      expect(isKeyboardTarget(make('<input readonly>'))).toBe(false);
      expect(isKeyboardTarget(make('<input inputmode="none">'))).toBe(false);
      expect(isKeyboardTarget(make('<button>x</button>'))).toBe(false);
      expect(isKeyboardTarget(document.body)).toBe(false);
      expect(isKeyboardTarget(null)).toBe(false);
    });
  });

  describe('native (Capacitor keyboard events)', () => {
    beforeEach(() => {
      mockIsNative.mockReturnValue(true);
    });

    it('follows keyboardWillShow / keyboardWillHide window events', async () => {
      const { result } = renderHook(() => useKeyboardOpen());
      expect(result.current).toBe(false);
      focusTextInput();

      act(() => {
        window.dispatchEvent(new Event('keyboardWillShow'));
      });
      expect(result.current).toBe(true);

      act(() => {
        window.dispatchEvent(new Event('keyboardWillHide'));
      });
      await waitFor(() => expect(result.current).toBe(false));
    });

    it('recovers from a missed hide event once focus leaves the field', async () => {
      const { result } = renderHook(() => useKeyboardOpen());
      const input = focusTextInput();

      act(() => {
        window.dispatchEvent(new Event('keyboardWillShow'));
      });
      expect(result.current).toBe(true);

      act(() => input.blur());
      await waitFor(() => expect(result.current).toBe(false));
    });

    it('stops listening after unmount', () => {
      const { result, unmount } = renderHook(() => useKeyboardOpen());
      unmount();
      window.dispatchEvent(new Event('keyboardWillShow'));
      expect(result.current).toBe(false);
    });
  });
});
