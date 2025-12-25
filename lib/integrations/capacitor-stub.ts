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

/**
 * Opens an external URL for OAuth or other external navigation.
 *
 * In web mode: Uses window.location.href for same-tab navigation
 * In Capacitor: Should use @capacitor/browser plugin (to be implemented)
 *
 * When you add Capacitor, replace the native implementation with:
 * ```
 * import { Browser } from '@capacitor/browser';
 * await Browser.open({ url });
 * ```
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    // In Capacitor, use Browser plugin for OAuth flows
    // This will be replaced with actual Capacitor Browser plugin:
    // import { Browser } from '@capacitor/browser';
    // await Browser.open({ url, presentationStyle: 'popover' });
    console.warn(
      '[Capacitor] External URL navigation requested. Install @capacitor/browser for proper OAuth handling.',
      url
    );
    // Fallback to opening in a new window (works in WebView)
    window.open(url, '_blank');
  } else {
    // Standard web navigation
    window.location.href = url;
  }
}
