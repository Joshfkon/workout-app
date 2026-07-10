# Verification

## Unit tests (the acceptance tests)

- `services/__tests__/setRecommenderSeed.test.ts` — reproduces the exact failure
  case (ISO-Lateral Low Row, history `90×13@4, 140×14@2.5, 160×8@2.5, 160×11@1`,
  stored e1RM 252.5, target 8–12 @ 2 RIR):
  - **Working slot** → 175 lbs, rep **range** 8–12, `@ 2 RIR`, anchored on the
    e1RM (`anchorSource: 'e1rm'`), `clamped: true` (bounded to +10% of the recent
    160-lb working weight). In the required 170–190 band.
  - **Inferred ramp slot** (set 1's real role) → ~100 lbs (57–58% of the 175
    working prescription), **no RIR claim** (`showRir: false`).
  - `92.5 × 13 @ 2 RIR` is asserted impossible for either role.
  - **Override (Phase 4):** logging 180×9 @ 1 RIR (a >20% deviation from the ~92.5
    suggestion) re-anchors the next set to ≥170 lbs; `deviatesFromSuggestion`
    flags it; `recalibrateSessionE1RM` credits the logged set with fresh-set
    weighting.
- `services/suggestionEngine/__tests__/setRoles.test.ts` — role inference: the
  90-lb feeder (56% of the 160 top) → `ramp`; the 140/160 sets → `working`;
  user tag beats inference; `RAMP_ROLE_MAX_FRACTION` boundary.
- `services/__tests__/progressionEngine.test.ts` — `detectJunkVolume` now excludes
  `ramp` sets.
- Full suite: **2391 passed / 88 suites**, `tsc --noEmit` clean (0 errors).

## Playwright (banner + provenance)

The full authenticated Next.js app (Supabase auth + a seeded ISO-Lateral history)
can't be driven in this sandbox, so the banner/provenance surface was rendered
**from the real engine output** and driven with Playwright/Chromium:

1. `verify/emitEngineOutput.test.ts` runs the real `recommendSeedForSlot` for the
   failure case and writes `verify/engine-output.json` (working = 175, ramp = 100).
2. `verify/screenshot.mjs` renders the `SuggestionBanner` surface — its real class
   names, string format, and the exact `buildSuggestionInfo` copy — populated
   strictly from that JSON, screenshots the banner + provenance sheet, and
   asserts the on-screen line equals the engine output and never contains
   `92.5` or `× 13 @`.

Artifacts:
- `banner-working.png` — `175 lbs × 8–12 @ 2 RIR — working weight from your
  ~252.5 lbs est. 1RM (held near recent working weight)`, provenance shows the
  e1RM anchor, the ±10% clamp, and the target.
- `banner-ramp.png` — `100 lbs × 8–12  RAMP  — ramp set — light feeder…`, no RIR
  claim, provenance notes it's excluded from junk volume.
- `verify/playwright-assertions.json` — the assertion results.

Both confirm the displayed numbers come from the engine, and the old
`92.5 × 13 @ 2 RIR — clearly too light` output is unreproducible.

## To re-run

```bash
npx jest --testPathIgnorePatterns '/node_modules/' fix-suggestion-engine/verify/emitEngineOutput.test.ts
node fix-suggestion-engine/verify/screenshot.mjs
```
