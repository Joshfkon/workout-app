/**
 * Capacitor Stub
 *
 * Provides a fallback when @capacitor/core is not installed.
 * This allows the app to build in web-only environments while
 * native integrations remain available when running in Capacitor.
 *
 * In native Capacitor builds, the real @capacitor/core would be available
 * and would be imported directly in healthkit.ts and google-fit.ts.
 * This stub is only used when building for web-only environments.
 */

interface CapacitorInterface {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

// Check if we're in a Capacitor environment by looking for the global
const getCapacitor = (): CapacitorInterface => {
  // In Capacitor native builds, window.Capacitor is available
  if (typeof window !== 'undefined' && 'Capacitor' in window) {
    return (window as unknown as { Capacitor: CapacitorInterface }).Capacitor;
  }

  // Fallback stub for web builds
  return {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  };
};

export const Capacitor = getCapacitor();
