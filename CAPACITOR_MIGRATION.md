# Capacitor Migration Guide

This document tracks the progress of wrapping HyperTrack PWA in a native shell using Capacitor for App Store distribution.

## Current Status: Phase 1-3 Complete

**Readiness Score: ~90%** - Capacitor installed and configured, needs app icons and native platforms.

### Next Steps

1. **Generate app icons** from `public/favicon.svg`:
   - `icon-192.png` (192x192) - Android/manifest
   - `icon-512.png` (512x512) - Android splash/manifest
   - `apple-icon.png` (180x180) - iOS home screen

2. **Add native platforms** (requires macOS for iOS):
   ```bash
   npx cap add ios      # Requires Xcode
   npx cap add android  # Requires Android Studio
   ```

3. **Configure deep linking** in native projects (see Phase 5 below)

4. **Deploy production server** with `NEXT_PUBLIC_APP_URL` set

5. **Test on devices** with `npm run cap:livereload:ios` or `cap:livereload:android`

---

## Completed Preparations

- [x] PWA manifest configured (`public/manifest.json`)
- [x] Service worker with offline support (`public/sw.js`)
- [x] Capacitor platform detection stub (`lib/integrations/capacitor-stub.ts`)
- [x] HealthKit integration code ready (`lib/integrations/healthkit.ts`)
- [x] Google Fit integration code ready (`lib/integrations/google-fit.ts`)
- [x] Native app behavior provider (`components/providers/NativeAppBehavior.tsx`)
- [x] Viewport configured for notches (`viewportFit: "cover"`)
- [x] `next.config.mjs` has Capacitor-aware image config
- [x] Safe-area CSS utilities added to Tailwind
- [x] Removed hardcoded localhost fallbacks in Stripe routes
- [x] Browser API safety checks throughout codebase

---

## Pre-Migration Checklist

### Required Before Adding Capacitor

| Task | Status | Notes |
|------|--------|-------|
| Create app icons | ❌ TODO | Need 192x192 and 512x512 PNG in `/public` |
| Create Apple icon | ❌ TODO | Need `/public/apple-icon.png` (180x180) |
| Set `NEXT_PUBLIC_APP_URL` | ❌ Verify | Must be set in production environment |
| Deploy to production server | ❌ TODO | Capacitor WebView will point to this URL |

### Capacitor Installation (Complete)

| Task | Status | Notes |
|------|--------|-------|
| Install @capacitor/core | ✅ Done | v8.0.0 |
| Install @capacitor/cli | ✅ Done | v8.0.0 |
| Initialize capacitor.config.ts | ✅ Done | Configured for hosted app |
| Install @capacitor/ios | ✅ Done | v8.0.0 |
| Install @capacitor/android | ✅ Done | v8.0.0 |
| Install @capacitor/browser | ✅ Done | For OAuth flows |
| Install @capacitor/app | ✅ Done | Deep linking & lifecycle |
| Install @capacitor/status-bar | ✅ Done | Dark theme styling |
| Install @capacitor/splash-screen | ✅ Done | Launch screen |
| Install @capacitor/push-notifications | ✅ Done | Optional notifications |
| Update capacitor-stub.ts | ✅ Done | Real implementations |
| Add npm scripts | ✅ Done | cap:sync, cap:ios, etc. |

### App Icons Needed

Generate from `public/favicon.svg`:

```
public/
├── icon-192.png      # 192x192 (manifest, Android)
├── icon-512.png      # 512x512 (manifest, Android splash)
├── apple-icon.png    # 180x180 (iOS home screen)
└── favicon.svg       # ✅ Already exists
```

**Tools:** [RealFaviconGenerator](https://realfavicongenerator.net/), Figma, or ImageMagick.

---

## Architecture Decision

### Hosted App Approach (Recommended)

Since HyperTrack uses server-side features (API routes for Stripe, OAuth, AI coaching), the Capacitor app will be a **WebView pointing to your hosted server**.

```
┌─────────────────────────────────────────┐
│           iOS/Android App               │
│  ┌───────────────────────────────────┐  │
│  │      Capacitor WebView            │  │
│  │                                   │  │
│  │   Points to: https://hypertrack.app  │
│  │                                   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Native Bridges:                        │
│  • HealthKit (iOS)                      │
│  • Google Fit (Android)                 │
│  • Push Notifications                   │
│  • Status Bar                           │
└─────────────────────────────────────────┘
```

**Why not static export?**
- App uses `/api` routes (Stripe webhooks, Fitbit OAuth, Claude AI)
- Server-side auth with Supabase
- Dynamic data fetching

---

## Migration Steps

### Phase 1: Install Capacitor

```bash
# Core packages
npm install @capacitor/core @capacitor/cli

# Initialize project
npx cap init "HyperTrack" "app.hypertrack.workout"

# Platform packages
npm install @capacitor/ios @capacitor/android

# Add platforms
npx cap add ios
npx cap add android
```

### Phase 2: Configure Capacitor

Create/update `capacitor.config.ts`:

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.hypertrack.workout',
  appName: 'HyperTrack',
  webDir: 'out',

  // Point to hosted app
  server: {
    url: 'https://hypertrack.app', // Your production URL
    cleartext: false,
  },

  // iOS specific
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false,
  },

  // Android specific
  android: {
    allowMixedContent: false,
  },

  // Plugin configuration
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0a0a0a',
      showSpinner: false,
    },
  },
};

export default config;
```

### Phase 3: Install Recommended Plugins

```bash
# OAuth external browser
npm install @capacitor/browser

# App lifecycle & deep linking
npm install @capacitor/app

# Status bar customization
npm install @capacitor/status-bar

# Splash screen
npm install @capacitor/splash-screen

# Push notifications (optional)
npm install @capacitor/push-notifications

# Wearables (already have integration code)
npm install @nickcis/capacitor-healthkit  # iOS
npm install capacitor-google-fit          # Android
```

### Phase 4: Update Capacitor Stub

Replace the stub at `lib/integrations/capacitor-stub.ts` with real Capacitor imports:

```typescript
import { Browser } from '@capacitor/browser';
import { App } from '@capacitor/app';

export const openExternalUrl = async (url: string): Promise<void> => {
  if (isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, '_blank');
  }
};

// Add deep link listener
App.addListener('appUrlOpen', (event) => {
  const url = new URL(event.url);
  // Handle deep links (OAuth callbacks, etc.)
  if (url.pathname.startsWith('/auth/callback')) {
    window.location.href = url.pathname + url.search;
  }
});
```

### Phase 5: Configure Deep Linking

**iOS** - Add to `ios/App/App/Info.plist`:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>hypertrack</string>
    </array>
  </dict>
</array>
```

**Android** - Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="hypertrack" />
</intent-filter>
```

### Phase 6: Build & Test

```bash
# Sync web assets to native projects
npx cap sync

# Open in Xcode
npx cap open ios

# Open in Android Studio
npx cap open android

# Live reload during development
npx cap run ios --livereload --external
npx cap run android --livereload --external
```

---

## App Store Requirements

### iOS (App Store)

- [ ] Apple Developer account ($99/year)
- [ ] App icons (1024x1024 for App Store)
- [ ] Screenshots for all device sizes
- [ ] Privacy policy URL
- [ ] App description and keywords
- [ ] HealthKit usage description (if using health data)
- [ ] Sign in with Apple (if offering social login)

### Android (Google Play)

- [ ] Google Play Developer account ($25 one-time)
- [ ] App icons and feature graphic
- [ ] Screenshots for phone and tablet
- [ ] Privacy policy URL
- [ ] Content rating questionnaire
- [ ] Target API level compliance

---

## OAuth Callback URLs

Update these in your OAuth providers when deploying:

| Provider | Web Callback | Native Callback |
|----------|--------------|-----------------|
| Supabase | `https://hypertrack.app/auth/callback` | `hypertrack://auth/callback` |
| Fitbit | `https://hypertrack.app/api/integrations/fitbit/callback` | Same (uses in-app browser) |
| Stripe | N/A (webhook) | N/A |

---

## Environment Variables

Ensure these are set in production:

```env
# Required for Capacitor
NEXT_PUBLIC_APP_URL=https://hypertrack.app

# Existing (no changes needed)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
STRIPE_SECRET_KEY=...
```

---

## Troubleshooting

### Common Issues

**WebView shows blank page**
- Check `server.url` in capacitor.config.ts
- Verify CORS headers allow Capacitor origin
- Check browser console in Safari (iOS) or Chrome DevTools (Android)

**OAuth not returning to app**
- Verify deep link scheme matches config
- Check URL scheme is registered in native config
- Use `@capacitor/browser` instead of `window.open`

**HealthKit/Google Fit not connecting**
- Verify native permissions in Info.plist / AndroidManifest.xml
- Check plugin is properly installed: `npx cap sync`
- Test on real device (simulators have limited health data)

---

## Progress Log

| Date | Change | Author |
|------|--------|--------|
| 2024-XX-XX | Initial migration prep: safe-area CSS, removed localhost fallbacks | Claude |
| 2025-12-26 | Phase 1-3 complete: Installed Capacitor core, platforms, and plugins (v8.0.0) | Claude |
| 2025-12-26 | Created capacitor.config.ts with hosted app configuration | Claude |
| 2025-12-26 | Updated capacitor-stub.ts with real Capacitor implementations | Claude |
| 2025-12-26 | Added npm scripts: cap:sync, cap:ios, cap:android, cap:run:*, cap:livereload:* | Claude |
| | | |

---

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Capacitor + Next.js Guide](https://capacitorjs.com/docs/getting-started/with-nextjs)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policy Center](https://play.google.com/console/about/guides/releasewithconfidence/)
