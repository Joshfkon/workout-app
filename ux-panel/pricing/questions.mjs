/**
 * The pricing study's stimulus and questions (PRICING_STUDY.md §2–§3).
 *
 * Every call carries the same shared context (system prompt: the survey
 * framing, HyperTrack's Free/Pro lists and the competitor price list), then
 * the tour, then the persona, then ONE question block. Answers are free
 * text; numbers are parsed out of them (Van Westendorp) or they are mapped
 * onto anchor statements by SSR (pricing/anchors.mjs). Nobody is asked for
 * a rating.
 *
 * The current Pro price is deliberately NOT in the shared context: it would
 * anchor the Van Westendorp and Gabor-Granger answers. Package prices are
 * named only in the package question.
 */
import { FREE_FEATURES, PRO_FEATURES } from '../anchors.mjs';
import { rng } from '../personas/pricing.mjs';

/** Competitor prices, viewed 2026-11-23 (PRICING_STUDY.md §2). In EVERY prompt. */
export const COMPETITORS = [
  { name: 'Hevy', monthly: 2.99, yearly: 23.99 },
  { name: 'Strong', monthly: 4.99, yearly: 29.99 },
  { name: 'MacroFactor', monthly: 11.99, yearly: 71.99 },
  { name: 'MyFitnessPal', monthly: 19.99, yearly: 79.99 },
  { name: 'Cronometer', monthly: 10.99, yearly: 59.99 },
  { name: 'Fitbod', monthly: 15.99, yearly: 95.99 },
  { name: 'JEFIT', monthly: 12.99, yearly: 69.99 },
  { name: 'Boostcamp', monthly: 14.99, yearly: 59.99 },
  { name: 'Alpha Progression', monthly: 12.99, yearly: 79.99 },
  { name: 'RP Hypertrophy', monthly: 34.99, yearly: 299.99 },
];

/** Gabor-Granger monthly price points (asked in a seeded random order per persona). */
export const GG_PRICES = [2.99, 4.99, 6.99, 9.99, 12.99];
/** Annual offers as multiples of the persona's acceptable monthly price. */
export const ANNUAL_MULTIPLES = [4, 6, 8];
/** One-time lifetime prices (Hevy sells one at $74.99, Strong at $99.99). */
export const LIFETIME_PRICES = [49.99, 79.99, 99.99];

/** Features a persona can rank / name. The first five are today's Pro. */
export const AI_FOOD = 'AI food logging (describe a meal, scan a label, or snap a photo)';
export const CHECK_INS = 'Weekly check-ins that adjust your calorie targets from your weigh-ins and intake';
export const RANKABLE_FEATURES = [...PRO_FEATURES, AI_FOOD, CHECK_INS];

/**
 * Package variants (§3.4). V2 and V4 are today's Pro PLUS one feature at the
 * same price, so a V1 "no" that turns into a V2/V4 "yes" isolates what tipped
 * it. V3 is the food-only tier at a lower price. Edit prices here.
 */
export const PACKAGES = [
  { id: 'V1', name: 'Pro (today)', price: 9.99, features: PRO_FEATURES, adds: null },
  { id: 'V2', name: 'Pro + AI food logging', price: 9.99, features: [...PRO_FEATURES, AI_FOOD], adds: AI_FOOD },
  { id: 'V3', name: 'Food plan', price: 4.99, features: [AI_FOOD, 'Nutrition trends and custom macro targets', 'No training features beyond Free'], adds: 'Food-only tier at a lower price' },
  { id: 'V4', name: 'Pro + weekly check-ins', price: 9.99, features: [...PRO_FEATURES, CHECK_INS], adds: CHECK_INS },
];

/** Labels the "one thing that would make you pay" answer is matched against. */
export const ONE_THING_LABELS = [...RANKABLE_FEATURES, 'A food-only plan at a lower price', 'A lower price', 'A longer free trial', "Nothing: I wouldn't pay for an app like this"];

export const money = (x) => `$${x.toFixed(2)}`;
/** Round to a .99 price (19.96 → 19.99, 29.94 → 29.99). */
export const to99 = (x) => Math.max(0.99, Math.round(x + 0.01) - 0.01);

export function competitorLines() {
  return COMPETITORS.map((c) => `- ${c.name}: ${money(c.monthly)}/month · ${money(c.yearly)}/year`).join('\n');
}

/** Shared system prompt: identical for every persona and call, so it caches. */
export function surveySystemPrompt() {
  return [
    "You are taking part in a market-research survey about a fitness app's pricing. In each message you are told who you are; answer exactly as that person honestly would, in their own words, like a survey respondent typing short replies.",
    'There are no right answers. Many people never pay for apps, and many think subscriptions are too expensive: if this person would say no, or that a price is too high, say so plainly. Only say you are unsure if you truly are. Never give ratings or scores.',
    '',
    `About HyperTrack: Free covers ${FREE_FEATURES.join(', ').toLowerCase()}. Pro adds ${PRO_FEATURES.join(', ').toLowerCase()}.`,
    '',
    'For reference, what other fitness apps charge (monthly · yearly, as of November 2026):',
    competitorLines(),
  ].join('\n');
}

/** Who the persona is, including their usage history (it halves feature mis-ranking). */
export function personaBrief(p) {
  const pr = p.pricing ?? {};
  return [
    `You are ${p.name}, ${p.age}. ${p.summary}`,
    `Your goals: ${p.goals}`,
    `Training experience: ${p.experience}. What you use now: ${p.previousApps}.`,
    pr.spendLine ?? '',
    pr.typicalWeek?.length ? `A typical week for you:\n${pr.typicalWeek.map((l) => `- ${l}`).join('\n')}` : '',
    pr.featuresTouched?.length ? `In HyperTrack you'd mostly use: ${pr.featuresTouched.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

/** The seeded Gabor-Granger order for one persona (stable across reruns with the same seed). */
export function ggOrder(personaId, seed) {
  return rng(`gg-order:${seed}:${personaId}`).shuffle(GG_PRICES);
}

const str = (description) => ({ type: 'string', description });
const tool = (name, description, properties) => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

const AMOUNT = 'Start with the monthly dollar amount (for example "$4.99"), then one sentence on why.';

export const VW_TOOL = tool('submit_pricing_vw', 'Your four price thresholds for HyperTrack Pro, per month, each with a reason.', {
  too_cheap: str(`At what monthly price would Pro be so cheap that you'd doubt its quality? ${AMOUNT}`),
  bargain: str(`At what monthly price would Pro be a bargain, great value for the money? ${AMOUNT}`),
  getting_expensive: str(`At what monthly price would Pro start to feel expensive, so you'd have to think about it? ${AMOUNT}`),
  too_expensive: str(`At what monthly price would Pro be too expensive to consider at all? ${AMOUNT}`),
});

/**
 * A would-buy answer: the verdict alone (scored by SSR) and the reasons
 * apart. Scored inside a paragraph of reasons, a plain "No" drifts toward 3
 * (the week review found the same), so only `answer` is embedded.
 */
const verdict = (question) => ({
  type: 'object',
  properties: {
    answer: str(`${question} ONE short sentence starting with Yes, No or Maybe, with no reasons.`),
    why: str('Why, in a few words.'),
  },
  required: ['answer', 'why'],
  additionalProperties: false,
});

export const GG_TOOL = tool(
  'submit_pricing_gg',
  'Your answer for each monthly price, in the order the prices were listed.',
  Object.fromEntries(ORDINALS.map((o) => [o, verdict(`The ${o} price listed: would you start a subscription at this price?`)])),
);

export const PLANS_TOOL = tool('submit_pricing_plans', 'Your answers about yearly and lifetime pricing.', {
  ...Object.fromEntries(ANNUAL_MULTIPLES.map((m) => [`annual_${m}x`, verdict(`The yearly price listed as option ${m}x: would you pay that once a year instead of monthly?`)])),
  ...Object.fromEntries(LIFETIME_PRICES.map((x) => [`lifetime_${Math.floor(x)}`, verdict(`The one-time lifetime price of ${money(x)}: would you buy it?`)])),
});

export const PACKAGES_TOOL = tool('submit_pricing_packages', 'Your answers about the four package options and the Pro features.', {
  ...Object.fromEntries(PACKAGES.map((v) => [v.id.toLowerCase(), verdict(`Option ${v.id} (${v.name}, ${money(v.price)}/month): would you pay for it?`)])),
  choice: str('If you would pay for exactly one option, which? Start with V1, V2, V3, V4 or None, then why in one sentence.'),
  feature_ranking: { type: 'array', description: 'All of the listed features, most valuable to you first.', items: { type: 'string', enum: RANKABLE_FEATURES } },
  one_thing: str('The one thing that would make you pay for HyperTrack, in one short sentence (or say nothing would).'),
});

export const PRICING_TOOLS = [VW_TOOL, GG_TOOL, PLANS_TOOL, PACKAGES_TOOL];

/** The question text for each block. */
export const QUESTION_TEXT = {
  vw: () =>
    'Think about HyperTrack Pro as described, for someone like you. Give four monthly prices, each with a one-sentence reason: too cheap to trust, a bargain, getting expensive, and too expensive. Answer with submit_pricing_vw.',
  gg: (order) =>
    [
      "You'll be asked about several monthly prices for HyperTrack Pro, one after another. Treat each one on its own, as if it were the only price on offer.",
      ...order.map((price, i) => `${i + 1}. (${ORDINALS[i]}) ${money(price)}/month`),
      'For each, would you start a subscription at that price? Answer with submit_pricing_gg.',
    ].join('\n'),
  plans: (monthly, accepted = true) =>
    [
      `Say HyperTrack Pro costs ${money(monthly)} a month${accepted ? ', a price you said you could accept' : ''}. You'll be asked about several yearly and one-time prices; treat each on its own.`,
      ...ANNUAL_MULTIPLES.map((m) => `- Option ${m}x: ${money(to99(monthly * m))} a year, paid once a year (instead of ${money(monthly * 12)} over a year of monthly payments).`),
      ...LIFETIME_PRICES.map((x) => `- Lifetime: ${money(x)} once, Pro forever.`),
      'Answer with submit_pricing_plans.',
    ].join('\n'),
  packages: () =>
    [
      'HyperTrack is deciding how to package its paid plan. Here are four options; for each, would you pay, and if you would pay for exactly one, which?',
      ...PACKAGES.map((v) => `- ${v.id}, ${v.name}, ${money(v.price)}/month: ${v.features.join('; ')}.`),
      `Then rank these features from most to least valuable to you: ${RANKABLE_FEATURES.join('; ')}. And name the one thing that would make you pay.`,
      'Answer with submit_pricing_packages.',
    ].join('\n'),
};

/** The planned annual prices for a persona's acceptable monthly price. */
export function annualOffers(monthly) {
  return ANNUAL_MULTIPLES.map((m) => ({ multiple: m, price: to99(monthly * m) }));
}
