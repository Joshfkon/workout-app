/**
 * Capacitor Integration
 *
 * Provides real Capacitor functionality when running in a native app,
 * with safe fallbacks for web-only environments.
 */

// Optional Capacitor imports - use try-catch to allow web-only builds
let CapacitorCore: any;
let Browser: any;
let App: any;
let StatusBar: any;
let SplashScreen: any;

try {
  CapacitorCore = require('@capacitor/core').Capacitor;
  Browser = require('@capacitor/browser').Browser;
  App = require('@capacitor/app').App;
  StatusBar = require('@capacitor/status-bar').StatusBar;
  SplashScreen = require('@capacitor/splash-screen').SplashScreen;
} catch (e) {
  // Capacitor packages not installed - provide fallbacks
  CapacitorCore = {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
  };
  Browser = {
    open: async () => {},
    close: async () => {},
  };
  App = {
    addListener: () => ({ remove: () => {} }),
    getInfo: async () => null,
    exitApp: async () => {},
    minimizeApp: async () => {},
  };
  StatusBar = {
    setStyle: async () => {},
    setBackgroundColor: async () => {},
  };
  SplashScreen = {
    show: async () => {},
    hide: async () => {},
  };
}

// Re-export Capacitor for platform detection
export const Capacitor = CapacitorCore;

/**
 * Check if running on a native platform (iOS/Android)
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Get the current platform ('ios', 'android', or 'web')
 */
export function getPlatform(): string {
  return Capacitor.getPlatform();
}

/**
 * Opens an external URL for OAuth or other external navigation.
 *
 * In web mode: Uses window.location.href for same-tab navigation
 * In Capacitor: Uses @capacitor/browser plugin for proper in-app browser
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isNativePlatform()) {
    await Browser.open({
      url,
      presentationStyle: 'popover',
      toolbarColor: '#0a0a0a',
    });
  } else {
    window.location.href = url;
  }
}

/**
 * Close the in-app browser (if open)
 */
export async function closeExternalBrowser(): Promise<void> {
  if (isNativePlatform()) {
    await Browser.close();
  }
}

/** Hosts whose https links are this app (universal links, once configured). */
const APP_LINK_HOSTS = new Set(['hypertrack.app', 'www.hypertrack.app']);

/**
 * Turn a URL the OS handed the app into an in-app path, or null when the link
 * isn't ours.
 *
 *   hypertrack://dashboard/history?x=1      -> /dashboard/history?x=1
 *   hypertrack:///dashboard                  -> /dashboard
 *   https://www.hypertrack.app/auth/callback?code=… -> /auth/callback?code=…
 *
 * A custom-scheme URL parses with its first segment as the HOST
 * (`hypertrack://auth/callback` is host "auth", path "/callback"), so host and
 * path are rejoined. The result always starts with exactly one "/" — never
 * "//", which the browser would read as another origin — so a crafted link
 * can only ever navigate inside the app's own site.
 */
export function resolveDeepLinkPath(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  let path: string;
  if (url.protocol === 'hypertrack:') {
    path = `${url.hostname}${url.pathname}`;
  } else if (url.protocol === 'https:' && APP_LINK_HOSTS.has(url.hostname)) {
    path = url.pathname;
  } else {
    return null;
  }

  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  // A bare `hypertrack://` just brings the app forward; don't reload it.
  if (!normalized && !url.search) return null;
  return `/${normalized}${url.search}${url.hash}`;
}

let listenersInitialized = false;

/**
 * Initialize Capacitor app listeners. Safe to call more than once (the
 * listeners are registered a single time per page load).
 */
export function initializeCapacitorListeners(): void {
  if (!isNativePlatform() || listenersInitialized) {
    return;
  }
  listenersInitialized = true;

  // Deep links: the hypertrack:// scheme (Info.plist CFBundleURLSchemes) and,
  // once associated domains are set up, https universal links. The App
  // plugin holds a launch URL until this listener attaches, so a link that
  // cold-starts the app is delivered too.
  App.addListener('appUrlOpen', (event: { url: string }) => {
    const path = resolveDeepLinkPath(event.url);
    if (path) {
      window.location.href = path;
    }
  });

  // Handle back button (Android)
  App.addListener('backButton', ({ canGoBack }: { canGoBack: boolean }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      // Optionally minimize app instead of closing
      App.minimizeApp();
    }
  });
}

/**
 * Configure the status bar for the app
 */
export async function configureStatusBar(): Promise<void> {
  if (!isNativePlatform()) {
    return;
  }

  try {
    // Set dark style to match app theme
    const Style = require('@capacitor/status-bar').Style;
    await StatusBar.setStyle({ style: Style.Dark });

    // Set background color on Android
    if (getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: '#0a0a0a' });
    }
  } catch (error) {
    console.warn('[Capacitor] StatusBar configuration failed:', error);
  }
}

/**
 * Hide the splash screen (call after app is ready)
 */
export async function hideSplashScreen(): Promise<void> {
  if (!isNativePlatform()) {
    return;
  }

  try {
    await SplashScreen.hide({
      fadeOutDuration: 300,
    });
  } catch (error) {
    console.warn('[Capacitor] SplashScreen hide failed:', error);
  }
}

/**
 * Show the splash screen (useful for blocking UI during loading)
 */
export async function showSplashScreen(): Promise<void> {
  if (!isNativePlatform()) {
    return;
  }

  try {
    await SplashScreen.show({
      autoHide: false,
    });
  } catch (error) {
    console.warn('[Capacitor] SplashScreen show failed:', error);
  }
}

/**
 * Get app info (version, build number, etc.)
 */
export async function getAppInfo(): Promise<{
  name: string;
  id: string;
  build: string;
  version: string;
} | null> {
  if (!isNativePlatform()) {
    return null;
  }

  try {
    return await App.getInfo();
  } catch (error) {
    console.warn('[Capacitor] Failed to get app info:', error);
    return null;
  }
}

/**
 * Exit the app (Android only)
 */
export async function exitApp(): Promise<void> {
  if (getPlatform() === 'android') {
    await App.exitApp();
  }
}
