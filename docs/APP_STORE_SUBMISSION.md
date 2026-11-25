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
| **User Content → Photos or Videos** | Yes | Progress photos, nutrition-label photos | App Functionality |
| **User Content → Other User Content** | Yes | Workout notes, custom exercises and foods, meal descriptions typed for AI logging | App Functionality |
| **Identifiers → User ID** | Yes | Supabase user ID | App Functionality |
| **Purchases → Purchase history** | Yes | Subscription tier/status. In the iOS app via Apple In-App Purchase (verified on our server); on the web via Stripe | App Functionality |
| **Sensitive Info (health/medical)** | Yes* | Optional medication note (e.g., GLP-1) used to tailor protein targets | App Functionality |
| **Usage Data** | No | No analytics/tracking SDK is currently integrated | — |
| **Diagnostics** | No | No crash/perf reporting SDK is currently integrated | — |
| **Location → Coarse location** | Yes | Approximate location (when granted) to suggest which gym you are training at | App Functionality |
| **Financial Info (payment card)** | No | Card data is collected by Stripe on the web, never by the app | — |

Community features (shared workouts, comments, reactions, public profiles) are
turned off in this version (`lib/socialFeatures.ts`), so they are not declared.

AI features send the data they need to **Anthropic** (meal and label logging,
progress-photo estimates) and **xAI** (AI coach), only after the in-app consent
sheet. Those are service providers acting for us, not tracking, so nothing
changes in the table, but the privacy policy names them.

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

<!-- Apple Health (read-only: steps, active energy, sleep, heart rate) -->
<key>NSHealthShareUsageDescription</key>
<string>HyperTrack reads your sleep, steps, active energy, and heart-rate data from Apple Health to improve recovery and calorie estimates.</string>
```

Notes:
- **`NSHealthUpdateUsageDescription` is required** even though the HealthKit
  integration is read-only (`write: []`): the plugin links the write APIs, and
  App Store Connect rejects the upload without it. The string says the app
  never writes to Health.
- The default HealthKit permission request covers sleep, steps, active energy (calories), 
  and heart-rate data (HRV and resting HR). Workouts are NOT requested by default — 
  they're only available if callers explicitly pass `workouts` in the permissions array.
- **`NSLocationWhenInUseUsageDescription` already present** — the app uses
  approximate location to suggest which gym you're training at
  (`lib/geo/currentPosition.ts` → `services/gymProximity.ts`). The permission
  request is optional and denied gracefully (picker still works unsorted).
  **Android equivalent:** When `npx cap add android` is run, add
  `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` to
  `android/app/src/main/AndroidManifest.xml`.
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
- **Privacy Policy URL** — `https://www.hypertrack.app/privacy`
- **Support URL** — `https://www.hypertrack.app/support`
- **Description, keywords, category** (Health & Fitness), **age rating**
  questionnaire.

---

## 6. Placeholders to confirm before submitting

- ⚠️ Contact emails: `privacy@hypertrack.app` (privacy page) and
  `support@hypertrack.app` (terms page) — make sure these inboxes exist.
- ⚠️ Legal entity name + governing-law jurisdiction in `/terms` and `/privacy`.
- ✅ Production domain: `https://www.hypertrack.app`.

---

## 7. Store listing copy (paste-ready)

Paste into App Store Connect → **HyperTrack: Hypertrophy Coach** (`app.hypertrack.workout`) → version 1.0.
Every field fits Apple's limit; character counts are in brackets.

| Field | Where | Value |
|---|---|---|
| Name [29/30] | App Information | `HyperTrack: Hypertrophy Coach` (already set) |
| Subtitle [28/30] | App Information | `Lift smarter. Eat on target.` |
| Subtitle, alternative [29/30] | | `Workout log for muscle growth` |
| Primary category | App Information | Health & Fitness |
| Secondary category | App Information | Food & Drink |
| Privacy Policy URL | App Information | `https://www.hypertrack.app/privacy` |
| Support URL | Version 1.0 | `https://www.hypertrack.app/support` |
| Marketing URL | Version 1.0 | `https://www.hypertrack.app` |
| Copyright | Version 1.0 | ⚠️ `2026 <your name or company>` |

**Promotional text** [154/170], which you can change at any time without a new review:

```text
Log a set in one tap, get your next weight from your last session, and see weekly sets per muscle against your recovery range. 14 days of everything free.
```

**Keywords** [99/100], comma-separated with no spaces. They don't repeat words already in the name or subtitle (Apple indexes those anyway) and name no other apps (Guideline 2.3.7):

```text
workout,gym,tracker,lifting,weightlifting,bodybuilding,strength,macro,calorie,protein,program,split
```

**Description** [2708/4000]:

```text
HyperTrack is a workout log and nutrition tracker built for one goal: building muscle. It tells you what to lift next, how much training each muscle got this week, and whether you're eating enough to grow.

LOG WORKOUTS FAST
• Log a set in one tap. Weight and reps come prefilled from your last session.
• Suggested weights explain themselves ("From your last session…") and round to plates you can actually load.
• Warm-up sets are planned for you.
• The rest timer runs on your Lock Screen and Dynamic Island, and alerts you when rest is over, even with the app closed.
• Log sets from your Apple Watch.

TRAIN THE RIGHT AMOUNT
• See weekly sets for every muscle against its recovery range (minimum effective to maximum recoverable volume).
• Build a multi-week training block that follows the split you choose: full body, upper/lower, push/pull/legs and more.
• Volume adapts to how you recover, based on your performance and daily check-ins.
• Tell the app what hurts and it swaps exercises that load that area instead of dropping the muscle.

EAT TO GROW
• Log food by search, barcode or nutrition-label photo, or describe a meal in plain words.
• Portions in household units ("1 large egg · 50 g"), with recent and frequent foods one tap away.
• Calorie and protein targets that show how they were set, and adjust to your rate of gain or loss.

SEE YOUR PROGRESS
• Strength trends and estimated maxes for your main lifts.
• Body weight trend, measurements and progress photos side by side.
• Sleep, steps and heart rate from Apple Health (read only), next to your training.

YOUR DATA, YOUR WAY
• Import past workouts from a CSV export.
• Widgets for your home screen.
• Adjustable text size and a beginner mode with plain-language explanations.
• Delete your account and data at any time, right in the app.

PLANS
Every new account gets 14 days of Elite free. No payment details needed. After that, workout and food logging stay free.
• Pro: training block builder, smart weight suggestions, advanced analytics, and AI meal and label logging.
• Elite: everything in Pro, plus the AI coach, coaching calibration, strength percentiles and advanced body composition analysis.

Pro and Elite are auto-renewing monthly or yearly subscriptions. Payment is charged to your Apple Account at confirmation of purchase. A subscription renews automatically unless it is canceled at least 24 hours before the end of the current period. Manage or cancel it in your Apple Account settings.

AI features are optional and ask for your permission first. Body composition figures are estimates for fitness purposes, not medical advice.

Terms: https://www.hypertrack.app/terms
Privacy: https://www.hypertrack.app/privacy
```

### Age rating

Answer **None** to everything, with two exceptions to check:
- **Medical/Treatment Information:** **Infrequent/Mild**. The app shows body-composition estimates, blood-pressure logs and a GLP-1 protein note.
- **Unrestricted Web Access:** **No**. The app is a Capacitor shell for our own site, and outside links open in Safari.

The expected result is 4+, or 12+ if Apple counts the medical answer.

### App Review Information

- **Sign-in required:** Yes. ⚠️ Fill in the demo account's email and password. Use a dedicated reviewer account with seeded data, not your own account.
- **Contact:** your name, phone and `support@hypertrack.app`.
- **Notes** [1853/4000]:

```text
DEMO ACCOUNT
Sign in with the demo account above. It has workouts, food logs and an active training block, so every screen has data. New accounts also work: each gets 14 days of Elite free (no payment details), then keeps free logging.

SUBSCRIPTIONS (Guideline 3.1.1)
Pro and Elite are sold only through In-App Purchase in this app: More → Plans & billing. The screen shows each plan's length and price, the auto-renew terms, Restore purchases, and Terms and Privacy links. Purchases are verified on our server with Apple's signed transactions. The app has no link to any other way to pay.

ACCOUNT DELETION (5.1.1(v))
Settings → Account → Delete Account. It permanently deletes the account and all of its data.

AI FEATURES AND THIRD-PARTY DATA (5.1.2(i))
Meal descriptions, nutrition-label photos and progress-photo estimates are processed by Anthropic. The AI coach is processed by xAI. Before any data is sent, the app asks for explicit permission and names the provider. The user can turn AI features off again in Settings → Profile. Neither provider uses this data for advertising or tracking.

APPLE HEALTH
Read only: sleep, steps, active energy and heart rate, shown next to training and used for recovery and calorie estimates. The app never writes to Apple Health.

OTHER PERMISSIONS
• Camera: food barcodes, nutrition labels and progress photos.
• Location (optional): suggests which saved gym you're at, so machine weights stay right. Everything works without it.
• Notifications: rest-timer alerts (Time Sensitive) and optional reminders.

APPLE WATCH, WIDGETS, LIVE ACTIVITY
Start a workout on the iPhone. The rest timer appears as a Live Activity, and sets can be logged from the paired Watch.

NOT IN THIS VERSION
Community and sharing features are turned off in this version, so there is no user-generated content shared between users.
```

### Subscriptions (all four show "Missing Metadata")

Group **HyperTrack** (display name "HyperTrack Membership"). Each product already has its display name, description, prices and availability. What's missing on each:

1. **Review screenshot**: a screenshot of the iOS plan screen (More → Plans & billing) from a TestFlight build, at 1290×2796 or any accepted iPhone size. The same image can go on all four.
2. **Review notes** (optional, recommended): `Purchased on More → Plans & billing. Restore purchases is on the same screen.`

Then, on the version 1.0 page, add all four under **In-App Purchases and Subscriptions** so they're reviewed with the build. Apple requires a first subscription to be submitted together with a new app version.

⚠️ **Price check:** Elite Yearly is **$199.99** in App Store Connect but `TIER_FEATURES.elite.yearlyPrice` is **199** on the web. Pick one. The iOS screen reads its prices from the App Store, so it is right either way, but the web pricing page and the App Store will disagree.

⚠️ **Trial risk (3.1.2):** every new account gets 14 days of Elite free on the server, without an App Store introductory offer. Reviewers sometimes ask for app-wide trials of subscription content to go through an introductory offer. If they do, add a 2-week free introductory offer to each subscription and make the server trial web-only.

### Before you press Submit

- [ ] Build **8** attached to version 1.0. It is today's upload; Xcode renumbered it from 7 because a build 7 already existed.
- [ ] iPhone screenshots: 6.9" (1320×2868 or 1290×2796) is required. No iPad screenshots: the app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`).
- [ ] Apple Watch screenshots: required because build 8 includes the Watch app. Take them in the Watch simulator, at any one accepted size.
- [ ] App Privacy questionnaire answered from section 1.
- [ ] Paid Apps agreement, tax and banking active in Business. Without them, purchases fail in review.
- [ ] Demo account filled in and tested on a device.
