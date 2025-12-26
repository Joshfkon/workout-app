/**
 * Capacitor Integration
 *
 * Provides real Capacitor functionality when running in a native app,
 * with safe fallbacks for web-only environments.
 */

import { Capacitor as CapacitorCore } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

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

/**
 * Initialize Capacitor app listeners
 * Call this once when the app starts
 */
export function initializeCapacitorListeners(): void {
  if (!isNativePlatform()) {
    return;
  }

  // Handle deep links (OAuth callbacks, etc.)
  App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
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
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      // App came to foreground
      console.log('[Capacitor] App resumed');
    } else {
      // App went to background
      console.log('[Capacitor] App backgrounded');
    }
  });

  // Handle back button (Android)
  App.addListener('backButton', ({ canGoBack }) => {
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
