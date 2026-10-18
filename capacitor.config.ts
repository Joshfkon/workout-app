import type { CapacitorConfig } from '@capacitor/cli';

// Capacitor's typed config doesn't expose the WKWebView media flags, so we
// widen the `ios` block to record `allowsInlineMediaPlayback` explicitly.
// Note: Capacitor 8 already forces inline playback natively in
// `CAPBridgeViewController.webViewConfiguration`
// (`allowsInlineMediaPlayback = true`, `mediaTypesRequiringUserActionForPlayback = []`),
// so tapped YouTube embeds play in place instead of going native-fullscreen,
// and user-initiated tap-to-play needs no user-gesture adjustment. This entry
// documents and pins that intent.
type IOSConfig = NonNullable<CapacitorConfig['ios']> & {
  allowsInlineMediaPlayback?: boolean;
};

const config: CapacitorConfig & { ios?: IOSConfig } = {
  appId: 'app.hypertrack.workout',
  appName: 'HyperTrack',
  // Bundled into the app. The app itself loads server.url; this folder only
  // carries the offline page shown when that fails (server.errorPath).
  webDir: 'native-shell',

  // Point to hosted app (production URL)
  // For local development, comment out server block or use livereload
  server: {
    // Must be the CANONICAL host: hypertrack.app 308-redirects to www, and
    // Capacitor hands any navigation to a different host to Safari — the
    // app would open the browser instead of showing the site.
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://www.hypertrack.app',
    cleartext: false,
    // Shown instead of a blank screen when server.url can't load (no
    // connection, server down). Self-contained; retries server.url.
    errorPath: 'offline.html',
  },

  // iOS specific configuration
  ios: {
    contentInset: 'automatic',
    // Native view behind the webview; shows in the inset areas (e.g. under
    // the bundled offline page). Matches the app's dark surface.
    backgroundColor: '#0a0a0a',
    allowsLinkPreview: false,
    scheme: 'HyperTrack',
    // Play the tapped YouTube embed inline in WKWebView instead of forcing
    // native fullscreen (see note above — already the native default in v8).
    allowsInlineMediaPlayback: true,
  },

  // Android specific configuration
  android: {
    allowMixedContent: false,
  },

  // Plugin configuration
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      // ONE loading surface on cold start: the native splash stays up until
      // the web app paints real content, then SplashProvider hides it (on
      // boot:home-paint, with a 2.5s fallback). Auto-hide dropped the splash
      // as soon as the webview loaded, handing off to a SECOND branded web
      // splash — the "two consecutive loading animations".
      launchAutoHide: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
    Keyboard: {
      // Let the webview resize itself when the keyboard opens (plugin
      // default). useKeyboardInset listens to this plugin's show/hide events
      // and only pads modals by whatever the resize didn't absorb, so it
      // stays correct if this mode ever changes.
      resize: 'native',
    },
  },
};

export default config;
