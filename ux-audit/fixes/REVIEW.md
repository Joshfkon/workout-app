# ux-audit-fixes — review guide

35 commits. Branch is a **fast-forward from main** (merge-base == main HEAD,
origin/main unchanged, zero conflicts). Every functional commit has evidence
under `ux-audit/fixes/<id>/`, verified the way the audit measured (Playwright
DOM at 390×844, Lighthouse mobile-throttled production builds, DB probes,
unit tests).

Review order below is **riskiest first**, not chronological. Doc-only commits
(`docs:` prefixed — d9778f8, 98e5ff0, 7ec71c1, 72bc216, 58e8670) carry no code
and can be skimmed last.

---

## Tier 1 — data integrity / can corrupt going forward

### 1. `a0f636c` + `183a151` — offline outbox for set writes
The one change that touches every set write. Mechanism: set UUIDs are minted
client-side **before** the first network attempt; the same id rides the
direct insert, the IndexedDB outbox entry, and every retry; applies use
`upsert(..., { onConflict: 'id', ignoreDuplicates: true })` — at-least-once
delivery composed with idempotent apply = exactly-once effect. Queue-entry
deletion is garbage collection, never the dedupe source of truth.
**Read:** `lib/offline/setOutbox.ts`, then `fixes/P0-2/EVIDENCE.md`.
**Tests:** 22 in `lib/offline/__tests__/setOutbox.test.ts`, incl. stateful
fake-server cases: lost ack → retry (1 row), app killed mid-flush → reopen
(no dup), two tabs racing `Promise.all` flushes (1 row per entry).
**E2E:** offline → 3 queued → reconnect → 3 DB rows → reload → still 3.

### 2. `812a8ee` + `a9f044e` + `ab3465f` — P1-3: edit past sets + recalc banner
History edits rewrite `set_logs` — the input to E1RM/PR/volume. Edits
self-heal read-time stats; already-planned sessions kept stale targets, hence
the recalc banner (detection A: `edited_at` stamps; mitigation a: recalc-all +
confirm). `ab3465f` fixed a real defect found during verification: recalc was
estimating with `knownE1RM=undefined` (profile-only guess) instead of the
corrected history E1RM. Migration `20260703000001_set_logs_edited_at` is
**applied to the remote** (only one pushed from this branch).
**Read:** the edit path in history detail, `staleTargets.ts`,
`RecalcTargetsBanner`. **Evidence:** `fixes/P1-3/` incl.
POST-MIGRATION-VERIFY.md (100kg typo → banner → recalc → 68kg).

### 3. `d4dae16` + `4866612` — P0-1 archive instead of delete (migration APPLIED)
Auto-discard of stale empty ad-hoc sessions now soft-deletes to
`state='auto_discarded'` so support can recover; falls back to the old hard
DELETE **only** on the two pre-migration error codes (22P02 enum missing /
42703 column missing). All session lists use positive state allowlists →
archived rows invisible everywhere. Revisiting an archived session's URL
redirects like a deleted one.
**Tests:** 5 new in `adhocSession.test.ts`. **Migration
`20260703000002_session_auto_discard` was pushed July 3 (only pending one,
zero drift) and the archive path E2E-verified** — stale open → row archived
not deleted → invisible everywhere → revisit redirects
(`fixes/P0-1/archive-proposal.md` top section, `ux-audit/archive-e2e.mjs`).

## Tier 2 — core-flow behavior

### 4. `0dbcce4` — supersets set-flow (pairs, manual, rest-after-last)
Persistence columns pre-existed; this adds the set-advance logic. Pure
`computeSupersetAdvance` (8 tests: alternation, uneven pairs, degenerate/
orphaned fallback, order-independence) + rest gating (rest only after the
last block of the pair, using that block's rest). Non-superset flow proven
untouched (one-tap regression re-run). **Evidence:** `fixes/supersets/`
(E2E: clean 6-set alternation with correct rest pattern).

### 5. `b310235` — ExerciseCard comparator narrowed to per-set sync status
The memo comparator silently swallows new props (known gotcha) — this commit
both proves no re-render regression (React Profiler, production profiling
build: sibling card 0 renders across type/log/idle/scroll, before AND after)
and replaces the shared-object reference check with a per-card
`sets.every(s => prev.setSyncStatus?.[s.id] === next.setSyncStatus?.[s.id])`
— structural, not timing-lucky. Also fixed the test-suite mock miss that had
silently broken ExerciseCard tests. **Evidence:** `fixes/comparator-profile/`
with raw Profiler JSON.

### 6. `d053c69` + `1c0938a` — P0-1: no session creation on GET + stale guard
`workout/quick` renders a confirm screen; creation happens on tap. The
auto-discard predicate is pure `isStaleEmptyAdhocSession` (12 tests, both 4h
boundaries). Also fixed: Cancel Workout was a no-op on empty workouts.

### 7. `005c3b9` + `2dd2691` — navigation minimize + sticky rest timer
Workout page gets a minimize chevron + resume pill (live rest countdown /
set progress) on all tabs; rest timer is a fixed bottom bar. The risky bit
was removing the unmount `dismiss()` that killed the countdown on navigation
— the guard is now keyed by session id. `useRestTimer` mechanics untouched.

## Tier 3 — UI/ergonomics (verified by DOM measurement)

- `4375bb5` + `fbf7159` — P0-4 tap targets: all 16 audited controls ≥44px
  (table in `fixes/P0-4/`); one-tap logging still 1 tap.
- `a3e9f6e` — perf items 3+4: code-split (history −99KB), pagination, query
  caps, analytics range cache.
- `6a5b0c5` — LoadingAnimation deterministic first render (hydration fix).
- `812ae`-adjacent UI: `e05af93` plate calc affordance, `d2638d5` tab labels,
  `d27612d` unit fix (DB-backed prefs, not cold store), `7a15ccd` More-page
  nav, `3e661bd` history calendar + filter chips.
- `0623851` — P2 sweep (copy/formatting/polish across 9 findings).

## Tier 4 — this session's additions (smaller)

- `a866c93` — PWA stale-deploy chunk recovery (adopted orphaned working-tree
  diff; provenance + 17 tests documented in `fixes/chunk-recovery/`).
- `c869338` — Home hero: block-less planned session shows its scheduled day
  instead of "0 exercises · 0/0 sets" (4 tests).
- `68d4c2c` — Mesocycle skeleton loading state; original CLS 0.417 no longer
  reproducible (3× Lighthouse: CLS 0, zero LayoutShift events — see
  `fixes/mesocycle-cls/EVIDENCE.md`).
- `9a41edc` — perf item 6: dashboard weekly-volume server-rendered into
  initialData; original LCP diagnosis (superseded — see the corrected
  section below and `d631071`).
- `d631071` — dashboard LCP fix (Suspense/loading.tsx removal + redundant
  volume re-fetch removal). **Review note:** removing the route-level
  loading.tsx also means child routes without their own loading.tsx
  (history, mesocycle, settings, log) keep the previous screen during
  client-side navigation instead of showing a skeleton — App Router default,
  deliberate trade documented in the page comment.

## Perf item 6 / PERF item 5 — RESOLVED (`d631071`); diagnosis corrected

The original item-6 conclusion ("bundle-hydration-bound, needs a
bundle-split") was **wrong in the mechanism and the remedy** — the addendum
in `fixes/perf-item6.md` documents the correction:

- The LCP card streamed as a **hidden Suspense segment** revealed by the
  body's last inline `$RC` script, which queues behind async-chunk execution
  under CPU throttle (a no-JS load showed `<main>` empty).
- Fix: removed the page's Suspense boundary + route `loading.tsx`; the
  ~450ms data fetch moved into TTFB and the card ships as visible
  first-flush HTML. Also removed the fast-path client re-fetch of weekly
  volume that replaced the SSR'd card after hydration.
- Bundle-split had **no headroom anyway**: the 725KB is react-dom 169 +
  @supabase-js 222 + Next runtime 122 + shared UI; page code is 43KB and
  modals were already dynamic.
- **Measured (real devtools throttle, remote Supabase): /dashboard
  1.7–2.2s (observed LCP == FCP), /dashboard/log 2.1–2.2s — both under the
  2.5s target.** Lantern-simulated numbers stay ~4.7s by construction (it
  folds all fast-localhost JS into the LCP graph); both methods are in
  `fixes/final-lighthouse.md`, raw lhr in
  `lh-results/dashboard-devtools.json` / `log-devtools.json`.

## Open items for you

1. Pre-existing flagged bug (spun off as a background task): cancelling an
   AMRAP workout orphans `amrap_calibrations` rows (FK ON DELETE SET NULL) —
   `fixes/P0-1/archive-proposal.md` bottom section.
2. `.env.local` has `SUPABASE_SERVICE_ROLE_KEY==eyJ…` (doubled `=`) — code
   reading it via `process.env` gets a broken key; check what production
   uses.
3. Merge: branch is fast-forward; PR is open with this document as the body.

## Final verification numbers

See `fixes/final-lighthouse.md` (LCP/CLS table), `fixes/SUMMARY.md` (tap-target
table §Final numbers, taps-to-log = 1), and the final-run section appended to
SUMMARY.md by this session.
