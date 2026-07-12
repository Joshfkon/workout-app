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
  webDir: 'out',

  // Point to hosted app (production URL)
  // For local development, comment out server block or use livereload
  server: {
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://hypertrack.app',
    cleartext: false,
  },

  // iOS specific configuration
  ios: {
    contentInset: 'automatic',
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
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
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
