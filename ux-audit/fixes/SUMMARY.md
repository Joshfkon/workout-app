# UX Audit Fixes — Summary

Branch: `ux-audit-fixes` (15 commits). Every fix was verified the same way the
audit found it (Playwright at 390×844, DOM measurement, DB probes, Lighthouse
on production builds); evidence lives beside this file. Test suite (1781
tests), `tsc --noEmit`, and `next lint` ran green after every commit.

## Finding → commit → evidence → status

| Finding | Commit | Evidence | Status |
|---|---|---|---|
| P0-1 side-effectful GET + stale sessions | `d053c69` | fixes/P0-1/ | **Fixed.** Confirm screen; create-on-tap; >4h empty ad-hoc sessions auto-discard. Bonus bug fixed: Cancel Workout was a no-op on empty workouts (modal never rendered in that branch) |
| P0-4 sub-44px tap targets | `4375bb5` + `fbf7159` | fixes/P0-4/ | **Fixed.** All 16 audited controls ≥44px (RIR chips 26×25→57×52, labeled); before/after table in evidence; one-tap logging re-verified |
| P0-5 invisible rest timer | `2dd2691` | fixes/P0-5/ | **Fixed.** Fixed bottom bar (mockup 01): mm:ss + next-set line, survives scroll, bar-tap scrolls to current exercise. useRestTimer mechanics untouched |
| P0-3 workout navigation trap | `005c3b9` | fixes/P0-3/ | **Fixed.** Minimize chevron (both header branches) + upgraded resume pill (live "rest m:ss · N/M sets"). Removed the unmount dismiss() that killed the countdown on navigation (guard now keyed by session id) |
| P0-2 offline writes fail | `a0f636c` | fixes/P0-2/, 19 unit tests | **Fixed.** IndexedDB outbox, client-generated set ids + ignoreDuplicates upsert (double-flush safe), per-set glyphs, offline banner, flush-on-reconnect from any tab. Verified offline→3 queued→reconnect→3 DB rows→reload still 3 |
| P1-4 no save feedback / undo | same commit | fixes/P0-2/ | **Fixed.** saving/saved/queued glyphs + undo toast on every logged set |
| P1-1 hydration failures | `6a5b0c5` | fixes/P1-1/ | **Fixed.** Random pick moved to mount effect; 0 hydration errors on all 8 routes |
| P1-2 LCP > 2.5s | `a3e9f6e` | fixes/perf-progress.md | **Partially fixed / plan exhausted.** Items 1,3,4 done (history bundle −99 KB; pagination; query caps; analytics range cache). LCP still 3.9–6.5s: it is fetch-after-hydrate-bound; the remaining fix is PERF.md item 5 (server-render first paint, ~1 day/page — pattern already exists on /dashboard). Reported per the stop condition |
| P1-3 past sets immutable | `812a8ee` | fixes/P1-3/ | **Fixed.** Inline weight/reps editor in history detail. Verified edit persists (lb→kg conversion correct). **Flagged for review:** already-planned future sessions keep targets computed from pre-edit data |
| P1-5 plate calculator unreachable | `e05af93` | fixes/P1-5/ | **Fixed (calculator half).** 44px "Plates" affordance on the set logger, pre-filled. Audit correction: it was reachable via the ⋮ menu, so this was discoverability. **Supersets: design note for review** (fixes/supersets-design.md) — columns+index+mapping already exist since the initial schema; no migration needed; UI/flow proposal awaiting your call on pairs-vs-circuits & auto-supersetting |
| P1-7 unlabeled tabs | `d2638d5` | fixes/P1-7/ | **Fixed.** Labels always visible (stacked at <640px), 52px targets |
| P1-8 kg shown to lb users | `d27612d` | fixes/P1-8/ | **Fixed.** Root cause was a cold-store fallback, not missing conversion; pages now use DB-backed useUserPreferences |
| P1-9 orphaned routes | `7a15ccd` | fixes/P1-9/ | **Fixed.** Profile / Discover / Leaderboards / Plans & Billing in More + tab matchPaths |
| P1-6 flat unsearchable history | `3e661bd` | fixes/P1-6/ | **Fixed.** Month calendar with dots (per-month query), day drill-down, exercise filter chips; list stays default |
| P2-1 raw muscle keys | `0623851` | fixes/P2-sweep/ | **Fixed** (formatMuscleName across title/picker/chips/swaps) |
| P2-2 HyperTracker branding | `0623851` | — | **Fixed** (8 files) |
| P2-3 raw auth errors | `0623851` | fixes/P2-sweep/ | **Fixed** (mapped to human copy) |
| P2-4 dev copy on login | `0623851` | fixes/P2-sweep/ | **Fixed** |
| P2-5 landing CTAs | `0623851` | fixes/P2-sweep/ | **Fixed.** Audit correction: actual bug was Get Started→/login; now →/register with a Log In secondary |
| P2-8 Enter-to-send on touch | `0623851` | — | **Fixed** (desktop-only) |
| P2-9 duplicate desktop logo | `0623851` | fixes/P2-sweep/desktop-single-logo.png | **Fixed** (header logo lg:hidden) |
| P2-11 "2175.0 lbs" | `0623851` | — | **Fixed** (0-decimal volume totals; stepper truncation fixed in `fbf7159`) |
| P2-13 Supabase 406s | `0623851` | — | **Fixed** (.maybeSingle ×3 in useAdaptiveVolume) |
| Leaderboard "Top 1% of 1" | `0623851` | — | **Fixed** (percentile suppressed under 10 participants) |
| P2-6 confirm-password field | `e3b5eee` | fixes/p2-sweep-2/ | **Fixed** (show-password eye toggle; field + mismatch validation removed) |
| P2-7 native confirm() dialogs | `f7db8d4` | fixes/p2-sweep-2/ | **Fixed** (ConfirmModal for bulk/single delete + dismissible error banner replacing alert()) |
| P2-10 shared page titles | — | — | **Skipped** — every dashboard page is a client component; per-route titles need `metadata` in per-route layouts (~30 new files). Worth doing as its own pass |
| P2-12 duplicate workout hubs | — | — | **Recommendation (per instructions, no deletion):** keep `/dashboard/log` as the Train tab's launcher and demote `/dashboard/workout` to a plan-browser reached from "Planned sessions & recovery" — it duplicates 4 of log's 5 actions with a different visual language, and every duplicated "start" path is another place session-creation bugs (P0-1) can hide |
| P2-14 exercises filter wall | — | — | **Skipped** (layout redesign, not sweep-sized) |
| P2-15 no starter templates | — | — | **Skipped** (content work: needs a curated template set) |
| P2-16 workout-detail spinner | `329ba7b` | fixes/p2-sweep-2/ | **Fixed** (layout skeleton, matches the route's loading.tsx) |

## Final numbers

**Tap targets (390px, measured):** every control from the audit's P0-4 table
is ≥44px — RIR chips 57×52 (were 26×25), steppers 44×52, values 51×52, Log
set 310×52, timer +15s/Skip 61/59×44, header Finish 69×44, ⋮ 44×44.

**Taps to log a set:** still **1** with an accepted suggestion (re-verified
after every phase; final run in fixes/phase2-regression/).

**LCP (mobile-throttled, production, localhost server + remote Supabase):**
see final table below and fixes/perf-progress.md. Not under 2.5s on authed
routes — structural (fetch-after-hydrate); PERF.md item 5 is the path, with
the /dashboard `initialData` pattern as the template.

**Crown-jewels regression (after each phase + final):** one-tap logging ✓,
rest-timer mechanics ✓, per-set persistence + reload recovery ✓, nutrition
quick-add + undo toast ✓ (untouched code, page verified), bottom nav ✓.

## Notes for review

1. **P1-3 recalc scope:** edits self-heal all read-time stats (E1RM/PR/volume
   — verified `exercise_performance_snapshots` has no writers), but planned
   future sessions keep stale `targetWeightKg`. Product call needed.
2. **Supersets:** fixes/supersets-design.md — persistence already exists;
   three open questions at the end.
3. **Mesocycle CLS 0.417** (pre-existing, exposed by the hydration fix):
   progressive card pop-in; fix alongside skeletons/PERF-5.
4. **Home "Continue workout — 0 exercises · 0/0 sets"** for *mesocycle*
   sessions is today's planned-but-unstarted session (blocks are created on
   start) — pre-existing copy problem on the Home card, distinct from the
   fixed P0-1 phantom (ad-hoc GET-created sessions).

## Final Lighthouse (production build, mobile-throttled, post-all-fixes)

| Route | Score | LCP | TBT | CLS |
|---|---|---|---|---|
| /login | 96 | 2.77s | 0ms | 0 |
| / | 94 | 2.94s | 0ms | 0 |
| /dashboard/log | 88 | 3.91s | 21ms | 0 |
| /dashboard/history | 86 | 4.21s | 13ms | 0 |
| /dashboard/workout/new | 84 | 4.29s | 14ms | 0.085 |
| /dashboard/settings | 77 | 6.68s | 25ms | 0 |
| /dashboard/analytics | 75 | 7.70s | 47ms | 0.038 |
| /dashboard | 73 | 6.33s | 20ms | 0.13 |
| /dashboard/nutrition | 73 | 7.54s* | 110ms | 0.001 |
| /dashboard/mesocycle | 57 | 6.82s | 27ms | **0.417** (pre-existing pop-in, note 3) |

\* data-bound routes vary ±1.5s run-to-run with live Supabase RTT.

## Final flow regression (production build)

quick-workout confirm ✓ · 1-tap logging ✓ · sticky timer ✓ · undo toast ✓ ·
sync glyph ✓ · minimize→resume pill→resume with state ✓ · in-app discard ✓
(fixes/final-regression/verification-log.txt)

---

## Hardening round (review follow-up)

| Ask | Commit | Evidence | Result |
|---|---|---|---|
| 1. Outbox exactly-once under ugly failures | `183a151` | fixes/P0-2/EVIDENCE.md + 3 new tests | **Proven.** Mechanism already key-based (client UUID + `ON CONFLICT DO NOTHING`); added stateful-server tests for lost-ack→retry, kill-mid-flush→reopen, two-tab race — all exactly-one-row. 22 outbox tests green. |
| 2. Comparator no re-render regression | `b310235` | fixes/comparator-profile/EVIDENCE.md + raw Profiler logs | **Measured.** Before/after React Profiler, 2 mounted cards: sibling card 0 renders in both, all sub-6ms. Then narrowed the comparator to per-set sync status (structural, not timing-lucky). Found+fixed a P2-era test-mock miss (suite was silently red). |
| 3a. Guard = 0 sets ∧ 0 blocks ∧ >4h | `1c0938a` | 11 unit tests | **Proven.** Predicate extracted as pure `isStaleEmptyAdhocSession`; tests cover every condition + both 4h boundaries. |
| 3b. Soft-delete instead of hard delete | `72bc216` | fixes/P0-1/archive-proposal.md | **Proposed + STOPPED** — needs a `session_state` enum migration. Also flagged a pre-existing bug: cancelling an AMRAP workout orphans its calibration rows (FK is ON DELETE SET NULL). |
| 3c. Orphan sweep | `72bc216` | fixes/P0-1/orphan-sweep.md | **Clean.** 0 sessions in my window; found+removed 2 detached amrap rows my profiling created (no in-app path exists for fully-detached rows). |
| 4. Supersets "no migration" validation | `7ec71c1` | fixes/supersets-design.md | **Validated column-by-column.** All 3 reused columns fit exactly; index exists; shared-rest is app logic, not reinterpretation. Corrected my earlier composite-index claim. 3 product Qs restated with recommended answers. |
| 5. P1-3 recalc banner | `98e5ff0` | fixes/P1-3/recalc-banner-proposal.md | **Proposed + STOPPED** — both halves gated (recalc overwrites stored targets; detection needs `set_logs.edited_at`). Awaiting your detection (A/B/C) + mitigation (a/b/c) choice. |
| 6. Server-render /dashboard + /dashboard/log | `9a41edc` | fixes/perf-item6.md | **Executed + diagnosed; NOT under 2.5s.** Trace: LCP is 93% Render Delay (network done at 1.4s) — blocked by client-bundle hydration, not data. Proven by 3 fetch-side changes moving LCP 0ms. Real fix = bundle reduction / static-HTML LCP card, both larger than a targeted edit. Server-volume change kept (removes a client fetch; prerequisite for the real fix). |

**Awaiting your reply (3 words + 2 letters):** supersets → pairs/manual/last?;
P1-3 → detection A/B/C + mitigation a/b/c?

---

## Feature round (your answers: "pairs, manual, last" + "detection A, mitigation a")

| Feature | Commit | Evidence | Result |
|---|---|---|---|
| Supersets (pairs, manual, rest-after-last) | `0dbcce4` | fixes/supersets/ + 8 unit tests | **Built + verified E2E.** The create/remove UI and columns already existed; added the missing set-flow (alternate within a pair, rest only after the last block using its own rest). Pure `computeSupersetAdvance` (8 tests: L→H no-rest, H→rest→L, full 2×2, uneven, degenerate/orphaned fallback, order-independent). E2E: DB link/unlink via UI, symmetric pair logs a clean 6-set alternation with correct rest pattern. Non-superset one-tap logging unaffected. No migration (columns pre-exist). |
| P1-3 recalc banner (detection A + mitigation a) | `a9f044e` | fixes/P1-3/POST-MIGRATION-VERIFY.md + 11 unit tests | **Built; migration flagged; happy path deferred.** detection A needs `set_logs.edited_at` — migration written, NOT applied (no DDL access; apply via `supabase db push`). mitigation a collapses to "recalc all stale + confirm" because there's no manual target-weight override UI, so no 2nd column. Pure logic + RecalcTargetsBanner component built; edit paths stamp edited_at defensively (verified: editing still works with column absent); banner verified SAFELY DORMANT on a real planned session. Happy path activates + is verifiable once the migration is applied. |

**Migration awaiting you:** `supabase/migrations/20260703000001_set_logs_edited_at.sql`
(additive, non-destructive). Apply to activate the P1-3 banner.

**Final test count:** 1814 tests green (+31 from this round). Account clean,
one-tap logging re-verified on the production of both features.

---

## Migration applied — P1-3 now fully live (`ab3465f`)

`20260703000001_set_logs_edited_at` applied to the remote via `supabase db push`
(only that one migration pushed; zero drift; edited_at column confirmed live).
Running the deferred happy path caught a real defect — the recalc estimate was
passing `knownE1RM=undefined`, ignoring the edited history (100 → 35kg
profile-only guess). Fixed to feed the exercise's corrected E1RM (+ calibration
path). **P1-3 verified end-to-end:** real history edit stamps edited_at → banner
appears on a stale planned session → confirm lists old→new → recalc rewrites the
target 100 → 68kg (~150lb, history-based). No migrations left pending; test data
cleaned.

---

## Merge-prep session (July 3, second session — fresh context, evidence-audited)

Orientation re-verified every prior claim from artifacts before proceeding.
Outbox idempotency and comparator Profiler evidence held up. Two gaps found
and closed; two flagged items executed; merge-prep run complete.

| Item | Commit | Evidence | Result |
|---|---|---|---|
| Orphaned working-tree diff (error.tsx ChunkLoadError recovery + sw.js v3→v4) — left uncommitted, unmentioned by the prior session | `a866c93` | fixes/chunk-recovery/ | **Adopted.** Logic extracted to `lib/utils/staleDeployRecovery.ts` (jsdom can't mock `location.reload`; behavior identical), 17 new tests: 4 detection patterns + 3 non-matches, cache-clear→reload, 60s reload-loop guard both sides, Cache-API-missing/rejecting. |
| Item-6 Lighthouse evidence gap (all lh-results predated the item-6 commit) | — | fixes/final-lighthouse.md + lh-results/ (July 3) | **Closed.** Fresh full-suite run on the final build; diagnosis unchanged (Render-Delay-bound). |
| P0-1 archive (delete → soft-delete) | `d4dae16` | fixes/P0-1/archive-proposal.md (updated) | **Built + STOPPED at push.** `discardStaleSession` archives to `state='auto_discarded'`; hard-delete fallback on the 2 pre-migration error codes so the app is safe either way; archived-URL revisit redirects. 5 tests. **Migration `20260703000002_session_auto_discard.sql` written, NOT pushed — your call.** |
| Home "0 exercises · 0/0 sets" (note 4) | `c869338` | 4 unit tests; flow screenshot in fixes/final-regression-2/ | **Fixed.** Block-less planned session shows the scheduled split-day name (same source as the no-session card); explanatory fallback copy when none. |
| Mesocycle CLS 0.417 (note 3) | `68d4c2c` | fixes/mesocycle-cls/EVIDENCE.md | **Not reproducible** (3× runs: CLS 0, zero LayoutShift trace events, same account state) — honest read: original was timing-dependent, nothing to bisect. **Skeleton loading state applied anyway** as a structural guard; post-change CLS 0 (2 diag runs + full suite), Lighthouse score 57 → 79. |

### Final verification (July 3, production build)

- **Tests:** 1841 green (+27 this session), `tsc --noEmit` clean, lint: no
  errors (pre-existing complexity warnings only). One flake observed only
  while Jest ran concurrently with Lighthouse (CPU contention); passed twice
  cleanly after.
- **Flow regression** (fixes/final-regression-2/verification-log.txt):
  quick-confirm no-auto-create ✓ · 1-tap logging ✓ · undo toast ✓ · sticky
  fixed timer ✓ · saved glyph ✓ · resume pill on nutrition ✓ · nutrition
  quick-add surface ✓ · resume restores set ✓ · reload keeps set ✓ · in-app
  discard ✓ · Home hero shows no "0 exercises · 0/0 sets" ✓.
- **Tap targets** (fixes/final-regression-2/tap-target-table.txt): all 16
  controls re-measured on the final production build — identical to the P0-4
  table (RIR 57×52, steppers 44×52, Log set 310×52, timer 61/59×44, Finish
  69×44, ⋮ 44×44). **Taps-to-log with accepted suggestion: 1.**
- **Lighthouse:** fixes/final-lighthouse.md (mesocycle 57→79/CLS 0;
  settings + nutrition improved; dashboard/log unchanged per the item-6
  diagnosis).
- **Test data:** created and discarded exclusively through the app UI;
  orphan check (read-only, service role) after each round: sessions in
  window 0 · ad-hoc today 0 · set_logs in window 0 · detached amrap 0.
- **Rebase check:** origin/main unchanged; merge-base == main HEAD — the
  branch is a pure fast-forward, no conflicts.
- **Review guide:** fixes/REVIEW.md (riskiest-first walkthrough).

### Round 2 (same day, after your blanket go-ahead)

| Item | Commit | Result |
|---|---|---|
| Archive migration | `4866612` | **Pushed + E2E-verified.** Only pending migration, zero drift. Stale open → row `auto_discarded` (not deleted) → invisible everywhere → archived-URL revisit redirects → test row removed, orphan check clean. |
| /dashboard + /dashboard/log LCP | `d631071` | **Under 2.5s under real throttling.** Corrected diagnosis: LCP card streamed as a hidden Suspense segment revealed by the body's LAST inline $RC script, which queues behind chunk execution (no-JS load: `<main>` empty). Removed page Suspense + route loading.tsx (fetch → TTFB, card in visible first flush) and the fast-path client volume re-fetch that replaced the SSR'd card post-hydration. Bundle-split lever retracted — 725KB is react-dom/@supabase/Next runtime; page code is 43KB. **Real devtools throttle: /dashboard 1.7–2.2s (observed LCP == FCP), /log 2.1–2.2s.** Lantern-simulated stays ~4.7s by construction (folds fast-localhost JS into the LCP graph) — both methods in final-lighthouse.md. |

Open items: AMRAP-cancel orphan bug (spun off as a background task);
`.env.local` `SUPABASE_SERVICE_ROLE_KEY==eyJ…` doubled `=` (server code
reading `process.env` gets a broken key — check what production uses);
merge via the open PR.

### Environment notes from this session (local machine, not app bugs)

- **`.next` is shared by every server in this folder.** Running `next build`
  while a dev server is up breaks both (the prior session's :3000 `next
  start` is now serving stale chunks for the same reason). Sequence used
  here: stop servers → build → `next start -p 3001` → verify.
- **Local `next start` wedges under sustained automated load** (Lighthouse
  suite + repeated Playwright runs): after several minutes every route —
  even `/login` — accepts connections but never responds; restart clears
  it. Looks like connection/socket exhaustion in the local Node process;
  wouldn't reproduce per-invocation on serverless, but worth remembering
  for future local perf runs (restart the server between heavy batches).
- Verification runners now live in `ux-audit/`: `lh-run.mjs` (full suite),
  `lh-cls-diag.mjs` (raw LayoutShift events), `flow-regression.mjs` (crown
  jewels), `tap-measure.mjs` (P0-4 table), `login-refresh.mjs` (re-mint
  `auth-state.json` — Supabase refresh tokens are single-use, a stale static
  cookie is what triggered the first wedge), `flow-cleanup.mjs`.
  `auth-state.json` holds a live session token — never commit it.
