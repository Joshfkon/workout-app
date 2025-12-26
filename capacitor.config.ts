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
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
