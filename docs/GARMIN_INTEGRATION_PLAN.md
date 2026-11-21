# Garmin Integration Plan

Status: **plan only, nothing built.** Researched November 2026. Stress added 15 Nov 2026.

Goal: a user taps **Garmin** in the Connect Wearable sheet, signs in to Garmin, and their sleep, daily steps, HRV, resting heart rate and **stress** appear in HyperTrack. The first four are the signals Apple Health feeds today, and they should land in the same tables. Stress is Garmin-only (§1a).

Everything depends on Garmin approving developer access, so the owner's steps (§6) come first.

---

## 1. What Garmin requires

### Program and tiers

Garmin's **Connect Developer Program** covers the Health, Activity, Women's Health, Training and Courses APIs. All of them use OAuth 2.0 [1]. We only need the **Health API**.

Garmin paused new sign-ups around May 2026 and reopened the program on **21 Oct 2026** with three tiers [2][4]:

| Tier | Who it's for | Data delivery | History | Users |
|---|---|---|---|---|
| Personal | One person reading their own data | Pull only | — | Just you. Not allowed in an app with other users. |
| **Business Starter** | Individual developers, startups, companies | **Push only** | **None** | "Limited". Press reports say 1,000 connected users for free [4]. |
| Business Enterprise | Apply from the portal after Starter | Push **or** ping/pull | ≥ 1 month backfill | Unlimited users, with support |

- **Start on Business Starter.** It's free and covers launch.
- **Enterprise pricing isn't on Garmin's pages.** Press reports a ~$1,000 entry fee credited against a per-monthly-active-user bill, with billing from 1 Apr 2027 [4][5]. Treat that as unconfirmed.
- **Fees can change.** The agreement says Garmin may add fees on 30 days' notice and may charge for request volume over the limits (§10.1–10.2) [6].

### Approval process and timeline

1. Apply with Garmin's form [1][2].
2. Approval gives Developer Portal access and an **evaluation** environment.
3. Garmin says integration typically takes **1–4 weeks** [1][3]. It publishes **no timeline for approval itself**, so plan for weeks.
4. Garmin may require an **app review before production** and can revoke keys at its discretion (§4.2) [6].
   - A third-party guide says "partner verification" is required before production keys are issued [7].
   - The same guide says evaluation apps used commercially can be disabled [7].
   - **We can't ship to all users on evaluation keys.**

### OAuth: version 2.0 with PKCE

Source: Garmin's OAuth2 PKCE spec, dated 2025-06-11 [8]. Garmin's OAuth 1.0a is legacy; we would build only OAuth 2.0.

- **Authorize:** `GET https://connect.garmin.com/oauth2Confirm` with `response_type=code`, `client_id`, `code_challenge`, `code_challenge_method=S256`, `redirect_uri`, `state`.
- **Token:** `POST https://connectapi.garmin.com/di-oauth2-service/oauth/token`.
  - Code exchange sends `grant_type=authorization_code`, `client_secret`, `code_verifier`.
  - Refresh sends `grant_type=refresh_token`.
  - **Every refresh returns a new refresh token.** Always store it.
- **Lifetimes:**
  - Access token: 24 h (`expires_in: 86400`).
  - Refresh token: ~90 days (`refresh_token_expires_in: 7775998`).
  - Garmin advises refreshing at least 10 min before expiry.
- **Garmin user ID:** `GET https://apis.garmin.com/wellness-api/rest/user/id`.
  - Stays the same across re-authorizations.
  - Every push carries it. **This is how webhooks find our user.**
- **Permissions:** `GET .../wellness-api/rest/user/permissions`. Later changes arrive on the `userPermissionsChange` webhook.
- **Disconnect:**
  - If we offer "Disconnect" or "Delete account", we **must** call `DELETE .../wellness-api/rest/user/registration` [8].
  - If the user revokes access in Garmin Connect, it arrives as a `deregistrations` webhook.
  - Garmin can send a deregistration for an *old* grant after the user has reconnected, so check against the current connection before acting on it [9].

### Push vs. ping/pull

- **Starter gives Push only.** Garmin POSTs the summary JSON straight to our webhook URL, usually 1–5 minutes after the watch syncs [2][3][10].
- **Ping/pull is Enterprise only.** It sends a callback URL that we then fetch [2][3].
- **Webhook rules** (secondary source [10]):
  - Respond **HTTP 200 fast**. Anything else triggers redelivery.
  - Delivery isn't guaranteed, so expect occasional gaps.
  - The endpoint must be public HTTPS.
- **Backfill is Enterprise only** [3][9]:
  - Request ≤ 30 days at a time, within ~1 month of the user first connecting.
  - The data arrives via the same webhooks.
  - Garmin returns 403 unless the user ticked `HISTORICAL_DATA_EXPORT` on the consent screen. It's off by default.

> **Consequence for us:** on Starter a new Garmin user starts with **no history**. The HRV/RHR recovery modifier needs a 14-day baseline. HealthKit seeds that with a 21-day first pull; Garmin users will take about two weeks to build one. The UI should say so.

### Data types we need

Field names come from a maintained open-source Garmin client [9]. Garmin's own spec page didn't load for us, so check them against the portal docs once we have access.

All summaries share `summaryId`, `calendarDate`, `startTimeInSeconds` (UTC epoch seconds), `startTimeOffsetInSeconds` (local offset) and `durationInSeconds`.

| Need | Garmin summary | Fields |
|---|---|---|
| Steps | **Dailies** | `steps` (cumulative; re-sent many times a day as the day goes on), `activeKilocalories` |
| Resting HR | **Dailies** | `restingHeartRateInBeatsPerMinute` |
| Sleep | **Sleeps** | `durationInSeconds`, `deepSleepDurationInSeconds`, `lightSleepDurationInSeconds`, `remSleepInSeconds`, `awakeDurationInSeconds`, `overallSleepScore`, `validation` |
| HRV | **HRV summaries** | `lastNightAvg`, `lastNight5MinHigh` (ms), `hrvValues` |
| Stress | **Dailies** | `averageStressLevel`, `maxStressLevel`, `stressDurationInSeconds`, `restStressDurationInSeconds`, `lowStressDurationInSeconds`, `mediumStressDurationInSeconds`, `highStressDurationInSeconds` |

Stress Details (the 3-minute `timeOffsetStressLevelValues` series), Body Battery, Epochs and Activities are also available. We don't need them for this feature: the daily totals above are enough.

### 1a. Stress

**Only Garmin's API has it.** Apple Health has no stress data type, and Garmin Connect doesn't write stress to Apple Health. A user who only syncs Garmin → Apple Health today gets no stress in HyperTrack, and this integration is the only way to add it.

**What the number is.** Garmin's all-day stress is 0–100, derived from heart rate and HRV while the wearer is still. Garmin's bands: 0–25 rest, 26–50 low, 51–75 medium, 76–100 high. A negative value (reported as -1 / -2 in the open-source clients [9]) means too little data or too much motion; treat it as missing, never as 0.

**How we use it: it pre-fills the check-in's stress rating, and adds no new signal.** Readiness already takes a 1–5 `stress_level` from the daily check-in (`daily_check_ins.stress_level` → `services/fatigueEngine.ts` readiness score and `high_stress` warning, `services/deloadEngine.ts` sleep/stress adjustment). Garmin's stress score:

1. **Pre-fills that rating.** The check-in shows the suggested value with "from Garmin: average stress 42". The user can change it, and what they submit is what's logged, the same way the motion sensor pre-fills the RIR chip without logging a set by itself. A rating the user already picked is never overwritten.
2. **Rates against the user's own normal.** Mapping fixed bands to 1–5 would leave a naturally high-stress-score person stuck on 4. Compare yesterday's `averageStressLevel` with the user's 14-day median (`rollingBaseline`, the same baseline HRV uses) and put it in a 1–5 bucket:

   | vs 14-day median | Rating |
   |---|---|
   | ≤ −10 points | 1 |
   | −10 to −4 | 2 |
   | within ±3 | 3 |
   | +4 to +10 | 4 |
   | > +10, or `highStressDurationInSeconds` ≥ 2 h | 5 |

   Before 14 days of history exist, fall back to Garmin's bands (rest → 1, low → 2, medium → 3 or 4 split at 63, high → 5). The thresholds are a starting point to tune against real data; keep them in one config object.
3. **Doesn't touch the wearable recovery modifier.** Garmin derives stress from HRV, and `services/wearableRecovery` already reacts to HRV. Feeding stress there as well would count the same evidence twice. Stress reaches readiness only through the check-in rating, which the user confirms.

**Which day.** Use the previous full day's `averageStressLevel` for the morning check-in. Today's value keeps changing as Garmin re-sends dailies, which happens many times a day.

**Display.** On the Home Health card, a Garmin user gets a Stress figure (yesterday's average and its band, e.g. "32 · low") in the HRV tile's detail line, with Garmin attribution (see Terms). Apple-Health-only users see nothing new.

> **HRV is not the same metric.** Garmin's HRV is the overnight **RMSSD** average. Apple Health and our `daily_wellness_metrics.hrv_sdnn_ms` column store **SDNN**.
> - The two run at different scales, so they must not share a column or a baseline.
> - See the `hrv_rmssd_ms` change in §2.

### Terms that affect us

Source: the Developer Program Agreement [6]. The copy we could fetch is the China-region Rev. B (Mar 2026), so confirm the global text in the portal.

- **Use (§4.1):** only for our own app's display and features, with the user's consent.
- **Not allowed (§5.2):**
  - Reselling the data, or passing user data to third parties Garmin hasn't approved.
  - Competing with Garmin.
  - Life-critical use.
- **Privacy (§15.4–15.8):**
  - Honour user deletion and export requests.
  - Don't sell personal data.
  - **Never collect Garmin passwords.** OAuth only.
- **AI (§15.10):** if Garmin data goes through or trains AI, the privacy policy needs an "AI Transparency Statement" with explicit, revocable consent.
  - Today, none of our AI features read wellness data. **Keep Garmin data out of LLM prompts** unless we add that statement first.
- **Branding:** every screen that shows Garmin data needs a **"Garmin [device model]"** attribution next to the data title, above the fold, not hidden in a tooltip [11].
  - This includes the Home Health card, the sleep and steps detail views, and any export.
  - Garmin wants **30 days' notice** of new UI that shows its data (§6.6).
  - If we don't comply: a 14-day cure period, then reduced data, then suspension (§6.5).
- **Rate limits:** one blog reports 100 requests/min (unverified) [10]. Push-only use barely calls Garmin, so this shouldn't bind.

---

## 2. Mapping onto our tables

Garmin pushes arrive on the server with no user session. The HealthKit server actions in `lib/actions/healthkit.ts` all start with `supabase.auth.getUser()`, so they can't be called from a webhook as they are. Plan:

1. **Extract the write logic** of `saveHealthKitSleepDays`, `saveHealthKitWellness` and `saveHealthKitDailyActivity` into pure writers that take `(client, userId, days, source)`.
   - Put them in `lib/wearables/daily-writers.ts`.
   - The HealthKit actions keep their signatures and call the writers with the user's client. No behavior change, and their existing tests still apply.
   - The Garmin webhook calls the same writers with the service-role client from `lib/supabase/admin.ts`, passing the `user_id` it looked up from the Garmin user ID.
2. **Map each Garmin summary to a day row:**

| Garmin | Our table | Notes |
|---|---|---|
| Dailies `calendarDate`, `steps`, `activeKilocalories` | `daily_activity_data` (`steps_source='garmin'`, `steps_confidence='measured'`) | `'garmin'` is already allowed by the CHECK constraints. Keep the HealthKit rule that a day with energy but no steps never touches the step columns. |
| Dailies `restingHeartRateInBeatsPerMinute` | `daily_wellness_metrics.resting_hr_bpm` (`source='garmin'`) | Same metric as HealthKit's. |
| HRV `lastNightAvg` | `daily_wellness_metrics.hrv_rmssd_ms` (**new column**), `source='garmin'` | Not `hrv_sdnn_ms` (see §1). The recovery modifier (`services/wearableRecovery`) has to change so it builds a separate baseline for each metric and uses whichever one exists. |
| Sleeps total minus awake, in hours | `sleep_log` (`source='garmin'`, `quality='ok'`) | Reuse `selectWritableSleepDays`, so manual entries still win. Key the row by `calendarDate`, which should be the wake-up day; check this against real payloads. |
| Sleeps `overallSleepScore` | not stored in v1 | A later option is mapping the score to quality: poor <60, ok, good ≥80. |
| Dailies `averageStressLevel`, `maxStressLevel`, `highStressDurationInSeconds` | `daily_wellness_metrics.stress_avg`, `stress_max`, `stress_high_minutes` (**new columns**), `source='garmin'` | Negative values → NULL. Re-sent dailies upsert the same `(user_id, date, source)` row, so the final value wins. Raw 0–100 is stored; the 1–5 rating is computed when the check-in loads (§1a), never stored. |

3. **Migration (additive):**
   - `daily_wellness_metrics`:
     - Widen `source` CHECK to `('healthkit','garmin')`.
     - Add `hrv_rmssd_ms NUMERIC(6,2)`.
     - Add `stress_avg SMALLINT CHECK (stress_avg BETWEEN 0 AND 100)`, `stress_max SMALLINT CHECK (stress_max BETWEEN 0 AND 100)`, `stress_high_minutes SMALLINT CHECK (stress_high_minutes >= 0)`.
   - `sleep_log`: widen `source` CHECK to `('manual','healthkit','garmin')`.
   - New `garmin_user_links (garmin_user_id TEXT PRIMARY KEY, user_id UUID UNIQUE)` so webhooks can look up our user.
     - Alternatively, a `provider_user_id` column on the credentials table below.
   - **Tokens:** see §3.
   - **No sync-anchor table.** Push is day-keyed and idempotent, which replaces the anchors.
4. **When both Apple Health and Garmin are connected.** Many Garmin owners also let Garmin Connect write to Apple Health. Rules:
   - **Steps:** `daily_activity_data` has one row per day, so whichever source writes last wins today. That needs a decision:
     - Recommended: a Garmin write overwrites a `apple_healthkit` step count, but a HealthKit write leaves a `garmin` count alone. The watch is the measured source, and Apple Health only holds Garmin's copy plus phone steps.
     - That also means changing `get_best_step_source`, which currently ranks HealthKit 1st and Garmin 5th.
   - **Sleep:** first writer wins and manual always wins, which `selectWritableSleepDays` already gives. Extend it so `garmin` may overwrite `healthkit` but not the other way round.
   - **Wellness:** rows already sit side by side because the unique key is `(user_id, date, source)`. The recovery read prefers Garmin when both exist.

---

## 3. Server pieces

Everything lives under `app/api/integrations/garmin/`. The client secret and tokens **never reach the browser**.

### Token storage (server-only)

`wearable_connections` has `access_token` / `refresh_token` columns, but they aren't safe to use:

- Its RLS SELECT policy lets a signed-in user read their own row.
- `lib/actions/wearable.ts` selects `*`.
- Tokens stored there would reach the client. The current Fitbit route also returns tokens in its JSON response.

For Garmin:

- New table `wearable_oauth_credentials`:
  - Columns: `user_id`, `source`, `provider_user_id`, `access_token`, `refresh_token`, `access_expires_at`, `refresh_expires_at`, `scopes`, `updated_at`.
  - **RLS enabled with no policies**, so only the service role can read it.
- Encrypt the two token columns at rest. Use AES-GCM with a `WEARABLE_TOKEN_KEY` env var (or pgsodium/Vault if the project has it enabled).
- `wearable_connections` keeps only the user-visible state: `is_connected`, `last_sync_at`, `device_name`.
- **Follow-up, separate PR:** move Fitbit off the old columns the same way.

### Routes

1. **`POST /api/integrations/garmin/start`** (signed in)
   - Generate the PKCE `code_verifier` and `state`.
   - Store `{state, user_id, code_verifier, expires_at = now + 10 min}` in `oauth_pending_states`, a service-role-only table.
   - Return the Garmin authorize URL.
   - **Why a table and not a cookie:** on iOS the consent page opens outside the app's WKWebView (see below), and that browser doesn't share the app's cookies.
2. **`GET /api/integrations/garmin/callback?code&state`**
   - Look up and delete the `state` row. Reject it if missing or expired.
   - Exchange the code with `client_secret` and `code_verifier`.
   - Call `/user/id`.
   - Upsert the credentials, the `garmin_user_links` row, and `wearable_connections (source='garmin', is_connected=true)`.
   - Redirect:
     - In the iOS app, to `hypertrack://integrations/garmin/done` (the existing URL scheme in `ios/App/App/Info.plist`).
     - On web, to `/settings?garmin=connected`.
   - **No tokens in the response.**
3. **`POST /api/integrations/garmin/webhook/[secret]`**
   - The URL is registered in the Garmin portal, one URL for all summary types.
   - Use an unguessable path segment, checked against `GARMIN_WEBHOOK_SECRET`. We found no documented signature header; if the portal offers one, verify it as well.
   - Parse the body (keyed by summary type: `dailies`, `sleeps`, `hrv`, `deregistrations`, `userPermissionsChange`).
   - For each item, find our user by `userId`. **Drop unknown users.** This also means a forged push can only target real linked users, so keep the path secret.
   - Write through the shared writers from §2.
   - Return 200 right away. Payloads are small, so doing the work inline is fine on Vercel. If it gets slow, write the raw payload to a `garmin_webhook_events` table and process it from a cron.
   - **Deregistration:** check the user ID against the current link, then mark `is_connected=false` and delete the credentials row. Keep the imported history unless the user asks for deletion; confirm the retention rule against Garmin's terms.
4. **`POST /api/integrations/garmin/disconnect`** (signed in)
   - Refresh if needed, then call `DELETE /wellness-api/rest/user/registration`. Garmin requires this call [8].
   - Delete the credentials and the link, and set `is_connected=false`.
   - Also hook this into account deletion in `lib/actions/account.ts`.
5. **Token refresh helper** `lib/integrations/garmin/tokens.ts` (server-only)
   - `getValidAccessToken(userId)` refreshes when less than 10 min is left and stores the **new** refresh token.
   - On Starter, only disconnect and the one-time `/user/id` call need tokens, since push needs none. Refresh starts to matter once we add Enterprise pull or backfill.
   - Watch the ~90-day refresh expiry: if a refresh fails, mark the connection as needing reconnection and show a "Reconnect Garmin" prompt.

### iOS app flow (Capacitor)

The app loads `https://www.hypertrack.app` in a WKWebView, and Capacitor hands navigation to any other host to Safari (`capacitor.config.ts`). So:

1. Open the authorize URL with **`@capacitor/browser`**, which is already a dependency. It runs in an in-app Safari sheet.
2. After the callback redirects to `hypertrack://…`, the existing `appUrlOpen` listener (`lib/integrations/capacitor-stub.ts`) catches the URL.
3. Close the sheet, then reload the connections list.
4. On web, a normal redirect is fine.

### UI changes, once the server works

- **`WearableConnectionsScreen.tsx`:**
  - Turn on `availability.garmin` behind a `NEXT_PUBLIC_GARMIN_ENABLED` flag.
  - Replace the `case 'garmin'` no-op with the start-and-open-browser flow.
- **Home Health card (#780):** drop "coming soon" when the flag is on.
- **Garmin attribution:** show "Garmin [device]" on each tile and detail view (see the branding terms in §1).
- **Empty state:** "Data appears after your next watch sync. Recovery insights need about 2 weeks of Garmin data."
- **Check-in stress pre-fill (§1a):** the daily check-in's stress picker pre-selects the suggested rating with a "from Garmin" note. A user's own tap always wins.
- **Health card:** Garmin users see yesterday's stress in the HRV tile's detail line.

### Tests

- Unit-test the mapping functions (Garmin JSON → day rows) against fixture payloads, including negative stress values → NULL.
- Pure `suggestStressRating(history, day)` in `services/`: the baseline buckets, the band fallback under 14 days, the 2-hour high-stress rule, and no suggestion without a reading.
- Check-in: the pre-fill is selected, a user's own pick is never overwritten, and submitting logs what's shown.
- `wearableRecovery` ignores stress columns (guards against double counting HRV).
- Test the writers with both a user client and the admin client.
- Webhook route tests: wrong secret → 404, unknown user dropped, deregistration of an old grant ignored.
- PKCE state expiry and replay.
- Follow the patterns in `lib/integrations/__tests__/`.

### Suggested build order

1. **Migration and shared writers.** Refactor HealthKit onto the writers; no behavior change.
2. **OAuth start, callback, disconnect, and the credentials tables.**
3. **Webhook** for dailies, sleeps, HRV and deregistration. Store stress from dailies in the same step.
4. **UI behind the flag, plus Garmin attribution.**
5. **Stress pre-fill** in the check-in and the Health card stress line (§1a).
6. **Test on the evaluation keys** with the owner's own watch, then request production.

---

## 4. Out of scope for v1

- Activities and workout import. This uses the Activity API, needs separate dedupe against logged workouts, and has more branding rules.
- Body Battery, sleep score, Epochs, the Stress Details 3-minute series.
- Using stress anywhere other than the check-in pre-fill and the Health card (for example as its own recovery modifier). Revisit only with evidence that it adds something HRV doesn't.
- Backfill and ping/pull. Revisit if we move to Enterprise.
- Android-specific handling. The web flow works there.

---

## 5. Open questions to settle once we have portal access

- **Webhook signing:** is there a signature header? If not, the secret URL path is our only authentication.
- **Fields:** exact names and the HRV units. Does `calendarDate` on Sleeps mean the wake-up day? Are the stress fields (and the negative "not enough data" codes) on Dailies as the open-source clients describe?
- **Starter limit:** is it really 1,000 users? What does production verification involve, and how long does it take?
- **Retention after deregistration:** must we delete imported history?
- **AI terms:** is the AI clause relevant if a later feature passes recovery data to an LLM?

---

## 6. Steps that need the account owner

None of these can be done by a code session.

1. **Apply** to the Garmin Connect Developer Program, Business **Starter**, at developer.garmin.com/gc-developer-program [2]. Use the business entity behind HyperTrack.
   - Describe the use: show sleep, steps, HRV, resting HR and stress, and use them to adjust training recovery.
   - Data is not resold or shared.
2. **Accept the Developer Program Agreement** after reading it. Note the branding, AI and fee clauses in §1.
3. **Create the app** in the Developer Portal once approved:
   - Register the redirect URI `https://www.hypertrack.app/api/integrations/garmin/callback`. Add a preview URL if Garmin allows several.
   - Enable the Health API summary types Dailies, Sleeps and HRV, plus the deregistration and user-permission webhooks.
   - Set the push URL to `https://www.hypertrack.app/api/integrations/garmin/webhook/<secret>`.
4. **Add secrets in Vercel** (Production and Preview; server-only, **no** `NEXT_PUBLIC_` prefix):
   - `GARMIN_CLIENT_ID`
   - `GARMIN_CLIENT_SECRET`
   - `GARMIN_WEBHOOK_SECRET` (a long random string, also used in the push URL)
   - `WEARABLE_TOKEN_KEY` (a 32-byte key for encrypting tokens)
   - Confirm `SUPABASE_SERVICE_ROLE_KEY` is set. The webhook needs it.
5. **Update the privacy policy:** say we receive data from Garmin, and how users disconnect and delete it.
6. **Notify Garmin** about the new UI at least 30 days before launch, if Garmin asks for that during review (§6.6).
7. **Request production access / partner verification** after testing with your own watch on evaluation keys.

---

## Sources

1. Garmin Connect Developer Program FAQ (Enterprise): https://developer.garmin.com/gc-developer-program/enterprise/program-faq/
2. Garmin Connect Developer Program overview (tiers): https://developer.garmin.com/gc-developer-program/overview
3. Garmin Health API (Enterprise): https://developer.garmin.com/gc-developer-program/enterprise/health-api/
4. Open Wearables, "Garmin Connect Developer Program reopened" (23 Oct 2026): https://openwearables.io/blog/garmin-connect-developer-program-reopened
5. Press report on Enterprise pricing: https://stack-archive.com/blog/garmin-connect-api-personal-tier-free-access-2026/
6. Garmin Connect Developer Program Agreement (Rev. B, China-region copy): https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf
7. Open Wearables, Garmin provider guide: https://openwearables.io/docs/providers/garmin-api-integration.md
8. Garmin OAuth2 PKCE specification (2025-06-11): https://developerportal.garmin.com/sites/default/files/OAuth2PKCE.pdf
9. Open Wearables source (Garmin lifecycle, backfill, schemas): https://github.com/the-momentum/open-wearables
10. Open Wearables, Garmin API developer guide: https://openwearables.io/blog/garmin-connect-api-developer-guide-activities-health-metrics
11. Garmin Developer API Brand Guidelines: https://developer.garmin.com/downloads/brand/Garmin-Developer-API-Brand-Guidelines.pdf

Garmin's official FAQ and Health API pages returned errors to our fetcher, so details marked "secondary" or "unverified" above came from the other sources. Re-check them against the Developer Portal once access is granted.
