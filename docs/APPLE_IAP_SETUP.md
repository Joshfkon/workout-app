# Apple in-app purchase (iOS subscriptions)

The iOS app sells Pro and Elite through the App Store (StoreKit 2). The web keeps Stripe. Both write the same `subscriptions` row, so every tier check works the same way whichever store billed it.

**Why:** App Store Guideline 3.1.1 / 3.1.3(b). An iOS app that unlocks a subscription bought on the web must also sell that subscription in the app. A fitness app doesn't qualify for the "reader app" exemption.

## How it works

```
iOS app (StoreKit 2)                     server                                 subscriptions row
HyperTrackPurchasesPlugin.swift
  purchase(product, appAccountToken = user id)
  → Apple's signed transaction (JWS) ──→ POST /api/apple/sync ──verify──→ upsert (service role)
  Transaction.updates (renewals,          (lib/apple/verifyJws.ts:
    Ask to Buy, other devices) ─────────→  Apple Root CA - G3 chain)
                                         ┌──────────────────────────┐
App Store Server Notifications V2 ─────→ │ POST /api/apple/notifications │ → same upsert
(renewal, expiry, refund, grace)         └──────────────────────────┘
```

- **Nothing unlocks on the device.** Every transaction is verified on the server against Apple's certificate chain, which is pinned to the Apple Root CA - G3 fingerprint. No App Store Connect API key is needed.
- **Purchases are tagged with the account.** `appAccountToken` is the HyperTrack user id. A purchase made on another account is refused rather than shared, and a notification finds its account from this token.
- **Lifetime promo rows are never touched.**
- **Web subscribers are protected.** An active Stripe subscription is never downgraded by Apple data. A web subscriber sees "billed through hypertrack.app" on iOS instead of buy buttons.
- **Older app builds keep working.** The web build is loaded from the server, so it checks whether the plugin is present (`isApplePurchasesAvailable()`). An installed app build that predates the plugin keeps the old "plans are managed on the web" screen, with no price, button or link.

Code:
- `lib/apple/`: product IDs, verification, subscription state and the upsert.
- `app/api/apple/`: the sync and notifications routes.
- `lib/integrations/applePurchases.ts`, `components/subscription/ApplePlans.tsx` and `AppleEntitlementSync.tsx`: the app side.
- `ios/App/App/HyperTrackPurchasesPlugin.swift`: the native plugin.

## One-time setup

1. **Apply the migration:** `supabase/migrations/20261124000001_subscriptions_apple_iap.sql`.
2. **Accept the agreement.** In App Store Connect → Business, accept the **Paid Apps agreement** and add banking and tax details.
3. **Apply for the App Store Small Business Program.** It cuts Apple's commission to 15%.
4. **Create the subscriptions.** In App Store Connect → your app → Subscriptions, create one group named **HyperTrack** with these products. The IDs must match `lib/apple/iapProducts.ts`.

   | Product ID | Level | Price |
   |---|---|---|
   | `app.hypertrack.workout.elite.monthly` | 1 (highest) | $19.99 / month |
   | `app.hypertrack.workout.elite.yearly` | 1 | $199.99 / year |
   | `app.hypertrack.workout.pro.monthly` | 2 | $4.99 / month |
   | `app.hypertrack.workout.pro.yearly` | 2 | $39.99 / year |

   - Elite yearly is $199 on Stripe. App Store prices end in .99, so use $199.99, or change Stripe to match.
   - Each product needs a display name, a description and a review screenshot of the iOS pricing screen.
5. **Set the notifications URL.** In App Store Connect → App Information → **App Store Server Notifications**, set Production and Sandbox to `https://www.hypertrack.app/api/apple/notifications` with **Version 2**. Then send a test notification from that page; the route answers `{"ok":true,"test":true}`.
6. **Add the capability.** In Xcode, open App target → Signing & Capabilities and add **In-App Purchase**.
7. **Update the App Store metadata.** Add the Terms of Use (EULA) link and the privacy policy link to the description. The purchase screen already links to `/terms` and `/privacy` and shows the auto-renew terms.
8. **Ship an app build.** The plugin is native code, so it reaches users only through an App Store update. The web part is already live once deployed; older builds simply don't show the buy buttons.

## Testing

- **Simulator, no App Store Connect needed:**
  1. In Xcode, open Product → Scheme → Edit Scheme → Run → Options → StoreKit Configuration and select `HyperTrack.storekit`.
  2. Point the app at a local server with `npm run cap:livereload:ios`.

  Transactions from this setup are signed locally (environment `Xcode`). The server accepts them only when `NODE_ENV` is not `production`.
- **Sandbox:** create a Sandbox tester in App Store Connect → Users and Access. Sign in under Settings → App Store → Sandbox Account on a device running a TestFlight or Xcode build. Sandbox transactions are signed by Apple, so they are fully verified.
- **Unit tests:** `lib/apple/__tests__`. They cover signature verification with a throwaway test chain, the subscription state, and the rules for who wins.
