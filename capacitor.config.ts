import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
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
  },

  // Android specific configuration
  android: {
    allowMixedContent: false,
  },

  // Plugin configuration
  plugins: {
    SplashScreen: {
      // Reduced from 2000ms - web splash provides the branded experience
      launchShowDuration: 500,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      // Auto-hide once web view is ready
      launchAutoHide: true,
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
