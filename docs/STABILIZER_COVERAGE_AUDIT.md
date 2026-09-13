# Stabilizer Coverage Audit — full stock library

**Date:** 2026-09-13
**Trigger:** the `Shrug (Dumbbell)` bug — a custom exercise carrying no
`stabilizers` tags is silently invisible to the stabilizer-recovery channel
(no pre-set warning, no dose credit). The custom side was repaired by
`20260913000001_backfill_custom_stabilizers.sql`; this audit asks the same
question of the STOCK library: **which exercises has the channel never even
looked at?**

**Status: IMPLEMENTED 2026-09-13** — Josh approved the audit's leans as
written. F1 shipped plus the F3 leans (Bulgarian Split Squat → `erectors`,
forearms deliberately excluded; all other judgment calls → no tags): map +
`20260913000002` (stock) + `20260913000003` (matching customs); every no-tag
verdict is recorded in `NO_STABILIZERS_BY_DECISION`; all 21 UNSEEDED
questions are resolved and the list emptied; the F5 exhaustiveness guard is
`services/__tests__/stabilizerCoverage.test.ts`. The text below is the audit
as reviewed.

**Original status: PROPOSALS ONLY.** Per the approved-plan rule in
`services/shared/stabilizerTags.ts`, non-obvious classifications are Josh's to
approve — nothing in this document changes code or data. Each recommendation
carries a confidence so the low-confidence ones are easy to pick out and
overrule.

## Census

| Bucket | Count | Meaning |
|---|---|---|
| Tagged (`STABILIZERS_BY_EXERCISE_NAME`) | 55 | Classified; feeds dose + warning |
| Deliberately unseeded (`UNSEEDED_STABILIZER_EXERCISES`) | 21 | Open question recorded, awaiting Josh |
| **Never examined** | **72** | **No classification, no recorded question — silently invisible** |
| Total stock (`SEED_EXERCISE_TAGS`) | 148 | |

The 72 were never *decided* to have no stabilizers — they simply fell outside
the original classification pass. Most of them genuinely need no tags (that's
what this audit establishes, exercise by exercise, below), but "no tags by
decision" and "no tags by omission" are different states, and today the code
cannot tell them apart. Finding F5 proposes the structural fix.

## Method

Each exercise was judged against the four approved classification rules
(quoted from `stabilizerTags.ts`):

- **erectors** → rows (unsupported), hinges, squats, carries, heavy standing
  loaded work. NOT machine-supported variants; NOT where erectors are already
  the primary mover.
- **rotator_cuff** → horizontal/vertical pressing, heavy overhead work, and
  direct external-rotation-dominant pulls (dose visibility).
- **rear_delts** → pressing (isometric humeral-head control), where not
  already a mover.
- **forearms** → hand-supported pulling, where forearms is not already the
  primary mover.

Plus the standing exclusions: abs/obliques are deliberately not tracked, and a
muscle that is already a primary/secondary MOVER on the exercise feeds the
dose channel through that tag and must not be double-tagged as a stabilizer.

---

## F1 — Proposed new tags (4 exercises)

| Exercise | Proposed | Confidence | Rationale |
|---|---|---|---|
| Band Pull-Apart | `rotator_cuff` | **High** | Exactly the external-rotation-dominant pull class the rule tags for dose visibility (Face Pull, Rear Delt Fly, Reverse Cable Crossover, Prone Y-Raise all carry it). Its omission looks like an oversight, not a decision. |
| Dumbbell Fly | `rotator_cuff` | Medium | The one fly variant where the cuff is loaded hard in the deepest stretch with no stack deloading the bottom. Answers its UNSEEDED question: cable flys and Pec Deck stay untagged (resistance falls off / machine-guided), this one doesn't. |
| Overhead Tricep Extension | `rotator_cuff` | Medium | Shoulder held at end-range flexion under load for the whole set — same dose-visibility argument as the face-pull group. Answers its UNSEEDED question. |
| Cable Overhead Tricep Extension, Katana Tricep Extension | `rotator_cuff` | Medium | Same position, same reasoning — the three overhead extensions should move together. |

## F2 — Recommend NO TAGS, by reason (68 of the 72 + 14 of the 21 unseeded)

**A. Forearms already the PRIMARY mover** (rule-excluded; the muscle-readiness
sheet covers them, and their dose flows through the mover tag) — 9:
Barbell Wrist Curl, Barbell Reverse Wrist Curl, Behind-the-Back Wrist Curl,
Dumbbell Wrist Curl, Reverse Wrist Curl, Wrist Roller, Plate Pinch Hold,
Dead Hang, EZ Bar Reverse Curl.

**B. Erectors already the PRIMARY mover** (rule-excluded) — 3:
Jefferson Curl, Machine Back Extension, Superman Hold.

**C. Erectors already a SECONDARY mover** (dose flows via the mover tag;
secondary movers never gate, by design) — 1: Back Extension.

**D. Machine- / bench- / pad-supported lower body** (the support is exactly
the mitigation the erector warning suggests) — 16:
Leg Press, Incline Leg Press, Hack Squat, Pendulum Squat, Leg Extension,
Lying Leg Curl, Seated Leg Curl, Glute Drive Machine, Hip Abduction Machine,
Hip Adduction Machine, Calf Press Machine, Leg Press Calf Raise,
Seated Calf Raise, Donkey Calf Raise (torso on pad), Nordic Curl (kneeling),
Wall Sit (wall-supported).

**E. Floor / short-lever hip work** (supine or side-lying; no meaningful
axial or grip demand at any load) — 7:
Glute Bridge, Glute Bridge Hold, Clamshell, Side-Lying Hip Abduction,
Banded Lateral Walk, Cable Hip Abduction, Cable Hip Adduction.

**F. Supported or light arm isolation** (bench/pad-supported, or loads too
small to gate any tracked muscle) — 12:
45° Preacher Curl, Preacher Curl, Concentration Curl, Incline Dumbbell Curl,
Machine Bicep Curl, Dumbbell Kickback, Triceps Extension (Dumbbell),
Machine Tricep Extension, Cable Tricep Pushdown, Rope Tricep Pushdown,
Tricep Pushdown, Skull Crusher (lying, humerus ≈90° — the cuff-relevant class
is the three OVERHEAD extensions in F1; if F1 is rejected there, this stays no
either way).

**G. Core work** (abs/obliques deliberately untracked; tracked-muscle demand
minimal) — 13:
Ab Wheel Rollout, Cable Crunch, Captain's Chair Leg Raise, Copenhagen Plank,
Dead Bug, Decline Crunch, Hammer Strength Ab Crunch, Hollow Body Hold,
Machine Ab Crunch, Plank, RKC Plank, Russian Twist, Side Plank.

**H. Bodyweight standing quad** — 1: Sissy Squat (unloaded; torso lever is
backward but axial load is bodyweight only).

**I. From the UNSEEDED list, recommend closing as NO TAGS** — 14:
- Barbell Curl, EZ Bar Curl (their recorded question): the erector iso demand
  of a standing curl is real but tiny relative to erector capacity — a
  40–60 kg curl is noise against a muscle that hinges 2–4× that. Tagging them
  would fire erector warnings on every arm day after a pull day. **Medium
  confidence.** Same verdict, same reason for the standing curls in the
  never-examined bucket: Dumbbell Curl, Hammer Curl, Cable Curl,
  Cable Bicep Curl, Bayesian Cable Curl (5 more, counted in F above by class).
- Cable Fly, Seated Cable Fly, Pec Deck: cable resistance falls off at the
  stretch / machine guides the path — the cuff-critical variant is Dumbbell
  Fly (F1). **Medium.**
- Lateral Raise, Behind-the-Back Cable Lateral Raise, Cable Cross Body
  Lateral Raise, Machine Lateral Raise, Front Raise, Cable Y-Raise: cuff
  involvement is real but the absolute loads never reach gate-worthy
  territory, and the dose is a rounding error next to pressing volume.
  **Medium-high.**
- L-Sit: bodyweight support hold; scap/cuff demand brief and light. **Medium.**
- Cable Woodchop, Pallof Press: standing anti-rotation at light-moderate cable
  loads; the erector iso demand doesn't approach the hinge/squat/carry class.
  **Medium.**

## F3 — Judgment calls that need Josh (5)

| Exercise | Question | Lean |
|---|---|---|
| Bulgarian Split Squat (UNSEEDED) | Heavy rear-elevated work is un-supported standing load — erectors looks right. Forearms only applies when dumbbell-held, and tags can't condition on equipment. | `erectors` yes; forearms **no** (equipment-dependent → conservative). Note: Walking Lunges, Reverse Lunge and Step Up already carry `erectors`, so leaving BSS bare is the *inconsistent* option. |
| Hip Thrust / Single Leg Hip Thrust | Loads get very heavy (200 kg+), but the torso is bench-braced and the spine near-neutral — not the standing/hinge class the rule names. | **No tags**, low-medium confidence. If real-world erector complaints show up around heavy thrust days, revisit. |
| Single Leg Calf Raise | Standing Calf Raise and Smith Machine Calf Raise carry `erectors` (heavy standing axial load). The single-leg version is usually bodyweight/one dumbbell with hand support. | **No tags** — but this makes the calf-raise family split; worth a deliberate yes/no so it reads as a decision. |
| Dumbbell Side Bend | Standing loaded, but unilateral and light; obliques (untracked) do the work. | **No tags**, medium. |
| Cossack Squat, Adductor Side Lunge (UNSEEDED) | Loaded vs bodyweight varies per user. | **No tags** (typically light/bodyweight; mobility-biased), medium. |

## F4 — Consistency notes on the existing 55 (no changes proposed)

- The lunge family (`Walking Lunges`, `Reverse Lunge`, `Step Up`) carries
  `erectors` while Bulgarian Split Squat sits unresolved in UNSEEDED — F3
  recommends resolving BSS to match.
- `Hanging Leg Raise` carries `forearms` while `Dead Hang` correctly doesn't
  (forearms is its primary) — consistent, just worth stating.
- `Seated Machine Row` / `Chest Supported Row` / `Seal Row` carry `forearms`
  but not `erectors` — correct under the rules (support removes the erector
  demand, grip remains).
- No rule violations found in the tagged 55.

## F5 — Structural fix: make omission impossible

The real lesson of the census is that the library has three states (tagged /
open question / **never examined**) and the third is indistinguishable from a
decision. Once F1–F3 are settled, the follow-up change should:

1. Add the approved F1 tags to `STABILIZERS_BY_EXERCISE_NAME` + BOTH
   migrations' successors (a stock UPDATE migration in the `20260825000002`
   style, and the custom-name backfill inherits automatically if the custom
   backfill pattern is re-run — or simply include custom token-matching in the
   same new migration).
2. Add an explicit `NO_STABILIZERS_BY_DECISION` list (names only) to
   `stabilizerTags.ts` recording every "no tags" verdict above.
3. Extend the drift-guard test with an **exhaustiveness check**: every name in
   `SEED_EXERCISE_TAGS` must appear in exactly one of tagged /
   no-by-decision / unseeded. A new stock exercise then fails CI until someone
   classifies it — the `Shrug (Dumbbell)` failure mode (silent invisibility)
   becomes unrepresentable for stock, and the custom backfill keeps
   name-matching customs covered.

## Appendix — per-exercise disposition (72 never-examined)

| Exercise | Verdict | Reason group |
|---|---|---|
| 45° Preacher Curl | none | F (supported) |
| Ab Wheel Rollout | none | G (core) |
| Back Extension | none | C (erectors secondary mover) |
| Band Pull-Apart | **rotator_cuff** | F1 |
| Banded Lateral Walk | none | E |
| Barbell Reverse Wrist Curl | none | A (forearms primary) |
| Barbell Wrist Curl | none | A |
| Bayesian Cable Curl | none | F / F2-I standing-curl class |
| Behind-the-Back Wrist Curl | none | A |
| Cable Bicep Curl | none | F / F2-I standing-curl class |
| Cable Crunch | none | G |
| Cable Curl | none | F / F2-I standing-curl class |
| Cable Hip Abduction | none | E |
| Cable Hip Adduction | none | E |
| Cable Tricep Pushdown | none | F |
| Calf Press Machine | none | D |
| Captain's Chair Leg Raise | none | G |
| Clamshell | none | E |
| Concentration Curl | none | F |
| Copenhagen Plank | none | G |
| Dead Bug | none | G |
| Dead Hang | none | A |
| Decline Crunch | none | G |
| Donkey Calf Raise | none | D (pad-supported) |
| Dumbbell Curl | none | F / F2-I standing-curl class |
| Dumbbell Kickback | none | F |
| Dumbbell Side Bend | none | F3 (judgment) |
| Dumbbell Wrist Curl | none | A |
| EZ Bar Reverse Curl | none | A |
| Glute Bridge | none | E |
| Glute Bridge Hold | none | E |
| Glute Drive Machine | none | D |
| Hack Squat | none | D |
| Hammer Curl | none | F / F2-I standing-curl class |
| Hammer Strength Ab Crunch | none | G |
| Hip Abduction Machine | none | D |
| Hip Adduction Machine | none | D |
| Hip Thrust | none | F3 (judgment) |
| Hollow Body Hold | none | G |
| Incline Dumbbell Curl | none | F |
| Incline Leg Press | none | D |
| Jefferson Curl | none | B (erectors primary) |
| Leg Extension | none | D |
| Leg Press | none | D |
| Leg Press Calf Raise | none | D |
| Lying Leg Curl | none | D |
| Machine Ab Crunch | none | G |
| Machine Back Extension | none | B |
| Machine Bicep Curl | none | F |
| Machine Tricep Extension | none | F |
| Nordic Curl | none | D (kneeling) |
| Pendulum Squat | none | D |
| Plank | none | G |
| Plate Pinch Hold | none | A |
| Preacher Curl | none | F |
| RKC Plank | none | G |
| Reverse Wrist Curl | none | A |
| Rope Tricep Pushdown | none | F |
| Russian Twist | none | G |
| Seated Calf Raise | none | D |
| Seated Leg Curl | none | D |
| Side Plank | none | G |
| Side-Lying Hip Abduction | none | E |
| Single Leg Calf Raise | none | F3 (judgment) |
| Single Leg Hip Thrust | none | F3 (judgment) |
| Sissy Squat | none | H |
| Skull Crusher | none | F |
| Superman Hold | none | B |
| Tricep Pushdown | none | F |
| Triceps Extension (Dumbbell) | none | F |
| Wall Sit | none | D |
| Wrist Roller | none | A |

And the 21 UNSEEDED, restated as verdicts: Band-class overhead extensions →
`rotator_cuff` (F1: Overhead / Cable Overhead / Katana Tricep Extension);
Dumbbell Fly → `rotator_cuff` (F1); Bulgarian Split Squat → `erectors` (F3);
Cossack Squat, Adductor Side Lunge → judgment lean none (F3); everything else
(Barbell Curl, EZ Bar Curl, Cable Fly, Seated Cable Fly, Pec Deck, Lateral
Raise ×4 variants, Front Raise, Cable Y-Raise, L-Sit, Cable Woodchop, Pallof
Press) → none (F2-I).
