# Pricing study plan: synthetic-persona price research

**Goal.** Choose HyperTrack's price and package shape: which monthly and annual prices, and which features belong in Free vs Pro (and whether a food-only tier is worth having). We compare **options against each other**. We do not forecast revenue. The winning option gets confirmed with a real price test after launch.

**Status.** Built (see §5 and the README's *Pricing study*). Verified only with the free scripted model (`--dry-run --fake-llm`, including `--hands-on`); no paid study has run.

---

## Why "relative, not absolute"

Published work on language models as survey respondents (sources in the research brief, 2026-11-23) agrees on four points:

- **Willingness-to-pay amounts are plausible but unreliable.** They can even get the direction wrong. They're useful *alongside* human data, not instead of it (Brand, Israeli & Ngwe, 2023 → 2025).
- **Changing only the price in a prompt shifts other assumptions too**, so the model reads more into it than the price. Stating the design openly ("you'll see several prices") helps (Gui & Toubia, 2023 → 2025).
- **Personas alone mis-rank which features matter.** Giving each persona a concrete usage history roughly halves the error (NeurIPS 2026).
- **Answers come out compressed.** They vary less than real people's (Bisbee et al., 2024). Asking for free text and then mapping it onto anchor answers, the method our panel already uses (arXiv 2510.08338), gets close to human test-retest reliability.

No study validates the two standard price methods (Van Westendorp and Gabor-Granger) with language-model respondents. So we treat the output as **"option A beats option B for segment X"**.

---

## 1. Personas: 100, sampled to match likely downloaders

The persona generator draws from these quotas. All are US and editable. They are **sourced where noted and assumed where not**.

| Dimension | Quota | Basis |
|---|---|---|
| Segment | lifting-focused 45% · food-only 30% · both 25% | Weak: YouGov 2024 (35% track exercise, 27% diet); no published overlap |
| Gender, lifting segment | 80% M / 20% F | arXiv 2026 (n≈15k, lifting-app users) |
| Gender, food-only segment | 70% F / 30% M | MyFitnessPal users, 2014–17 (old) |
| Age, lifting segment | 18–24 20% · 25–39 50% · 40–54 22% · 55+ 8% | Median 34 (arXiv 2026), mean 34.7 (Frontiers 2026); bands interpolated |
| Age, food-only segment | 18–29 25% · 30–49 45% · 50+ 30% | Mean 38.7 (old) |
| Household income | <$50k 25% · $50–100k 35% · >$100k 40% | Direction only (Pew, HINTS 2025) |
| Training experience | beginner 35% · intermediate 45% · advanced 20% | **Assumption: no source** |
| App they use now | weighted mix of Hevy, Strong, MyFitnessPal, MacroFactor, Notes/paper, none | Assumption |

**Each persona also gets:**
- a **concrete usage history**: what they logged in a typical week and which features they'd touch;
- a **current-spend line**: "you pay $0 / $2.99 / $11.99 a month for fitness apps today".

---

## 2. What each persona sees

The panel already exists, so there are two tiers of exposure:

| Tier | Personas | What they do | Approx. cost |
|---|---|---|---|
| **A. Survey** | 100 | Read a standard tour: Home, a logged workout with the weight reasoning, Eat, Progress and the program builder (screenshots plus one-line captions from the current build), and their own usage history | ≈ $3–6 |
| **B. Hands-on check** | 12–20 (subset of A, quota-balanced) | Use the real app for the core journeys (local, as the panel does now), then answer the same questions | ≈ $10–20 |

Tier B exists only to check that Tier A's ranking holds after real use. If the two disagree, we trust B and re-weight.

**Every prompt includes the competitor price list (viewed 2026-11-23):**
- Hevy: $2.99/mo · $23.99/yr
- Strong: $4.99 · $29.99
- MacroFactor: $11.99 · $71.99
- MyFitnessPal: $19.99 · $79.99
- Cronometer: $10.99 · $59.99
- Fitbod: $15.99 · $95.99
- JEFIT: $12.99 · $69.99
- Boostcamp: $14.99 · $59.99
- Alpha Progression: $12.99 · $79.99
- RP Hypertrophy: $34.99 · $299.99

---

## 3. Questions

All answers are **free text first**, then mapped onto anchor answers by semantic similarity (the panel's existing method).

1. **Van Westendorp:** the four thresholds (too cheap to trust / a bargain / getting expensive / too expensive), asked as monthly amounts with a one-sentence reason each.
2. **Gabor-Granger:** "Would you start a subscription at $X/month?" across **$2.99, $4.99, $6.99, $9.99, $12.99**, in a random order per persona, with the design stated openly ("you'll be asked about several prices").
3. **Annual vs monthly:** at the persona's acceptable monthly price, would $X/year change their answer? Test annual at 4×, 6× and 8× the monthly price.
4. **Package shape:** for each variant, "would you pay, and for what?":
   - **V1 (today):** Pro = program builder, smart suggestions, advanced analytics.
   - **V2:** Pro adds AI food logging (describe, label and photo).
   - **V3:** a **food-only tier** at a lower price.
   - **V4:** Pro = program builder plus weekly check-ins that move calorie targets (the MacroFactor-style feature).
5. **Feature value:** rank the Pro features, then name the one thing that would make them pay.

---

## 4. Analysis

- **Per segment** (lifting, food-only, both) **and per experience level**:
  - the acceptable price range from the thresholds;
  - the take-rate curve from the Gabor-Granger answers;
  - revenue per 100 personas at each price, as a **relative** index.
- **Package variants:** share choosing each one, and which feature most often tips a "no" into a "yes".
- **Report:** a one-page summary with a recommended price and package, the runner-up, and the segment it serves worst.

---

## 5. Building it into the panel

Small panel-only changes:
- `ux-panel/personas/pricing.mjs`: a quota sampler and persona generator, seeded so it's reproducible.
- `ux-panel/journeys.mjs`: a `pricing-tour` stimulus that renders a static tour from screenshots of the current build.
- `ux-panel/anchors.mjs`: new anchor sets for the threshold and would-buy answers.
- `run.mjs --study=pricing [--hands-on=N]`.
- `report.mjs`: a pricing section with curves per segment.

Estimated effort: about one session.

**As built** (where it differs from the list above):
- The tour is `ux-panel/pricing/tour.mjs` + `pricing/capture-tour.mjs`, not a journey: survey personas never browse.
- Pricing anchors live in `ux-panel/pricing/anchors.mjs` (versioned and hashed like `anchors.mjs`). Threshold answers have no anchors: their dollar amounts are parsed from the text.
- The report is `ux-panel/pricing/render.mjs` (written by the run as `pricing-report.html`; `pricing/report.mjs` re-renders).
- Lifetime ($49.99 / $79.99 / $99.99) is in. V2 and V4 are today's Pro **plus** one feature at the same $9.99, so a V1 "no" that turns into a V2/V4 "yes" isolates the feature; V3 (food-only) is $4.99. All editable in `pricing/questions.mjs`.
- Quotas for the "both" segment's gender and age had no basis in §1; they are marked as assumptions in the table.

---

## 6. Decisions for you

- **Quotas:** accept as drafted, or change the segment mix. The food-only vs lifting split is the weakest number.
- **Prices to test:** add a lifetime option? Hevy offers $74.99 and Strong $99.99.
- **Variants:** keep or drop V3 (food-only tier) and V4 (weekly check-ins).
- **Validation:** whether to run a small real human test (e.g. a landing page with price variants, or a paid survey panel of 50–100 people). This is the only way to get absolute numbers.
