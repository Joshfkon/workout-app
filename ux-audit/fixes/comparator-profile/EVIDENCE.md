# ExerciseCard comparator — no re-render regression (measured)

## Method

React `<Profiler>` wrapped around every `ExerciseCard` in the workout page,
production **profiling** build (`next build --profile` + `next start`),
mobile viewport. Scenario: quick workout, 6 exercises added, one set logged on
exercise 1 and exercise 2 made current — so **two** ExerciseCards are mounted
(`card-0` = completed sibling, `card-5` = active). Then, with the Profiler
recording `onRender` per card: type into the active weight value, log a set,
sit idle 6s (covers the 5s sync-reconcile poll), scroll. Render counts and
total render-ms captured per interaction, per card.

Why two cards and not six: the page mounts a full `ExerciseCard` only for the
**current** exercise and any exercise **with logged sets**
(`isBlockInMainList = index === currentBlockIndex || getSetsForBlock().length > 0`,
page.tsx:3641). Upcoming exercises render as lightweight "Up next" rows, not
cards. So a fresh 6-exercise workout mounts exactly one card; two is the
minimum that makes sibling re-render observable, which is what the concern is
about.

## Results — sibling card (`card-0`) never re-renders

| Interaction | Old comparator (before) | New comparator (after) |
|---|---|---|
| type 3–5 chars | active 6 renders / 2.5ms · **sibling 0** | active 8 / 2.2ms · **sibling 0** |
| log a set | active 10 / 2.1ms · **sibling 0** | active 9 / 3.0ms · **sibling 0** |
| idle 6s (poll) | active 13 / ~0ms · **sibling 0** | active 13 / ~0ms · **sibling 0** |
| scroll | active 2 / 0.1ms · **sibling 0** | active 3 / 0.2ms · **sibling 0** |

("active" = card-5, the current exercise; "sibling" = card-0, the mounted
completed exercise. Raw event logs: `before-old-comparator.*.json`,
`after-new-comparator.*.json`, `after-narrowed-comparator.*.json`.)

**Read:** the completed sibling card re-rendered **zero** times in every
interaction, under both the old and new comparators. Active-card counts differ
only by input-keystroke and rest-timer-tick noise (all sub-6ms); those renders
are driven by the active card's own internal state, not by the comparator. So
adding `setSyncStatus` to the comparator introduced **no** sibling-render
regression.

## The latent issue the measurement did NOT rely on, and the proper fix

`setSyncStatus={setSync}` passes one object shared by every card. A naive
reference check (`prev.setSyncStatus === next.setSyncStatus`) would re-render
*all* mounted cards whenever *any* set's status flipped — the measurement
happened to show 0 because of update timing, but that's luck, not a guarantee.
Rather than rely on it, the comparator was narrowed to compare only **this
card's own sets' statuses**:

```ts
prevProps.sets.every(s => prevProps.setSyncStatus?.[s.id] === nextProps.setSyncStatus?.[s.id])
```

Now a card re-renders on a sync change **iff one of its own sets** changed
saved/saving/queued — structurally, not by timing. This is a *narrower*
comparison, not a re-break of the swallow bug: the card still correctly
re-renders when its own set's glyph must update (re-verified: the P0-2 offline
test still shows 3 queued → 3 saved glyph transitions, ux-audit/fixes/P0-2/).
The idle poll also can't churn: `reconcileSetSync` uses a functional setState
that returns the previous object unchanged when no status actually flipped, so
`setSync`'s reference is stable while nothing is syncing (idle = 0 card-0
renders, confirmed above).

## Bug found and fixed en route

The ExerciseCard test suite mocks `@/lib/utils`; the P2 `formatMuscleName`
addition wasn't in the mock, so the suite was silently failing after the P2
commit (my `tail -3` check hid it). Mock updated, snapshots refreshed (only
change: `<span class="capitalize">chest` → `<span>Chest`), full suite green at
1784 tests.
