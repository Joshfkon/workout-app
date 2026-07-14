# Manual Xcode Steps — Apple Health (HealthKit) Integration

The HealthKit integration ships in code as `@capgo/capacitor-health` (the only
new dependency), but HealthKit is an entitlement-gated Apple capability, so a
few steps must be done by hand in Xcode on your Mac. Everything below is a
one-time setup.

## 0. Sync the native project

```bash
npm install          # pulls @capgo/capacitor-health
npm run build
npm run cap:sync     # registers the plugin with the iOS project
npm run cap:ios      # opens Xcode
```

If you have never generated the iOS project on this machine, run
`npx cap add ios` first.

## 1. Enable the HealthKit capability

In Xcode:

1. Select the **App** target → **Signing & Capabilities** tab.
2. Click **+ Capability** and add **HealthKit**.
3. Leave the optional checkboxes (Clinical Health Records, Background
   Delivery) **unchecked** — we only do foreground reads.

This adds `com.apple.developer.healthkit` to `App/App.entitlements`. Commit
that file if your `ios/` directory is under version control.

## 2. Info.plist usage description

HealthKit read access requires `NSHealthShareUsageDescription`. Add to
`ios/App/App/Info.plist`:

```xml
<key>NSHealthShareUsageDescription</key>
<string>HyperTrack reads sleep, heart, and step data to personalize recovery and calorie estimates.</string>
```

We request **no write access**, so `NSHealthUpdateUsageDescription` is not
required. (If Apple review or a plugin update ever complains about its
absence, add it with a "HyperTrack does not write health data." string — it
is only shown if a write request is ever made, which we never do.)

## 3. Regenerate provisioning

The HealthKit entitlement changes the app's provisioning requirements:

1. In **Signing & Capabilities**, with *Automatically manage signing* on,
   Xcode regenerates the profile as soon as the capability is added — just
   confirm there is no red signing error.
2. If you manage profiles manually: in the Apple Developer portal, edit the
   App ID `app.hypertrack.workout`, enable **HealthKit**, regenerate the
   provisioning profile(s), and download/assign them in Xcode.
3. Do a clean device build (`Product → Clean Build Folder`, then run). The
   iOS **Simulator supports HealthKit** and seeds no data — add sample data
   via the simulator's Health app to test.

## 4. Verify on device

1. Launch the app on an iPhone with Health data.
2. Settings → Connections → **Connect Apple Health** (the card only renders
   in the native iOS app), or accept the one-time "Auto-fill from Apple
   Health" offer on the Sleep check-in card.
3. iOS shows the Health permission sheet listing: Sleep, Heart Rate
   Variability, Resting Heart Rate, Steps, Active Energy. Grant what you
   like — the app treats missing types as absent, never as an error.
4. Foreground the app after a night with an Apple Watch: the Sleep card
   shows last night's hours with a "from Apple Health" tag, and steps flow
   into the metabolism estimate ("activity-informed" subtitle) once enough
   days accumulate.

## Notes

- **Background delivery is not wired**: `@capgo/capacitor-health` exposes no
  HealthKit observer/background-delivery API, so sync runs on every app
  foreground (with a persisted per-type anchor, so each pull is
  incremental). This matches the "background delivery as best-effort gravy"
  scope — foreground sync is the mechanism of record.
- Nothing is ever written to HealthKit; the write permission array is empty.
- Web/PWA/Android builds are unaffected: the plugin is loaded through a
  runtime dynamic import that never enters the web bundle, and all HealthKit
  UI is capability-gated.
