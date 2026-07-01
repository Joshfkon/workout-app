# App Store Submission Reference

Practical, paste-ready answers for the iOS submission, derived from what the code
actually does. Review and fill the `⚠️` placeholders before submitting.

Related: `CAPACITOR_MIGRATION.md` (build/runtime setup), `/privacy` and `/terms`
(public legal pages).

---

## 1. App Privacy ("nutrition label") questionnaire

In App Store Connect → your app → **App Privacy**. We do **not** use data for
tracking (no ads, no cross-app/cross-site tracking SDKs), and we do **not** use
any third-party advertising. Everything below is **linked to the user's identity**
and used for **App Functionality** (plus the specific purposes noted).

| Apple data type | Collected? | Examples in the app | Purpose |
|---|---|---|---|
| **Contact Info → Email address** | Yes | Account email (Supabase auth) | App Functionality, Account management |
| **Health & Fitness** | Yes | Workouts, sets/reps/load, RPE, body composition (DEXA, FFMI, measurements), nutrition/food logs, steps & active energy & heart rate (from Apple Health, read-only) | App Functionality |
| **User Content** | Yes | Profile (username, avatar, bio), shared workouts, comments, reactions | App Functionality |
| **Identifiers → User ID** | Yes | Supabase user ID | App Functionality |
| **Purchases → Purchase history** | Yes | Subscription tier/status (billing handled on web via Stripe) | App Functionality |
| **Sensitive Info (health/medical)** | Yes* | Optional medication note (e.g., GLP-1) used to tailor protein targets | App Functionality |
| **Usage Data** | No | No analytics/tracking SDK is currently integrated | — |
| **Diagnostics** | No | No crash/perf reporting SDK is currently integrated | — |
| **Location** | No | App does not request location | — |
| **Financial Info (payment card)** | No | Card data is collected by Stripe on the web, never by the app | — |

\* Apple's questionnaire groups some of this under "Health & Fitness." Declare the
medication note honestly — it is user-provided health information.

**Account deletion:** answer **Yes** to "Does your app support account deletion?"
The in-app flow is at *Settings → Account → Delete Account*.

> If you later add an analytics or crash-reporting SDK (e.g., Sentry, PostHog,
> Firebase), update **Usage Data** / **Diagnostics** above and the privacy policy.

---

## 2. iOS permission strings (Info.plist)

After `npx cap add ios`, add these keys to `ios/App/App/Info.plist`. Capacitor
does not add them for you, and the app will crash (and be rejected) if a
permission is requested without its usage string.

```xml
<!-- Barcode scanner for nutrition logging (components/nutrition/BarcodeScanner.tsx) -->
<key>NSCameraUsageDescription</key>
<string>HyperTrack uses the camera to scan food barcodes so you can quickly log nutrition.</string>

<!-- Apple Health (read-only: steps, active energy, workouts, heart rate) -->
<key>NSHealthShareUsageDescription</key>
<string>HyperTrack reads your steps, active energy, workouts, and heart-rate data from Apple Health to improve recovery and calorie estimates.</string>
```

Notes:
- **No `NSHealthUpdateUsageDescription` needed** — the HealthKit integration is
  read-only (`lib/integrations/healthkit.ts`, `write: []`). Add it only if you
  later write data back to Health.
- **No location string** — the app does not use location.
- The deep-link URL scheme (`hypertrack`) still needs the `CFBundleURLTypes`
  block from `CAPACITOR_MIGRATION.md` (Phase 5).

---

## 3. Xcode capabilities to enable

In the Xcode target → **Signing & Capabilities**, add:
- **HealthKit** (for Apple Health reads). Leave "Clinical Health Records" off.
- **Push Notifications** (uses `@capacitor/push-notifications`) — requires an APNs
  key in your Apple Developer account. If you are not shipping push at launch,
  remove the plugin usage instead of enabling an unused capability.

---

## 4. Privacy manifest (PrivacyInfo.xcprivacy)

Apple requires a privacy manifest. Capacitor 8 generates a base manifest for its
plugins; verify it exists after `cap sync` and that it declares:
- `NSPrivacyTracking` = `false` (we don't track).
- Empty `NSPrivacyTrackingDomains`.
- "Required reason" API declarations for any plugin that uses them (e.g.,
  `UserDefaults` → reason `CA92.1`). Confirm none are missing at archive time;
  Apple emails you if a declaration is absent.

---

## 5. Store listing assets still needed

- **Screenshots** — captured from a real build (6.7" iPhone required; 6.5"/5.5"
  and iPad if you support them).
- **App icon** — already generated: `public/icon-1024.png` (upload to App Store
  Connect; the in-app icons are wired via `app/layout.tsx` + manifest).
- **Privacy Policy URL** — `https://<your-domain>/privacy` (live once deployed).
- **Support URL** — a reachable page or mailto.
- **Description, keywords, category** (Health & Fitness), **age rating**
  questionnaire.

---

## 6. Placeholders to confirm before submitting

- ⚠️ Contact emails: `privacy@hypertrack.app` (privacy page) and
  `support@hypertrack.app` (terms page) — make sure these inboxes exist.
- ⚠️ Legal entity name + governing-law jurisdiction in `/terms` and `/privacy`.
- ⚠️ Production domain for the Privacy Policy / Support URLs and
  `NEXT_PUBLIC_APP_URL`.
