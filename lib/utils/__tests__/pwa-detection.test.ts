/** @jest-environment jsdom */
import { getPWAContext, isNativeAppRuntime, shouldShowInstallPrompt } from '../pwa-detection';

const setCapacitor = (native: boolean | undefined) => {
  if (native === undefined) delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  else (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => native };
};

beforeAll(() => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});
afterEach(() => setCapacitor(undefined));

describe('native app counts as installed', () => {
  it('a browser tab is not installed and may be offered the install guide', () => {
    expect(isNativeAppRuntime()).toBe(false);
    const ctx = getPWAContext();
    expect(ctx.isNativeApp).toBe(false);
    expect(ctx.isStandalone).toBe(false);
  });

  it('inside the native app: installed, never offered "add to home screen"', () => {
    setCapacitor(true);
    const ctx = getPWAContext();
    expect(ctx.isNativeApp).toBe(true);
    expect(ctx.isStandalone).toBe(true);
    expect(shouldShowInstallPrompt({ ...ctx, platform: 'ios' })).toBe(false);
  });

  it('Capacitor present on the web build (not native) changes nothing', () => {
    setCapacitor(false);
    expect(getPWAContext().isStandalone).toBe(false);
  });
});
