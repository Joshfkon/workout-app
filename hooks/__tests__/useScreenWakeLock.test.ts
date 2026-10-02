import { renderHook } from '@testing-library/react';
import { useScreenWakeLock } from '../useScreenWakeLock';
import { Capacitor } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';

// Mock Capacitor
jest.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: jest.fn(),
  },
}));

// Mock KeepAwake plugin
jest.mock('@capacitor-community/keep-awake', () => ({
  KeepAwake: {
    keepAwake: jest.fn(),
    allowSleep: jest.fn(),
  },
}));

describe('useScreenWakeLock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Native platform', () => {
    beforeEach(() => {
      (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true);
    });

    it('acquires wake lock when isActive is true', () => {
      renderHook(() => useScreenWakeLock(true));
      expect(KeepAwake.keepAwake).toHaveBeenCalledTimes(1);
    });

    it('does not acquire wake lock when isActive is false', () => {
      renderHook(() => useScreenWakeLock(false));
      expect(KeepAwake.keepAwake).not.toHaveBeenCalled();
    });

    it('releases wake lock when isActive changes from true to false', () => {
      const { rerender } = renderHook(
        ({ isActive }) => useScreenWakeLock(isActive),
        { initialProps: { isActive: true } }
      );

      expect(KeepAwake.keepAwake).toHaveBeenCalledTimes(1);
      expect(KeepAwake.allowSleep).not.toHaveBeenCalled();

      rerender({ isActive: false });

      expect(KeepAwake.allowSleep).toHaveBeenCalledTimes(1);
    });

    it('acquires wake lock when isActive changes from false to true', () => {
      const { rerender } = renderHook(
        ({ isActive }) => useScreenWakeLock(isActive),
        { initialProps: { isActive: false } }
      );

      expect(KeepAwake.keepAwake).not.toHaveBeenCalled();

      rerender({ isActive: true });

      expect(KeepAwake.keepAwake).toHaveBeenCalledTimes(1);
    });

    it('releases wake lock on unmount when active', () => {
      const { unmount } = renderHook(() => useScreenWakeLock(true));

      expect(KeepAwake.keepAwake).toHaveBeenCalledTimes(1);
      expect(KeepAwake.allowSleep).not.toHaveBeenCalled();

      unmount();

      expect(KeepAwake.allowSleep).toHaveBeenCalledTimes(1);
    });

    it('handles acquire errors gracefully', () => {
      (KeepAwake.keepAwake as jest.Mock).mockRejectedValueOnce(new Error('Permission denied'));

      // Should not throw
      expect(() => {
        renderHook(() => useScreenWakeLock(true));
      }).not.toThrow();
    });

    it('handles release errors gracefully', () => {
      (KeepAwake.allowSleep as jest.Mock).mockRejectedValueOnce(new Error('Release failed'));

      const { unmount } = renderHook(() => useScreenWakeLock(true));

      // Should not throw on unmount
      expect(() => {
        unmount();
      }).not.toThrow();
    });
  });

  describe('Web platform', () => {
    let mockWakeLock: WakeLockSentinel;
    let mockNavigator: typeof navigator;

    beforeEach(() => {
      (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(false);

      // Mock wake lock release
      mockWakeLock = {
        release: jest.fn().mockResolvedValue(undefined),
        released: false,
        type: 'screen',
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      } as unknown as WakeLockSentinel;

      // Mock navigator.wakeLock
      mockNavigator = {
        ...navigator,
        wakeLock: {
          request: jest.fn().mockResolvedValue(mockWakeLock),
        } as unknown as WakeLock,
      };
      Object.defineProperty(global, 'navigator', {
        value: mockNavigator,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Clean up visibility change listeners
      const listeners = (document as any)._listeners?.visibilitychange || [];
      listeners.forEach((listener: EventListener) => {
        document.removeEventListener('visibilitychange', listener);
      });
    });

    it('acquires wake lock when isActive is true', async () => {
      renderHook(() => useScreenWakeLock(true));
      
      // Wait for async acquire
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledWith('screen');
    });

    it('does not acquire wake lock when isActive is false', async () => {
      renderHook(() => useScreenWakeLock(false));
      
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockNavigator.wakeLock?.request).not.toHaveBeenCalled();
    });

    it('releases wake lock when isActive changes from true to false', async () => {
      const { rerender } = renderHook(
        ({ isActive }) => useScreenWakeLock(isActive),
        { initialProps: { isActive: true } }
      );

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(1);

      rerender({ isActive: false });

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockWakeLock.release).toHaveBeenCalledTimes(1);
    });

    it('releases wake lock on unmount when active', async () => {
      const { unmount } = renderHook(() => useScreenWakeLock(true));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(1);

      unmount();

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockWakeLock.release).toHaveBeenCalledTimes(1);
    });

    it('handles acquire errors gracefully', async () => {
      (mockNavigator.wakeLock!.request as jest.Mock).mockRejectedValueOnce(
        new Error('Wake lock denied')
      );

      // Should not throw
      expect(() => {
        renderHook(() => useScreenWakeLock(true));
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('handles release errors gracefully', async () => {
      (mockWakeLock.release as jest.Mock).mockRejectedValueOnce(
        new Error('Release failed')
      );

      const { unmount } = renderHook(() => useScreenWakeLock(true));

      await new Promise(resolve => setTimeout(resolve, 0));

      // Should not throw on unmount
      expect(() => {
        unmount();
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 0));
    });

    it('re-acquires wake lock on visibility change when active', async () => {
      renderHook(() => useScreenWakeLock(true));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(1);

      // Simulate visibility change to visible
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(2);
    });

    it('does not re-acquire wake lock on visibility change when inactive', async () => {
      const { rerender } = renderHook(
        ({ isActive }) => useScreenWakeLock(isActive),
        { initialProps: { isActive: true } }
      );

      await new Promise(resolve => setTimeout(resolve, 0));
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(1);

      // Make inactive
      rerender({ isActive: false });

      await new Promise(resolve => setTimeout(resolve, 0));

      // Simulate visibility change
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));

      await new Promise(resolve => setTimeout(resolve, 0));
      // Should still be 1 (not re-acquired)
      expect(mockNavigator.wakeLock?.request).toHaveBeenCalledTimes(1);
    });

    it('does nothing when wake lock API is not available', async () => {
      // Remove wakeLock from navigator
      const navWithoutWakeLock = { ...navigator };
      delete (navWithoutWakeLock as any).wakeLock;
      Object.defineProperty(global, 'navigator', {
        value: navWithoutWakeLock,
        writable: true,
        configurable: true,
      });

      // Should not throw
      expect(() => {
        renderHook(() => useScreenWakeLock(true));
      }).not.toThrow();

      await new Promise(resolve => setTimeout(resolve, 0));
    });
  });
});
