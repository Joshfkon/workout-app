/**
 * Capacitor Integration
 *
 * Provides real Capacitor functionality when running in a native app,
 * with safe fallbacks for web-only environments.
 */

// Optional Capacitor imports - only available in native builds
let CapacitorCore: any;
let Browser: any;
let App: any;
let StatusBar: any;
let SplashScreen: any;
let Style: any;

try {
  CapacitorCore = require('@capacitor/core').Capacitor;
  Browser = require('@capacitor/browser').Browser;
  App = require('@capacitor/app').App;
  StatusBar = require('@capacitor/status-bar').StatusBar;
  SplashScreen = require('@capacitor/splash-screen').SplashScreen;
  Style = require('@capacitor/status-bar').Style;
} catch (e) {
  // Capacitor not available (web-only build)
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
  Style = { Dark: 'DARK' };
}

// Re-export Capacitor for platform detection
export const Capacitor = CapacitorCore || {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
};

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

/**
 * Initialize Capacitor app listeners
 * Call this once when the app starts
 */
export function initializeCapacitorListeners(): void {
  if (!isNativePlatform() || !App) {
    return;
  }

  // Handle deep links (OAuth callbacks, etc.)
  App.addListener('appUrlOpen', (event: any) => {
    const url = new URL(event.url);

    // Handle authentication callbacks
    if (url.pathname.startsWith('/auth/callback')) {
      window.location.href = url.pathname + url.search;
    }

    // Handle Fitbit OAuth callback
    if (url.pathname.startsWith('/api/integrations/fitbit/callback')) {
      window.location.href = url.pathname + url.search;
    }

    // Handle custom scheme links (hypertrack://)
    if (url.protocol === 'hypertrack:') {
      const path = url.pathname || url.hostname;
      if (path) {
        window.location.href = '/' + path + url.search;
      }
    }
  });

  // Handle app state changes
  App.addListener('appStateChange', ({ isActive }: { isActive: boolean }) => {
    if (isActive) {
      // App came to foreground
      console.log('[Capacitor] App resumed');
    } else {
      // App went to background
      console.log('[Capacitor] App backgrounded');
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
