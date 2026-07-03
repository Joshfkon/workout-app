# Stale-deployment chunk recovery (error.tsx) + SW cache bump

## Provenance

Found as **uncommitted working-tree changes** at session handoff (July 3),
unmentioned in SUMMARY.md — almost certainly the prior session's response to
ChunkLoadErrors hit during its many rebuild cycles. This session took
ownership: reviewed, refactored for testability, unit-tested, committed.

## What it does

`app/error.tsx` (the global error boundary) now recognizes
stale-deployment errors — the running page belongs to an older deploy and
requests a JS chunk the server no longer has:

- `ChunkLoadError` (webpack), `Loading chunk … failed`,
  `Importing a module script failed` (Safari),
  `Failed to fetch dynamically imported module` (dynamic import).

On match it clears all CacheStorage caches (stale SW-cached shell is the
usual culprit for *persistent* chunk errors in an installed PWA) and
reloads, showing "Updating to the latest version…" instead of the error UI.
A `sessionStorage` stamp limits auto-reload to **once per 60 s**, so a
genuinely broken deploy falls through to the normal error screen rather
than reload-looping.

`public/sw.js`: `CACHE_NAME` `hypertrack-v3` → `v4`, per the file's own
release convention — this branch reworked the app shell (set logger, rest
timer bar, navigation, More page), so old cached shells should be
invalidated on deploy.

## Verification

Refactored the recovery routine out of the component into
`lib/utils/staleDeployRecovery.ts` with an injectable `reload` (jsdom's
`window.location` is a non-configurable accessor — verified by probe — so
`location.reload` cannot be mocked; behavior unchanged, logic identical
line-for-line).

- `lib/utils/__tests__/staleDeployRecovery.test.ts` (13 tests): all four
  detection patterns + three non-matches; clears every cache then reloads;
  cooldown blocks a second reload <60 s and allows it >60 s; reloads even
  when the Cache API is missing or cache clearing rejects.
- `app/__tests__/error.test.tsx` (4 tests): generic error → normal UI, no
  recovery call; stale error + recovery started → recovery screen; stale
  error + rate-limited → normal error UI; Try-again calls `reset`.

17/17 green; full suite re-run in the branch's final verification pass.

Not browser-verified: reproducing a real ChunkLoadError requires two
deployments with mismatched chunk hashes; the unit tests cover the decision
logic and the boundary wiring directly.
