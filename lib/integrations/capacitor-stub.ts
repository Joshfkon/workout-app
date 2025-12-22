/**
 * Capacitor Stub
 *
 * Provides a fallback when @capacitor/core is not installed.
 * This allows the app to build in web-only environments while
 * native integrations remain available when running in Capacitor.
 */

interface CapacitorStub {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

// Try to load the real Capacitor, fall back to stub
let CapacitorInstance: CapacitorStub;

try {
  // Dynamic require to avoid build-time errors
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const capacitorCore = require('@capacitor/core');
  CapacitorInstance = capacitorCore.Capacitor;
} catch {
  // Stub for web-only builds
  CapacitorInstance = {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  };
}

export const Capacitor = CapacitorInstance;
